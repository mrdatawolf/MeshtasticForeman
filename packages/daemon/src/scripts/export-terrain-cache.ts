/**
 * export-terrain-cache.ts
 *
 * Dumps the elevation_cache table to a SQL file in TD_cache/ at the project root.
 * The output is plain INSERT … ON CONFLICT statements so it can be imported on
 * any machine without wiping existing cache data.
 *
 * Usage:
 *   pnpm --filter @foreman/daemon cache:export
 *   # or from project root:
 *   pnpm cache:export
 *
 * NOTE: The daemon must NOT be running when this script executes — PGlite holds
 * an exclusive lock on the data directory.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { openDb, clearDbLock } from "../db/open.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

// All cache files live under TD_cache/ at the project root
const CACHE_DIR = resolve(__dirname, "../../../../TD_cache");

/** Safely escape a value for inclusion in a SQL string literal. */
function sqlStr(s: string): string {
  return `'${s.replace(/'/g, "''")}'`;
}

/** ISO timestamp → safe filename segment (no colons or dots). */
function fileTimestamp(): string {
  return new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
}

async function main(): Promise<void> {
  mkdirSync(CACHE_DIR, { recursive: true });

  clearDbLock();
  const db = await openDb();

  let rows: Array<{ lat_key: string; lon_key: string; elevation: number; cached_at: string }>;
  try {
    const result = await db.query<{
      lat_key: string;
      lon_key: string;
      elevation: number;
      cached_at: string;
    }>(
      "SELECT lat_key, lon_key, elevation, cached_at FROM elevation_cache ORDER BY lat_key, lon_key",
    );
    rows = result.rows;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("does not exist")) {
      console.log("[export] elevation_cache table not found — nothing to export.");
      await db.close();
      return;
    }
    throw err;
  } finally {
    await db.close();
  }

  if (rows.length === 0) {
    console.log("[export] elevation_cache is empty — nothing to export.");
    return;
  }

  // ── Build SQL file ──────────────────────────────────────────────────────────

  const exportedAt = new Date().toISOString();
  const filename = `elevation_cache_${fileTimestamp()}.sql`;
  const filePath = join(CACHE_DIR, filename);

  const lines: string[] = [
    `-- Meshtastic Foreman — elevation cache export`,
    `-- Exported : ${exportedAt}`,
    `-- Rows     : ${rows.length}`,
    `-- Import   : pnpm cache:import`,
    `--`,
    `-- Safe to re-import; uses ON CONFLICT DO UPDATE so existing rows are`,
    `-- refreshed rather than duplicated.`,
    ``,
  ];

  // Batch rows into 500-row multi-value INSERTs to keep individual statements
  // at a reasonable size while staying well within PGlite's limits.
  const BATCH_SIZE = 500;
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const chunk = rows.slice(i, i + BATCH_SIZE);
    const values = chunk
      .map(
        (r) =>
          `  (${sqlStr(r.lat_key)}, ${sqlStr(r.lon_key)}, ${r.elevation}, ${sqlStr(r.cached_at)})`,
      )
      .join(",\n");

    lines.push(
      `INSERT INTO elevation_cache (lat_key, lon_key, elevation, cached_at)\nVALUES\n${values}\nON CONFLICT (lat_key, lon_key) DO UPDATE\n  SET elevation = EXCLUDED.elevation, cached_at = EXCLUDED.cached_at;\n`,
    );
  }

  writeFileSync(filePath, lines.join("\n"), "utf8");
  console.log(`[export] Wrote ${rows.length} rows → ${filePath}`);
}

main().catch((err) => {
  console.error("[export] Fatal:", err);
  process.exit(1);
});
