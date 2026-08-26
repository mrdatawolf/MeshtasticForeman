import { PGlite } from "@electric-sql/pglite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ActivityLog } from "../../activity/log.js";
import { runMigrations } from "../../db/migrations.js";
import { runRetentionSweep, startRetentionSweep } from "../../db/repositories/retention.js";

import type { DaemonConfig } from "../../config.js";

const NOW = new Date("2026-08-26T12:00:00.000Z");

function retentionConfig(
  overrides: Partial<DaemonConfig["retention"]> = {},
): DaemonConfig["retention"] {
  return {
    enabled: true,
    sweepIntervalHours: 24,
    packets: { maxRowsPerDevice: 100000 },
    telemetry: { windowDays: 365 },
    cache: { windowDays: 180 },
    ...overrides,
  };
}

async function addDevice(db: PGlite, id: string) {
  await db.query("INSERT INTO devices(id, name, port) VALUES ($1, $2, $3)", [id, id, id]);
}

async function addPacket(
  db: PGlite,
  id: string,
  deviceId: string,
  rxTime: string,
  portnumName = "TEXT_MESSAGE_APP",
) {
  await db.query(
    `INSERT INTO packets(
       id, packet_id, device_id, from_node_id, to_node_id, channel, portnum,
       portnum_name, rx_time
     ) VALUES ($1, 1, $2, 1, 2, 0, 1, $3, $4)`,
    [id, deviceId, portnumName, rxTime],
  );
}

async function countRows(db: PGlite, table: string, deviceId?: string) {
  const params = deviceId === undefined ? [] : [deviceId];
  const filter = deviceId === undefined ? "" : " WHERE device_id = $1";
  const { rows } = await db.query<{ count: number }>(
    `SELECT COUNT(*)::int AS count FROM ${table}${filter}`,
    params,
  );
  return rows[0].count;
}

describe("retention sweep", () => {
  let db: PGlite;

  beforeEach(async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    db = new PGlite();
    await runMigrations(db);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await db.close();
  });

  it("enforces the 100,000-row packet cap per device without deleting below it", async () => {
    for (const deviceId of ["exact", "one-over", "well-over"]) await addDevice(db, deviceId);
    await db.exec(`
      INSERT INTO packets(
        id, packet_id, device_id, from_node_id, to_node_id, channel, portnum,
        portnum_name, rx_time
      )
      SELECT device_id || '-' || n, n, device_id, 1, 2, 0, 1,
             'TEXT_MESSAGE_APP', '2025-01-01T00:00:00Z'::timestamptz + n * interval '1 second'
      FROM (VALUES ('exact', 100000), ('one-over', 100001), ('well-over', 100025)) limits(device_id, max_n)
      CROSS JOIN LATERAL generate_series(1, max_n) n;
    `);

    await runRetentionSweep(db, retentionConfig(), NOW);

    await expect(countRows(db, "packets", "exact")).resolves.toBe(100000);
    await expect(countRows(db, "packets", "one-over")).resolves.toBe(100000);
    await expect(countRows(db, "packets", "well-over")).resolves.toBe(100000);
    const { rows } = await db.query<{ id: string }>(
      "SELECT id FROM packets WHERE device_id = 'one-over' ORDER BY rx_time ASC LIMIT 1",
    );
    expect(rows[0].id).toBe("one-over-2");
  }, 30_000);

  it("deletes only telemetry strictly older than its cutoff", async () => {
    await addDevice(db, "telemetry");
    const cutoff = "2025-08-26T12:00:00.000Z";
    await addPacket(db, "at-cutoff", "telemetry", cutoff, "TELEMETRY_APP");
    await addPacket(db, "inside", "telemetry", "2025-08-26T12:00:00.001Z", "TELEMETRY_APP");
    await addPacket(db, "past", "telemetry", "2025-01-01T00:00:00.000Z", "TELEMETRY_APP");
    await addPacket(db, "non-telemetry-past", "telemetry", "2025-01-01T00:00:00.000Z");

    await runRetentionSweep(db, retentionConfig({ packets: { maxRowsPerDevice: 1000 } }), NOW);

    const { rows } = await db.query<{ id: string }>("SELECT id FROM packets ORDER BY id");
    expect(rows.map((row) => row.id)).toEqual(["at-cutoff", "inside", "non-telemetry-past"]);
  });

  it("deletes cache rows strictly older than the 180-day cutoff", async () => {
    const cutoff = "2026-02-27T12:00:00.000Z";
    for (const [key, cachedAt] of [
      ["at", cutoff],
      ["inside", "2026-02-27T12:00:00.001Z"],
      ["past", "2025-01-01T00:00:00.000Z"],
    ]) {
      await db.query(
        "INSERT INTO elevation_cache(lat_key, lon_key, elevation, cached_at) VALUES ($1, $1, 1, $2)",
        [key, cachedAt],
      );
      await db.query(
        `INSERT INTO viewshed_cache(lat_key, lon_key, radius_km, geojson, cached_at)
         VALUES ($1, $1, 1, '{}', $2)`,
        [key, cachedAt],
      );
    }

    await runRetentionSweep(db, retentionConfig(), NOW);

    for (const table of ["elevation_cache", "viewshed_cache"]) {
      const { rows } = await db.query<{ lat_key: string }>(
        `SELECT lat_key FROM ${table} ORDER BY lat_key`,
      );
      expect(rows.map((row) => row.lat_key)).toEqual(["at", "inside"]);
    }
  });

  it("never touches messages or in-memory activity state", async () => {
    await addDevice(db, "preserved");
    await db.query(
      `INSERT INTO messages(id, packet_id, device_id, from_node_id, to_node_id, text, rx_time)
       VALUES ('old-message', 1, 'preserved', 1, 2, 'keep', '2000-01-01T00:00:00Z')`,
    );
    const activity = new ActivityLog();
    activity.add({
      ts: "2000-01-01T00:00:00Z",
      source: "mesh",
      portnum: "TELEMETRY_APP",
      fromHex: "!00000001",
      region: null,
      gateway: null,
      viaMqtt: false,
    });

    await runRetentionSweep(db, retentionConfig(), NOW);

    await expect(countRows(db, "messages")).resolves.toBe(1);
    expect(activity.snapshot()).toHaveLength(1);
  });

  it("does no database work and starts no timer when disabled", async () => {
    await addDevice(db, "disabled");
    await addPacket(db, "old-packet", "disabled", "2000-01-01T00:00:00Z", "TELEMETRY_APP");
    await db.query(
      "INSERT INTO elevation_cache(lat_key, lon_key, elevation, cached_at) VALUES ('old', 'old', 1, '2000-01-01')",
    );
    const intervalSpy = vi.spyOn(globalThis, "setInterval");
    const disabled = retentionConfig({ enabled: false, packets: { maxRowsPerDevice: 1 } });

    await runRetentionSweep(db, disabled, NOW);
    const handle = startRetentionSweep(db, disabled);

    expect(handle).toBeNull();
    expect(intervalSpy).not.toHaveBeenCalled();
    await expect(countRows(db, "packets")).resolves.toBe(1);
    await expect(countRows(db, "elevation_cache")).resolves.toBe(1);
  });

  it("logs zero-row outcomes per packet device and category", async () => {
    await addDevice(db, "no-op");
    await addPacket(db, "retained", "no-op", NOW.toISOString());

    await runRetentionSweep(db, retentionConfig(), NOW);

    expect(console.log).toHaveBeenCalledWith(
      expect.stringContaining('"category":"packets","deviceId":"no-op","rowsRemoved":0'),
    );
    expect(console.log).toHaveBeenCalledWith(
      expect.stringContaining('"category":"packets","rowsRemoved":0'),
    );
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('"category":"telemetry"'));
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('"rowsRemoved":0'));
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('"category":"cache"'));
  });

  it("schedules the configured interval and exposes timer teardown", () => {
    const intervalSpy = vi.spyOn(globalThis, "setInterval");
    const clearSpy = vi.spyOn(globalThis, "clearInterval");

    const handle = startRetentionSweep(db, retentionConfig({ sweepIntervalHours: 6 }));
    handle?.stop();

    expect(handle).not.toBeNull();
    expect(intervalSpy).toHaveBeenCalledWith(expect.any(Function), 6 * 60 * 60 * 1000);
    expect(clearSpy).toHaveBeenCalledOnce();
  });
});
