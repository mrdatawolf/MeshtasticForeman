import type { PGlite } from "@electric-sql/pglite";
import type { CoverageProposal } from "@foreman/shared";
import type { FastifyInstance } from "fastify";

// ---------------------------------------------------------------------------
// DB row → API response mapping
// ---------------------------------------------------------------------------

interface ProposalRow {
  id: string;
  name: string;
  lat: number;
  lon: number;
  altitude_m: number;
  modem_preset: number;
  notes: string | null;
  visible: boolean;
  created_at: string;
}

function rowToProposal(row: ProposalRow): CoverageProposal {
  return {
    id: row.id,
    name: row.name,
    lat: row.lat,
    lon: row.lon,
    altitudeM: row.altitude_m,
    modemPreset: row.modem_preset,
    notes: row.notes,
    visible: row.visible,
    createdAt: row.created_at,
  };
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

export async function registerProposalRoutes(app: FastifyInstance, db: PGlite) {
  // GET /api/proposals — list all proposals ordered by creation time
  app.get("/api/proposals", async (_req, _reply) => {
    const { rows } = await db.query<ProposalRow>(
      "SELECT * FROM coverage_proposals ORDER BY created_at ASC",
    );
    return rows.map(rowToProposal);
  });

  // POST /api/proposals — create a new proposal
  app.post("/api/proposals", async (req, reply) => {
    const body = req.body as Record<string, unknown>;

    const name = typeof body.name === "string" ? body.name.trim() : "";
    const lat = Number(body.lat);
    const lon = Number(body.lon);
    const altitudeM = body.altitudeM !== undefined ? Number(body.altitudeM) : 2;
    const modemPreset = body.modemPreset !== undefined ? Number(body.modemPreset) : 0;
    const notes = typeof body.notes === "string" ? body.notes.trim() || null : null;

    if (!name) return reply.status(400).send({ error: "name is required" });
    if (!isFinite(lat) || lat < -90 || lat > 90)
      return reply.status(400).send({ error: "invalid lat" });
    if (!isFinite(lon) || lon < -180 || lon > 180)
      return reply.status(400).send({ error: "invalid lon" });
    if (!isFinite(altitudeM)) return reply.status(400).send({ error: "invalid altitudeM" });
    if (!isFinite(modemPreset) || modemPreset < 0 || modemPreset > 8)
      return reply.status(400).send({ error: "invalid modemPreset" });

    const { rows } = await db.query<ProposalRow>(
      `INSERT INTO coverage_proposals (name, lat, lon, altitude_m, modem_preset, notes)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [name, lat, lon, altitudeM, modemPreset, notes],
    );

    // Return the created proposal (Fastify sends 200; use consistent return-value pattern)
    return rowToProposal(rows[0]);
  });

  // PATCH /api/proposals/:id — partial update
  app.patch("/api/proposals/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = req.body as Record<string, unknown>;

    // Fetch existing row first
    const existing = await db.query<ProposalRow>("SELECT * FROM coverage_proposals WHERE id = $1", [
      id,
    ]);
    if (existing.rows.length === 0) return reply.status(404).send({ error: "proposal not found" });

    const current = existing.rows[0];

    const name = typeof body.name === "string" ? body.name.trim() || current.name : current.name;
    const lat = body.lat !== undefined ? Number(body.lat) : current.lat;
    const lon = body.lon !== undefined ? Number(body.lon) : current.lon;
    const altitudeM = body.altitudeM !== undefined ? Number(body.altitudeM) : current.altitude_m;
    const modemPreset =
      body.modemPreset !== undefined ? Number(body.modemPreset) : current.modem_preset;
    const notes =
      body.notes !== undefined
        ? typeof body.notes === "string"
          ? body.notes.trim() || null
          : null
        : current.notes;
    const visible = body.visible !== undefined ? Boolean(body.visible) : current.visible;

    if (!isFinite(lat) || lat < -90 || lat > 90)
      return reply.status(400).send({ error: "invalid lat" });
    if (!isFinite(lon) || lon < -180 || lon > 180)
      return reply.status(400).send({ error: "invalid lon" });
    if (!isFinite(altitudeM)) return reply.status(400).send({ error: "invalid altitudeM" });
    if (!isFinite(modemPreset) || modemPreset < 0 || modemPreset > 8)
      return reply.status(400).send({ error: "invalid modemPreset" });

    const { rows } = await db.query<ProposalRow>(
      `UPDATE coverage_proposals
       SET name=$2, lat=$3, lon=$4, altitude_m=$5, modem_preset=$6, notes=$7, visible=$8
       WHERE id=$1
       RETURNING *`,
      [id, name, lat, lon, altitudeM, modemPreset, notes, visible],
    );

    return rowToProposal(rows[0]);
  });

  // DELETE /api/proposals/:id — remove a proposal
  app.delete("/api/proposals/:id", async (req, reply) => {
    const { id } = req.params as { id: string };

    const { rows } = await db.query<ProposalRow>(
      "DELETE FROM coverage_proposals WHERE id = $1 RETURNING id",
      [id],
    );

    if (rows.length === 0) return reply.status(404).send({ error: "proposal not found" });

    return reply.status(204).send();
  });
}
