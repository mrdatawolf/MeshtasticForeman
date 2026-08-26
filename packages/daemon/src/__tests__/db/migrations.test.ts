import { PGlite } from "@electric-sql/pglite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { runMigrations } from "../../db/migrations.js";

const LATEST_MIGRATION_VERSION = 19;

type MigrationRow = { version: number };

async function migrationVersions(db: PGlite) {
  const { rows } = await db.query<MigrationRow>(
    "SELECT version FROM schema_migrations ORDER BY version",
  );
  return rows.map(({ version }) => version);
}

async function tableExists(db: PGlite, tableName: string) {
  const { rows } = await db.query<{ exists: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name = $1
     ) AS exists`,
    [tableName],
  );
  return rows[0].exists;
}

async function columnExists(db: PGlite, tableName: string, columnName: string) {
  const { rows } = await db.query<{ exists: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = $1 AND column_name = $2
     ) AS exists`,
    [tableName, columnName],
  );
  return rows[0].exists;
}

async function indexExists(db: PGlite, indexName: string) {
  const { rows } = await db.query<{ exists: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = $1
     ) AS exists`,
    [indexName],
  );
  return rows[0].exists;
}

async function expectLatestSchema(db: PGlite) {
  expect(await migrationVersions(db)).toEqual(
    Array.from({ length: LATEST_MIGRATION_VERSION }, (_, index) => index + 1),
  );

  await expect(tableExists(db, "devices")).resolves.toBe(true);
  await expect(tableExists(db, "mqtt_nodes")).resolves.toBe(true);
  await expect(tableExists(db, "traceroutes")).resolves.toBe(true);
  await expect(tableExists(db, "mqtt_json_packets")).resolves.toBe(true);
  await expect(columnExists(db, "mqtt_nodes", "region_path")).resolves.toBe(true);
  await expect(columnExists(db, "mqtt_nodes", "distance_m")).resolves.toBe(true);
  await expect(columnExists(db, "mqtt_nodes", "channel_name")).resolves.toBe(true);
  await expect(columnExists(db, "messages", "reply_to_packet_id")).resolves.toBe(true);
  await expect(indexExists(db, "packets_portnum_name_time")).resolves.toBe(true);
  await expect(indexExists(db, "elevation_cache_cached_at")).resolves.toBe(true);
  await expect(indexExists(db, "viewshed_cache_cached_at")).resolves.toBe(true);
}

async function applyVersionOneFixture(db: PGlite) {
  await db.exec(`
    CREATE TABLE devices (
      id          TEXT PRIMARY KEY,
      name        TEXT NOT NULL,
      port        TEXT NOT NULL,
      hw_model    TEXT,
      firmware    TEXT,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
      last_seen   TIMESTAMPTZ
    );

    CREATE TABLE messages (
      id            TEXT PRIMARY KEY,
      packet_id     BIGINT NOT NULL,
      device_id     TEXT NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
      from_node_id  BIGINT NOT NULL,
      to_node_id    BIGINT NOT NULL,
      channel_index INT NOT NULL DEFAULT 0,
      text          TEXT NOT NULL,
      rx_time       TIMESTAMPTZ NOT NULL,
      rx_snr        REAL,
      rx_rssi       INT,
      hop_limit     INT,
      want_ack      BOOLEAN NOT NULL DEFAULT false,
      via_mqtt      BOOLEAN NOT NULL DEFAULT false
    );

    CREATE TABLE packets (
      id            TEXT PRIMARY KEY,
      packet_id     BIGINT NOT NULL,
      device_id     TEXT NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
      from_node_id  BIGINT NOT NULL,
      to_node_id    BIGINT NOT NULL,
      channel       INT NOT NULL,
      portnum       INT NOT NULL,
      portnum_name  TEXT NOT NULL,
      rx_time       TIMESTAMPTZ NOT NULL
    );

    CREATE TABLE schema_migrations (
      version INT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    INSERT INTO schema_migrations(version) VALUES (1);
  `);
}

describe("database migrations", () => {
  let db: PGlite;

  beforeEach(() => {
    db = new PGlite();
  });

  afterEach(async () => {
    await db.close();
  });

  it("migrates an empty database to the latest schema", async () => {
    await expect(runMigrations(db)).resolves.toBeUndefined();
    await expectLatestSchema(db);
  });

  it("migrates a representative version-1 schema to the latest schema", async () => {
    await applyVersionOneFixture(db);

    await expect(runMigrations(db)).resolves.toBeUndefined();

    await expectLatestSchema(db);
  });

  it("is idempotent when run against an already-migrated database", async () => {
    await runMigrations(db);
    const versionsAfterFirstRun = await migrationVersions(db);

    await expect(runMigrations(db)).resolves.toBeUndefined();
    const versionsAfterSecondRun = await migrationVersions(db);

    expect(versionsAfterFirstRun).toHaveLength(LATEST_MIGRATION_VERSION);
    expect(versionsAfterSecondRun).toEqual(versionsAfterFirstRun);
    expect(new Set(versionsAfterSecondRun).size).toBe(LATEST_MIGRATION_VERSION);
  });

  it("rolls back schema changes and the version record when a migration transaction fails", async () => {
    await runMigrations(db);

    await expect(
      db.transaction(async (tx) => {
        await tx.exec(`
          CREATE TABLE tx_test_rollback (id INT);
          THIS IS DELIBERATELY INVALID SQL;
        `);
        await tx.query("INSERT INTO schema_migrations(version) VALUES ($1)", [999]);
      }),
    ).rejects.toThrow();

    await expect(tableExists(db, "tx_test_rollback")).resolves.toBe(false);
    const { rows } = await db.query<{ count: number }>(
      "SELECT COUNT(*)::int AS count FROM schema_migrations WHERE version = 999",
    );
    expect(rows[0].count).toBe(0);
  });

  it("produces a schema usable for related device and message records", async () => {
    await runMigrations(db);
    await db.query("INSERT INTO devices(id, name, port) VALUES ($1, $2, $3)", [
      "device-1",
      "Test Device",
      "/dev/test",
    ]);
    await db.query(
      `INSERT INTO messages(
         id, packet_id, device_id, from_node_id, to_node_id, text, rx_time, reply_to_packet_id
       ) VALUES ($1, $2, $3, $4, $5, $6, now(), $7)`,
      ["message-1", 1001, "device-1", 10, 20, "hello", 900],
    );

    const { rows } = await db.query<{
      device_name: string;
      text: string;
      reply_to_packet_id: number;
    }>(`
      SELECT d.name AS device_name, m.text, m.reply_to_packet_id
      FROM messages m
      JOIN devices d ON d.id = m.device_id
    `);
    expect(rows).toEqual([{ device_name: "Test Device", text: "hello", reply_to_packet_id: 900 }]);
  });
});
