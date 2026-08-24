/**
 * import-terrain-cache.ts
 *
 * Imports an elevation cache SQL file into the local PGlite database.
 * Merges with existing data — rows are upserted, nothing is deleted.
 *
 * Usage:
 *   pnpm --filter @foreman/daemon cache:import                   # latest file in TD_cache/
 *   pnpm --filter @foreman/daemon cache:import TD_cache/file.sql # specific file
 *   # or from project root:
 *   pnpm cache:import [file]
 *
 * NOTE: The daemon must NOT be running when this script executes — PGlite holds
 * an exclusive lock on the data directory.
 */

import { readFileSync, readdirSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { runMigrations } from "../db/migrations.js";
import { openDb, clearDbLock } from "../db/open.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CACHE_DIR = resolve(__dirname, "../../../../TD_cache");

function resolveImportFile(): string {
  // Explicit path passed as CLI argument
  if (process.argv[2]) {
    return resolve(process.argv[2]);
  }

  // Otherwise pick the most recent export in TD_cache/
  let entries: string[];
  try {
    entries = readdirSync(CACHE_DIR);
  } catch {
    console.error(`[import] TD_cache/ directory not found at ${CACHE_DIR}`);
    console.error(`[import] Run 'pnpm cache:export' first, or pass an explicit file path.`);
    process.exit(1);
  }

  const candidates = entries
    .filter((f) => f.startsWith("elevation_cache_") && f.endsWith(".sql"))
    .sort()
    .reverse();

  if (candidates.length === 0) {
    console.error(`[import] No elevation_cache_*.sql files found in ${CACHE_DIR}`);
    console.error(`[import] Run 'pnpm cache:export' first, or pass an explicit file path.`);
    process.exit(1);
  }

  return join(CACHE_DIR, candidates[0]);
}

async function main(): Promise<void> {
  const filePath = resolveImportFile();
  console.log(`[import] Reading: ${filePath}`);

  let sql: string;
  try {
    sql = readFileSync(filePath, "utf8");
  } catch (err) {
    console.error(`[import] Could not read file: ${err}`);
    process.exit(1);
  }

  clearDbLock();
  const db = await openDb();

  // Ensure schema is up to date before importing
  await runMigrations(db as Parameters<typeof runMigrations>[0]);

  // Count rows before import so we can report how many were added / updated
  const before = await db.query<{ n: string }>("SELECT COUNT(*) AS n FROM elevation_cache");
  const rowsBefore = Number(before.rows[0]?.n ?? 0);

  console.log(`[import] Rows before: ${rowsBefore}`);
  console.log(`[import] Executing import…`);

  // Wrap the whole file in a transaction for speed (thousands of individual
  // upserts are dramatically faster inside a single transaction).
  await db.exec(`BEGIN;\n${sql}\nCOMMIT;`);

  const after = await db.query<{ n: string }>("SELECT COUNT(*) AS n FROM elevation_cache");
  const rowsAfter = Number(after.rows[0]?.n ?? 0);

  await db.close();

  const added = rowsAfter - rowsBefore;
  console.log(`[import] Done. Rows after: ${rowsAfter} (${added >= 0 ? "+" : ""}${added} net new)`);
}

main().catch((err) => {
  console.error("[import] Fatal:", err);
  process.exit(1);
});
