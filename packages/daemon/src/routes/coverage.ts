import type { DaemonConfig } from "../config.js";
import type { PGlite } from "@electric-sql/pglite";
import type { FastifyInstance } from "fastify";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Effective Earth radius (m) for radio propagation — 4/3 × 6371 km */
const EARTH_RADIUS_EFF_M = 8_500_000;

/** Persist elevation lookups for 6 months.  Terrain changes negligibly over
 *  that window and we want to be a good citizen to public elevation APIs. */
const CACHE_TTL_MS = 180 * 24 * 60 * 60 * 1000;

/** Max points per API request — smaller batches reduce 429 risk. */
const ELEVATION_CHUNK_SIZE = 100;

/** Delay between consecutive API chunks (ms) to avoid burst rate-limiting. */
const ELEVATION_CHUNK_DELAY_MS = 250;

/** Max retries on HTTP 429 with exponential back-off. */
const ELEVATION_MAX_RETRIES = 4;

// ---------------------------------------------------------------------------
// Elevation cache
// ---------------------------------------------------------------------------

/** In-process L1 cache — avoids a DB round-trip for points seen this session. */
const memCache = new Map<string, number>();

/** Round to ~11 m precision for cache key deduplication. */
function elevKey(lat: number, lon: number): string {
  return `${lat.toFixed(4)},${lon.toFixed(4)}`;
}

/**
 * Resolve elevations for a batch of lat/lon points.
 *
 * Lookup order:
 *   1. In-process memory cache (instant)
 *   2. Persistent DB cache — elevation_cache table (fast, survives restarts)
 *   3. Open-Elevation API (batched, results written back to both caches)
 *
 * Points cached within the last 30 days are never re-fetched.
 */
async function fetchElevations(
  db: PGlite,
  points: Array<{ lat: number; lon: number }>,
  elevationApiUrl: string,
): Promise<number[]> {
  const results = new Array<number>(points.length).fill(0);
  const needDb: Array<{ idx: number; lat: number; lon: number }> = [];

  // ── L1: memory cache ──────────────────────────────────────────────────────
  for (let i = 0; i < points.length; i++) {
    const k = elevKey(points[i].lat, points[i].lon);
    const v = memCache.get(k);
    if (v !== undefined) {
      results[i] = v;
    } else {
      needDb.push({ idx: i, ...points[i] });
    }
  }
  if (needDb.length === 0) return results;

  // ── L2: DB cache ──────────────────────────────────────────────────────────
  const cutoff = new Date(Date.now() - CACHE_TTL_MS).toISOString();

  // Build separate lat/lon arrays so we can match the composite primary key.
  // (Passing combined "lat,lon" strings into a lat_key IN (...) filter never
  // matched because lat_key stores only the lat portion — that was the bug.)
  const latKeys = needDb.map((p) => p.lat.toFixed(4));
  const lonKeys = needDb.map((p) => p.lon.toFixed(4));

  // Build a VALUES list of (lat, lon) pairs for an IN-style composite match.
  const pairPlaceholders = needDb.map((_, i) => `($${i * 2 + 2}, $${i * 2 + 3})`).join(", ");
  const pairParams: unknown[] = [cutoff];
  for (let i = 0; i < needDb.length; i++) {
    pairParams.push(latKeys[i], lonKeys[i]);
  }
  const { rows } = await db.query<{ lat_key: string; lon_key: string; elevation: number }>(
    `SELECT lat_key, lon_key, elevation
     FROM elevation_cache
     WHERE cached_at >= $1 AND (lat_key, lon_key) IN (${pairPlaceholders})`,
    pairParams,
  );

  const dbHit = new Map<string, number>();
  for (const r of rows) {
    dbHit.set(`${r.lat_key},${r.lon_key}`, r.elevation);
  }

  const needApi: Array<{ idx: number; lat: number; lon: number }> = [];
  for (const p of needDb) {
    const k = elevKey(p.lat, p.lon);
    const v = dbHit.get(k);
    if (v !== undefined) {
      results[p.idx] = v;
      memCache.set(k, v); // warm L1
    } else {
      needApi.push(p);
    }
  }
  if (needApi.length === 0) return results;

  // ── L3: elevation API ─────────────────────────────────────────────────────
  const now = new Date().toISOString();
  for (let start = 0; start < needApi.length; start += ELEVATION_CHUNK_SIZE) {
    // Throttle between chunks so we don't burst the public API
    if (start > 0) {
      await new Promise((r) => setTimeout(r, ELEVATION_CHUNK_DELAY_MS));
    }

    const chunk = needApi.slice(start, start + ELEVATION_CHUNK_SIZE);

    // Fetch with exponential back-off on 429
    let res: Response | undefined;
    for (let attempt = 0; attempt <= ELEVATION_MAX_RETRIES; attempt++) {
      if (attempt > 0) {
        const backoffMs = Math.min(500 * 2 ** (attempt - 1), 8_000);
        await new Promise((r) => setTimeout(r, backoffMs));
      }
      res = await fetch(elevationApiUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          locations: chunk.map((p) => ({ latitude: p.lat, longitude: p.lon })),
        }),
        signal: AbortSignal.timeout(15_000),
      });
      if (res.status !== 429) break;
      console.warn(
        `[coverage] Elevation API rate-limited (429), retry ${attempt + 1}/${ELEVATION_MAX_RETRIES}`,
      );
    }
    if (!res || !res.ok) throw new Error(`Elevation API returned HTTP ${res?.status ?? "???"}`);
    const data = (await res.json()) as { results: Array<{ elevation: number }> };

    // Write results + persist to DB in one upsert
    const dbRows: string[] = [];
    const dbParams: unknown[] = [];
    let p = 1;
    for (let i = 0; i < chunk.length; i++) {
      const elev = data.results[i]?.elevation ?? 0;
      const k = elevKey(chunk[i].lat, chunk[i].lon);
      const [latK, lonK] = k.split(",");
      results[chunk[i].idx] = elev;
      memCache.set(k, elev);
      dbRows.push(`($${p++}, $${p++}, $${p++}, $${p++})`);
      dbParams.push(latK, lonK, elev, now);
    }
    await db.query(
      `INSERT INTO elevation_cache (lat_key, lon_key, elevation, cached_at)
       VALUES ${dbRows.join(", ")}
       ON CONFLICT (lat_key, lon_key) DO UPDATE
         SET elevation = EXCLUDED.elevation, cached_at = EXCLUDED.cached_at`,
      dbParams,
    );
  }

  return results;
}

// ---------------------------------------------------------------------------
// Geodesy helpers
// ---------------------------------------------------------------------------

/**
 * Compute destination lat/lon given an origin, bearing (degrees clockwise from
 * north), and distance (km).  Uses the spherical-Earth formula.
 */
function destinationPoint(
  lat: number,
  lon: number,
  bearingDeg: number,
  distKm: number,
): { lat: number; lon: number } {
  const R = 6371;
  const δ = distKm / R;
  const φ1 = (lat * Math.PI) / 180;
  const λ1 = (lon * Math.PI) / 180;
  const θ = (bearingDeg * Math.PI) / 180;

  const φ2 = Math.asin(Math.sin(φ1) * Math.cos(δ) + Math.cos(φ1) * Math.sin(δ) * Math.cos(θ));
  const λ2 =
    λ1 +
    Math.atan2(Math.sin(θ) * Math.sin(δ) * Math.cos(φ1), Math.cos(δ) - Math.sin(φ1) * Math.sin(φ2));

  return {
    lat: (φ2 * 180) / Math.PI,
    lon: (((λ2 * 180) / Math.PI + 540) % 360) - 180,
  };
}

// ---------------------------------------------------------------------------
// Route
// ---------------------------------------------------------------------------

export async function registerCoverageRoutes(
  app: FastifyInstance,
  db: PGlite,
  config: Pick<DaemonConfig, "coverage">,
) {
  /**
   * GET /api/coverage/viewshed
   *
   * Returns a GeoJSON Polygon representing the radio line-of-sight coverage
   * area visible from a given point, accounting for terrain elevation and
   * Earth curvature.
   *
   * Query params:
   *   lat        – source latitude  (required)
   *   lon        – source longitude (required)
   *   altitudeM  – antenna height above ground in metres (default 2)
   *   radiusKm   – max search radius in km (default 10, max 50)
   *   radials    – number of angular rays to cast (default 36, max 72)
   */
  app.get("/api/coverage/viewshed", async (req, reply) => {
    const q = req.query as Record<string, string | undefined>;

    const lat = Number(q.lat);
    const lon = Number(q.lon);
    const antennaM = Math.max(0, Number(q.altitudeM ?? 2) || 2);
    const radiusKm = Math.min(50, Math.max(0.5, Number(q.radiusKm ?? 10) || 10));
    const numRadials = Math.min(72, Math.max(8, Number(q.radials ?? 36) || 36));
    const numSteps = 15; // fixed: balances API call volume vs. resolution

    if (!isFinite(lat) || !isFinite(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180) {
      return reply.status(400).send({ error: "Invalid lat/lon" });
    }

    // ── Viewshed cache lookup ──────────────────────────────────────────────
    // Key at ~1 km precision (2 decimal places).  A node that hasn't moved
    // more than ~1 km reuses the stored polygon — no elevation API calls, no
    // LOS computation needed.
    const vsLatKey = lat.toFixed(2);
    const vsLonKey = lon.toFixed(2);
    const vsCutoff = new Date(Date.now() - CACHE_TTL_MS).toISOString();
    const { rows: vsRows } = await db.query<{ geojson: string }>(
      `SELECT geojson FROM viewshed_cache
       WHERE lat_key = $1 AND lon_key = $2 AND radius_km = $3 AND cached_at >= $4
       LIMIT 1`,
      [vsLatKey, vsLonKey, radiusKm, vsCutoff],
    );
    if (vsRows.length > 0) {
      return JSON.parse(vsRows[0].geojson);
    }

    // ── Build sample points ────────────────────────────────────────────────
    // Layout: allPoints[0] = source, then rows of numSteps per radial.
    // radialPts[r][s] = point at radial r, step s (0-based).
    const stepKm = radiusKm / numSteps;
    const allPoints: Array<{ lat: number; lon: number }> = [{ lat, lon }];
    const radialPts: Array<Array<{ lat: number; lon: number }>> = [];

    for (let r = 0; r < numRadials; r++) {
      const bearing = (360 / numRadials) * r;
      const row: Array<{ lat: number; lon: number }> = [];
      for (let s = 0; s < numSteps; s++) {
        const pt = destinationPoint(lat, lon, bearing, stepKm * (s + 1));
        row.push(pt);
        allPoints.push(pt);
      }
      radialPts.push(row);
    }

    // ── Fetch all elevations in one batched call ───────────────────────────
    let elevations: number[];
    try {
      elevations = await fetchElevations(db, allPoints, config.coverage.elevationApiUrl);
    } catch (err) {
      console.error("[coverage] elevation fetch failed:", err);
      return reply.status(502).send({
        error: "Elevation service unavailable — check ELEVATION_API_URL",
        detail: String(err),
      });
    }

    const sourceHeightM = elevations[0] + antennaM;

    // ── LOS per radial — max-slope algorithm with Earth curvature ─────────
    //
    // A point P at distance d is visible from source S if its slope from S
    // exceeds the maximum slope of all points between S and P.
    //
    // Slope: (terrain_elev - earth_curvature_drop - source_height) / distance
    //
    // The Earth curvature correction makes distant terrain appear lower,
    // increasing effective range (using 4/3 effective Earth radius).
    //
    // We record the furthest visible step per radial as the coverage boundary.

    const boundary: Array<[number, number]> = [];

    for (let r = 0; r < numRadials; r++) {
      let maxSlope = -Infinity;
      let furthestStep = -1;

      for (let s = 0; s < numSteps; s++) {
        const elevIdx = 1 + r * numSteps + s;
        const distM = stepKm * (s + 1) * 1000;
        const terrain = elevations[elevIdx];

        // Earth curvature correction (terrain appears lower at distance)
        const curvDrop = (distM * distM) / (2 * EARTH_RADIUS_EFF_M);
        const slope = (terrain - curvDrop - sourceHeightM) / distM;

        // Point is visible if it's on or above the running angular horizon
        if (slope >= maxSlope) {
          furthestStep = s;
          maxSlope = slope;
        }
      }

      if (furthestStep >= 0) {
        const pt = radialPts[r][furthestStep];
        boundary.push([pt.lon, pt.lat]);
      } else {
        // Extremely rare: nothing visible at all — use a minimal stub point
        const fallback = destinationPoint(lat, lon, (360 / numRadials) * r, stepKm * 0.5);
        boundary.push([fallback.lon, fallback.lat]);
      }
    }

    // Close the GeoJSON polygon ring
    boundary.push(boundary[0]);

    const feature = {
      type: "Feature",
      properties: { lat, lon, radiusKm, antennaHeightM: antennaM },
      geometry: { type: "Polygon", coordinates: [boundary] },
    };

    // ── Persist computed viewshed polygon ─────────────────────────────────
    await db.query(
      `INSERT INTO viewshed_cache (lat_key, lon_key, radius_km, geojson, cached_at)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (lat_key, lon_key, radius_km) DO UPDATE
         SET geojson = EXCLUDED.geojson, cached_at = EXCLUDED.cached_at`,
      [vsLatKey, vsLonKey, radiusKm, JSON.stringify(feature), new Date().toISOString()],
    );

    return feature;
  });

  /**
   * DELETE /api/coverage/viewshed
   *
   * Evicts the cached viewshed polygon for a given position so the next GET
   * recomputes it from scratch (re-fetching elevation data if needed).
   *
   * Query params:
   *   lat      – node latitude  (required)
   *   lon      – node longitude (required)
   *   radiusKm – must match the radius used when the polygon was cached (default 20)
   */
  /**
   * GET /api/elevation
   *
   * Returns the terrain elevation at a single lat/lon point, using the same
   * three-tier cache as the viewshed API (memory → DB → Open-Elevation).
   *
   * Query params:
   *   lat – latitude  (required)
   *   lon – longitude (required)
   *
   * Response: { elevationM: number }
   */
  app.get("/api/elevation", async (req, reply) => {
    const q = req.query as Record<string, string | undefined>;
    const lat = Number(q.lat);
    const lon = Number(q.lon);

    if (!isFinite(lat) || lat < -90 || lat > 90 || !isFinite(lon) || lon < -180 || lon > 180) {
      return reply.status(400).send({ error: "Invalid lat/lon" });
    }

    const [elevationM] = await fetchElevations(db, [{ lat, lon }], config.coverage.elevationApiUrl);
    return { elevationM };
  });

  app.delete("/api/coverage/viewshed", async (req, reply) => {
    const q = req.query as Record<string, string | undefined>;
    const lat = Number(q.lat);
    const lon = Number(q.lon);
    const radiusKm = Number(q.radiusKm ?? 20);

    if (!isFinite(lat) || !isFinite(lon)) {
      return reply.status(400).send({ error: "Invalid lat/lon" });
    }

    const latKey = lat.toFixed(2);
    const lonKey = lon.toFixed(2);

    await db.query(
      `DELETE FROM viewshed_cache WHERE lat_key = $1 AND lon_key = $2 AND radius_km = $3`,
      [latKey, lonKey, radiusKm],
    );

    return reply.status(204).send();
  });
}
