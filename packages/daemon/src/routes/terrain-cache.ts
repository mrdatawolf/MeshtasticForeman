import type { PGlite } from "@electric-sql/pglite";
import type { FastifyInstance } from "fastify";

/** Escape a value for safe inclusion in a SQL string literal. */
function sqlStr(s: string): string {
  return `'${s.replace(/'/g, "''")}'`;
}

export async function registerTerrainCacheRoutes(app: FastifyInstance, db: PGlite) {
  // Accept plain-text SQL bodies on the import endpoint (up to 100 MB)
  app.addContentTypeParser(
    "text/plain",
    { parseAs: "string", bodyLimit: 100 * 1024 * 1024 },
    (_req, body, done) => {
      done(null, body);
    },
  );

  /**
   * GET /api/elevation-cache/export
   *
   * Streams the full elevation_cache table as a SQL dump.  The response uses
   * Content-Disposition so `curl -OJ` saves it with the right filename.
   */
  app.get("/api/elevation-cache/export", async (_req, reply) => {
    const { rows } = await db.query<{
      lat_key: string;
      lon_key: string;
      elevation: number;
      cached_at: string;
    }>(
      "SELECT lat_key, lon_key, elevation, cached_at FROM elevation_cache ORDER BY lat_key, lon_key",
    );

    const exportedAt = new Date().toISOString();
    const ts = exportedAt.replace(/[:.]/g, "-").slice(0, 19);

    const lines: string[] = [
      `-- Meshtastic Foreman — elevation cache export`,
      `-- Exported : ${exportedAt}`,
      `-- Rows     : ${rows.length}`,
      `--`,
      `-- Safe to re-import; ON CONFLICT DO UPDATE merges without deleting existing rows.`,
      ``,
    ];

    const BATCH = 500;
    for (let i = 0; i < rows.length; i += BATCH) {
      const chunk = rows.slice(i, i + BATCH);
      const values = chunk
        .map(
          (r) =>
            `  (${sqlStr(r.lat_key)}, ${sqlStr(r.lon_key)}, ${r.elevation}, ${sqlStr(String(r.cached_at))})`,
        )
        .join(",\n");
      lines.push(
        `INSERT INTO elevation_cache (lat_key, lon_key, elevation, cached_at)\nVALUES\n${values}\nON CONFLICT (lat_key, lon_key) DO UPDATE\n  SET elevation = EXCLUDED.elevation, cached_at = EXCLUDED.cached_at;\n`,
      );
    }

    return reply
      .header("Content-Disposition", `attachment; filename="elevation_cache_${ts}.sql"`)
      .type("text/plain; charset=utf-8")
      .send(lines.join("\n"));
  });

  /**
   * POST /api/elevation-cache/import
   *
   * Accepts a SQL dump (Content-Type: text/plain) produced by the export
   * endpoint and merges it into the local cache.  Returns row counts.
   */
  app.post("/api/elevation-cache/import", async (req, reply) => {
    const sql = req.body as string;
    if (!sql || typeof sql !== "string" || sql.trim().length === 0) {
      return reply.status(400).send({ error: "Expected a SQL dump as a text/plain body" });
    }

    const before = await db.query<{ n: string }>("SELECT COUNT(*) AS n FROM elevation_cache");
    const rowsBefore = Number(before.rows[0]?.n ?? 0);

    // Single transaction for speed — thousands of upserts are far faster in bulk
    await db.exec(`BEGIN;\n${sql}\nCOMMIT;`);

    const after = await db.query<{ n: string }>("SELECT COUNT(*) AS n FROM elevation_cache");
    const rowsAfter = Number(after.rows[0]?.n ?? 0);

    return { rowsBefore, rowsAfter, added: rowsAfter - rowsBefore };
  });
}
