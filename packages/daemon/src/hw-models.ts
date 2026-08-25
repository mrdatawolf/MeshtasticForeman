import { createLogger } from "./logger.js";

import type { PGlite } from "@electric-sql/pglite";

const log = createLogger("hw-models");

const PROTO_URL =
  "https://raw.githubusercontent.com/meshtastic/protobufs/master/meshtastic/mesh.proto";

const REFRESH_MS = 72 * 60 * 60 * 1000; // 72 hours

/**
 * Fetch the HardwareModel enum from the upstream Meshtastic protobufs repo
 * and upsert every entry into the hw_models table.
 *
 * Skips the fetch entirely if the table was last populated within 72 hours.
 * Called in the background at daemon startup — never blocks the HTTP server.
 */
export async function syncHwModels(db: PGlite): Promise<void> {
  // Check age of last successful fetch
  const { rows } = await db.query<{ last_fetched: string | null }>(
    "SELECT MAX(fetched_at) AS last_fetched FROM hw_models",
  );
  const lastFetched = rows[0]?.last_fetched ? new Date(rows[0].last_fetched) : null;
  const ageMs = lastFetched ? Date.now() - lastFetched.getTime() : Infinity;

  if (ageMs < REFRESH_MS) {
    const ageH = Math.round(ageMs / 3_600_000);
    log.info(
      { operation: "sync", tableAgeHours: ageH, refreshWindowHours: 72 },
      "hardware model table is fresh; skipping fetch",
    );
    return;
  }

  log.info({ operation: "fetch" }, "fetching hardware models");
  try {
    const res = await fetch(PROTO_URL);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const text = await res.text();

    // Extract the HardwareModel enum block, then parse every "NAME = NUMBER;" line
    const block = text.match(/enum HardwareModel\s*\{([^}]+)\}/)?.[1] ?? "";
    const entries: Array<[number, string]> = [];
    for (const line of block.split("\n")) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(\d+)\s*;/);
      if (m) entries.push([Number(m[2]), m[1]]);
    }

    if (entries.length === 0) throw new Error("Parsed 0 entries — proto format may have changed");

    const now = new Date().toISOString();
    await db.transaction(async (tx) => {
      for (const [num, name] of entries) {
        await tx.query(
          `INSERT INTO hw_models(model_num, name, fetched_at)
           VALUES ($1, $2, $3)
           ON CONFLICT(model_num) DO UPDATE
             SET name = EXCLUDED.name, fetched_at = EXCLUDED.fetched_at`,
          [num, name, now],
        );
      }
    });

    log.info({ operation: "sync", modelCount: entries.length }, "hardware models synced");
  } catch (err: unknown) {
    log.warn({ operation: "sync", err }, "hardware model sync failed; will retry when stale");
  }
}

/** Return the full hw_models table as a plain number→name map. */
export async function getHwModels(db: PGlite): Promise<Record<number, string>> {
  const { rows } = await db.query<{ model_num: number; name: string }>(
    "SELECT model_num, name FROM hw_models ORDER BY model_num",
  );
  const result: Record<number, string> = {};
  for (const r of rows) result[r.model_num] = r.name;
  return result;
}
