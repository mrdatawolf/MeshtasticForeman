import { createLogger } from "../../logger.js";

import type { DaemonConfig } from "../../config.js";
import type { PGlite } from "@electric-sql/pglite";

const log = createLogger("retention");
const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

type RetentionConfig = DaemonConfig["retention"];

export interface RetentionSweepHandle {
  stop(): void;
}

export async function runRetentionSweep(
  db: PGlite,
  config: RetentionConfig,
  now = new Date(),
): Promise<void> {
  if (!config.enabled) return;

  await prunePackets(db, config.packets.maxRowsPerDevice);
  await pruneTelemetry(db, new Date(now.getTime() - config.telemetry.windowDays * DAY_MS));
  await pruneCache(db, new Date(now.getTime() - config.cache.windowDays * DAY_MS));
}

export function startRetentionSweep(
  db: PGlite,
  config: RetentionConfig,
): RetentionSweepHandle | null {
  if (!config.enabled) return null;

  const intervalMs = config.sweepIntervalHours * HOUR_MS;
  const timer = setInterval(() => {
    void runRetentionSweep(db, config).catch((err) => {
      log.error({ operation: "sweep", err }, "unexpected retention sweep failure");
    });
  }, intervalMs);

  log.info(
    { operation: "schedule", intervalHours: config.sweepIntervalHours },
    "retention sweep scheduled",
  );
  return { stop: () => clearInterval(timer) };
}

async function prunePackets(db: PGlite, maxRowsPerDevice: number): Promise<void> {
  let deviceIds: string[];
  try {
    const { rows } = await db.query<{ device_id: string }>(
      "SELECT DISTINCT device_id FROM packets ORDER BY device_id",
    );
    deviceIds = rows.map((row) => row.device_id);
  } catch (err) {
    log.error({ operation: "prune", category: "packets", err }, "packet pruning failed");
    return;
  }

  let totalRowsRemoved = 0;
  for (const deviceId of deviceIds) {
    try {
      const rowsRemoved = await db.transaction(async (tx) => {
        const { rows } = await tx.query<{ id: string }>(
          `DELETE FROM packets
           WHERE id IN (
             SELECT id FROM packets
             WHERE device_id = $1
             ORDER BY rx_time DESC, id DESC
             OFFSET $2
           )
           RETURNING id`,
          [deviceId, maxRowsPerDevice],
        );
        return rows.length;
      });
      totalRowsRemoved += rowsRemoved;
      log.info(
        { operation: "prune", category: "packets", deviceId, rowsRemoved },
        "packet retention sweep complete",
      );
    } catch (err) {
      log.error(
        { operation: "prune", category: "packets", deviceId, err },
        "packet pruning failed",
      );
    }
  }

  log.info(
    { operation: "prune", category: "packets", rowsRemoved: totalRowsRemoved },
    "packet retention category complete",
  );
}

async function pruneTelemetry(db: PGlite, cutoff: Date): Promise<void> {
  try {
    const rowsRemoved = await db.transaction(async (tx) => {
      const { rows } = await tx.query<{ id: string }>(
        `DELETE FROM packets
         WHERE portnum_name = 'TELEMETRY_APP' AND rx_time < $1
         RETURNING id`,
        [cutoff.toISOString()],
      );
      return rows.length;
    });
    log.info(
      { operation: "prune", category: "telemetry", cutoff, rowsRemoved },
      "telemetry retention sweep complete",
    );
  } catch (err) {
    log.error(
      { operation: "prune", category: "telemetry", cutoff, err },
      "telemetry pruning failed",
    );
  }
}

async function pruneCache(db: PGlite, cutoff: Date): Promise<void> {
  try {
    const result = await db.transaction(async (tx) => {
      const elevation = await tx.query<{ lat_key: string }>(
        "DELETE FROM elevation_cache WHERE cached_at < $1 RETURNING lat_key",
        [cutoff.toISOString()],
      );
      const viewshed = await tx.query<{ lat_key: string }>(
        "DELETE FROM viewshed_cache WHERE cached_at < $1 RETURNING lat_key",
        [cutoff.toISOString()],
      );
      return {
        elevationRowsRemoved: elevation.rows.length,
        viewshedRowsRemoved: viewshed.rows.length,
      };
    });
    log.info(
      {
        operation: "prune",
        category: "cache",
        cutoff,
        ...result,
        rowsRemoved: result.elevationRowsRemoved + result.viewshedRowsRemoved,
      },
      "cache retention sweep complete",
    );
  } catch (err) {
    log.error({ operation: "prune", category: "cache", cutoff, err }, "cache pruning failed");
  }
}
