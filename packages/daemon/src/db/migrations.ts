import { createLogger } from "../logger.js";

import type { PGlite } from "@electric-sql/pglite";

const log = createLogger("db");

const migrations: string[] = [
  /* 001 – initial schema */
  `
  CREATE TABLE IF NOT EXISTS devices (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    port        TEXT NOT NULL,
    hw_model    TEXT,
    firmware    TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_seen   TIMESTAMPTZ
  );

  CREATE TABLE IF NOT EXISTS nodes (
    node_id       BIGINT NOT NULL,
    device_id     TEXT NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
    long_name     TEXT,
    short_name    TEXT,
    mac_address   TEXT,
    hw_model      INT,
    public_key    TEXT,
    last_heard    TIMESTAMPTZ,
    snr           REAL,
    hops_away     INT,
    latitude      DOUBLE PRECISION,
    longitude     DOUBLE PRECISION,
    altitude      INT,
    PRIMARY KEY (node_id, device_id)
  );

  CREATE TABLE IF NOT EXISTS messages (
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

  CREATE INDEX IF NOT EXISTS messages_device_time ON messages(device_id, rx_time DESC);
  CREATE INDEX IF NOT EXISTS messages_channel ON messages(device_id, channel_index, rx_time DESC);

  CREATE TABLE IF NOT EXISTS packets (
    id            TEXT PRIMARY KEY,
    packet_id     BIGINT NOT NULL,
    device_id     TEXT NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
    from_node_id  BIGINT NOT NULL,
    to_node_id    BIGINT NOT NULL,
    channel       INT NOT NULL,
    portnum       INT NOT NULL,
    portnum_name  TEXT NOT NULL,
    rx_time       TIMESTAMPTZ NOT NULL,
    rx_snr        REAL,
    rx_rssi       INT,
    hop_limit     INT,
    hop_start     INT,
    want_ack      BOOLEAN NOT NULL DEFAULT false,
    via_mqtt      BOOLEAN NOT NULL DEFAULT false,
    payload_raw   TEXT,
    decoded_json  JSONB
  );

  CREATE INDEX IF NOT EXISTS packets_device_time ON packets(device_id, rx_time DESC);
  CREATE INDEX IF NOT EXISTS packets_portnum ON packets(device_id, portnum, rx_time DESC);

  CREATE TABLE IF NOT EXISTS channels (
    device_id   TEXT NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
    idx         INT NOT NULL,
    name        TEXT,
    role        INT NOT NULL DEFAULT 0,
    psk         TEXT,
    PRIMARY KEY (device_id, idx)
  );

  CREATE TABLE IF NOT EXISTS waypoints (
    id          BIGINT NOT NULL,
    device_id   TEXT NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
    name        TEXT NOT NULL,
    description TEXT,
    latitude    DOUBLE PRECISION NOT NULL,
    longitude   DOUBLE PRECISION NOT NULL,
    icon        INT,
    locked_to   BIGINT,
    expire      TIMESTAMPTZ,
    PRIMARY KEY (id, device_id)
  );

  CREATE TABLE IF NOT EXISTS schema_migrations (
    version INT PRIMARY KEY,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  `,

  /* 002 – mqtt_nodes: nodes discovered via regional MQTT subscription */
  `
  CREATE TABLE IF NOT EXISTS mqtt_nodes (
    node_id       BIGINT PRIMARY KEY,
    long_name     TEXT,
    short_name    TEXT,
    hw_model      INT,
    public_key    TEXT,
    last_heard    TIMESTAMPTZ,
    latitude      DOUBLE PRECISION,
    longitude     DOUBLE PRECISION,
    altitude      INT,
    last_gateway  TEXT,
    snr           REAL,
    hops_away     INT
  );
  `,

  /* 003 – add region_path to mqtt_nodes (e.g. "US/CA/Humboldt/Eureka") */
  `
  ALTER TABLE mqtt_nodes ADD COLUMN IF NOT EXISTS region_path TEXT;
  `,

  /* 004 – purge any local-mesh data that polluted mqtt_nodes before the fix;
            only rows with a region_path (set by _handleInbound) are legitimate */
  `
  DELETE FROM mqtt_nodes WHERE region_path IS NULL;
  `,

  /* 005 – node_overrides: local fallback names and positions for nodes that
            never broadcast their own location (e.g. government relays).
            Display-only — never written back to the mesh or MQTT. */
  `
  CREATE TABLE IF NOT EXISTS node_overrides (
    node_id    BIGINT PRIMARY KEY,
    alias_name TEXT,
    latitude   DOUBLE PRECISION,
    longitude  DOUBLE PRECISION,
    altitude   INT,
    notes      TEXT
  );
  `,

  /* 006 – distance_m: haversine distance in meters from our gateway to each node */
  `
  ALTER TABLE mqtt_nodes ADD COLUMN IF NOT EXISTS distance_m DOUBLE PRECISION;
  `,

  /* 007 – device radio/module config: store the full Meshtastic Config and
            ModuleConfig protobufs as JSONB, keyed by section name.
            e.g. radio_config = { "lora": {...}, "device": {...}, ... }
                 module_config = { "mqtt": {...}, "telemetry": {...}, ... } */
  `
  ALTER TABLE devices ADD COLUMN IF NOT EXISTS radio_config  JSONB;
  ALTER TABLE devices ADD COLUMN IF NOT EXISTS module_config JSONB;
  `,

  /* 008 – hw_models: hardware model number → canonical enum name, populated by
            fetching the upstream Meshtastic protobufs repo.  fetched_at tracks
            when the last successful sync happened so we can throttle re-fetches. */
  `
  CREATE TABLE IF NOT EXISTS hw_models (
    model_num  INT PRIMARY KEY,
    name       TEXT NOT NULL,
    fetched_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  `,

  /* 009 – message role tracking: distinguish received, sent, and relayed messages.
            text is made nullable to support encrypted relay packets where we cannot
            decode the payload.  An index on role speeds up per-direction queries. */
  `
  ALTER TABLE messages ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'received';
  ALTER TABLE messages ALTER COLUMN text DROP NOT NULL;
  CREATE INDEX IF NOT EXISTS messages_role ON messages(device_id, role, rx_time DESC);
  `,

  /* 010 – ACK tracking for sent messages.
            ack_status is only populated for role='sent' messages where wantAck=true:
              'pending' = sent, waiting for delivery confirmation
              'acked'   = recipient confirmed receipt
              'error'   = NACK received (see ack_error for reason, e.g. "NO_ROUTE")
            ack_at is when the ACK/NACK arrived; ack_error holds the Routing_Error name. */
  `
  ALTER TABLE messages ADD COLUMN IF NOT EXISTS ack_status TEXT;
  ALTER TABLE messages ADD COLUMN IF NOT EXISTS ack_at    TIMESTAMPTZ;
  ALTER TABLE messages ADD COLUMN IF NOT EXISTS ack_error TEXT;
  CREATE INDEX IF NOT EXISTS messages_ack ON messages(device_id, ack_status) WHERE ack_status = 'pending';
  `,

  /* 011 – traceroutes: persisted results from mesh traceroute packets.
            from_node_id = our gateway (the device that initiated the trace).
            to_node_id   = the destination node.
            route        = intermediate hops on the outbound path (may be empty for direct).
            route_back   = intermediate hops on the return path (may be empty). */
  `
  CREATE TABLE IF NOT EXISTS traceroutes (
    id           TEXT PRIMARY KEY,
    device_id    TEXT NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
    from_node_id BIGINT NOT NULL,
    to_node_id   BIGINT NOT NULL,
    route        JSONB NOT NULL DEFAULT '[]',
    route_back   JSONB NOT NULL DEFAULT '[]',
    recorded_at  TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  CREATE INDEX IF NOT EXISTS traceroutes_device_time ON traceroutes(device_id, recorded_at DESC);
  CREATE INDEX IF NOT EXISTS traceroutes_to_node     ON traceroutes(device_id, to_node_id, recorded_at DESC);
  `,

  /* 012 – position_history: every GPS fix broadcast by any node.
            Records each POSITION_APP packet so we can replay node movement
            over time and plot trails on the map.
            speed is in m/s, ground_track is degrees (0–360), sats_in_view is
            the number of visible GNSS satellites at fix time (quality signal). */
  `
  CREATE TABLE IF NOT EXISTS position_history (
    id           TEXT PRIMARY KEY,
    device_id    TEXT NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
    node_id      BIGINT NOT NULL,
    latitude     DOUBLE PRECISION NOT NULL,
    longitude    DOUBLE PRECISION NOT NULL,
    altitude     INT,
    speed        REAL,
    ground_track REAL,
    sats_in_view INT,
    recorded_at  TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  CREATE INDEX IF NOT EXISTS position_history_node_time   ON position_history(node_id, recorded_at DESC);
  CREATE INDEX IF NOT EXISTS position_history_device_time ON position_history(device_id, recorded_at DESC);
  `,

  /* 013 – elevation_cache: persisted terrain elevation lookups.
            Keyed by lat/lon rounded to 4 decimal places (~11 m precision).
            Cached for 6 months — elevation data changes negligibly over that
            window and we want to be a good citizen to public elevation APIs. */
  `
  CREATE TABLE IF NOT EXISTS elevation_cache (
    lat_key    TEXT NOT NULL,
    lon_key    TEXT NOT NULL,
    elevation  REAL NOT NULL,
    cached_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (lat_key, lon_key)
  );
  `,

  /* 014 – viewshed_cache: persisted LOS polygon results.
            Keyed by lat/lon rounded to 2 decimal places (~1 km precision) plus
            radiusKm, so a node that hasn't moved more than ~1 km reuses the
            same polygon without re-fetching elevation or re-running the LOS
            algorithm.  Cached for 6 months. */
  `
  CREATE TABLE IF NOT EXISTS viewshed_cache (
    lat_key    TEXT NOT NULL,
    lon_key    TEXT NOT NULL,
    radius_km  REAL NOT NULL,
    geojson    TEXT NOT NULL,
    cached_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (lat_key, lon_key, radius_km)
  );
  `,

  /* 015 – mqtt_nodes: add channel_name column to store the Meshtastic channel
            name parsed from the MQTT topic (e.g. "LongFast", "MediumFast").
            Used to derive the modem preset for coverage radius estimation. */
  `ALTER TABLE mqtt_nodes ADD COLUMN IF NOT EXISTS channel_name TEXT;`,

  /* 016 – coverage_proposals: stores hypothetical node locations for
            coverage extension planning. Each proposal has its own lat/lon,
            altitude, and modem preset so the viewshed API can compute its
            coverage footprint independently of live nodes. */
  `
  CREATE TABLE IF NOT EXISTS coverage_proposals (
    id           TEXT             PRIMARY KEY DEFAULT gen_random_uuid()::text,
    name         TEXT             NOT NULL,
    lat          DOUBLE PRECISION NOT NULL,
    lon          DOUBLE PRECISION NOT NULL,
    altitude_m   INTEGER          NOT NULL DEFAULT 2,
    modem_preset INTEGER          NOT NULL DEFAULT 0,
    notes        TEXT,
    visible      BOOLEAN          NOT NULL DEFAULT TRUE,
    created_at   TIMESTAMPTZ      NOT NULL DEFAULT now()
  );
  `,

  /* 017 – mqtt_json_packets: raw JSON packets received from the MQTT broker
            on 2/json topics. Nodes that have MQTT JSON mode enabled publish
            decoded packets here instead of encrypted ServiceEnvelopes.
            payload is stored as JSONB keyed by type (position, telemetry,
            text, nodeinfo, etc.) for flexible future querying. */
  `
  CREATE TABLE IF NOT EXISTS mqtt_json_packets (
    id           TEXT             PRIMARY KEY DEFAULT gen_random_uuid()::text,
    packet_id    BIGINT,
    from_node    BIGINT           NOT NULL,
    to_node      BIGINT,
    sender       TEXT,
    channel      INT,
    type         TEXT,
    payload      JSONB,
    rssi         INT,
    snr          REAL,
    hops_away    INT,
    hop_start    INT,
    region_path  TEXT,
    channel_name TEXT,
    gateway_id   TEXT,
    rx_time      TIMESTAMPTZ      NOT NULL DEFAULT now(),
    inserted_at  TIMESTAMPTZ      NOT NULL DEFAULT now()
  );
  CREATE INDEX IF NOT EXISTS mqtt_json_packets_from_time  ON mqtt_json_packets(from_node, rx_time DESC);
  CREATE INDEX IF NOT EXISTS mqtt_json_packets_type_time  ON mqtt_json_packets(type, rx_time DESC);
  `,

  /* 018 – reply threading: tracks which packet a message is replying to.
            The Meshtastic MeshPacket protobuf carries a reply_id field (field 23)
            that the official apps populate when a user replies to a specific message.
            Stored as 0 when no reply (older firmware, non-reply messages). */
  `
  ALTER TABLE messages ADD COLUMN IF NOT EXISTS reply_to_packet_id BIGINT NOT NULL DEFAULT 0;
  CREATE INDEX IF NOT EXISTS messages_reply ON messages(device_id, reply_to_packet_id) WHERE reply_to_packet_id != 0;
  `,

  /* 019 – retention sweep indexes for telemetry and terrain cache pruning */
  `
  CREATE INDEX IF NOT EXISTS packets_portnum_name_time ON packets(portnum_name, rx_time);
  CREATE INDEX IF NOT EXISTS elevation_cache_cached_at ON elevation_cache(cached_at);
  CREATE INDEX IF NOT EXISTS viewshed_cache_cached_at ON viewshed_cache(cached_at);
  `,
];

export async function runMigrations(db: PGlite) {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);

  const { rows } = await db.query<{ version: number }>(
    "SELECT version FROM schema_migrations ORDER BY version",
  );
  const applied = new Set(rows.map((r) => r.version));

  for (let i = 0; i < migrations.length; i++) {
    const version = i + 1;
    if (applied.has(version)) continue;

    log.info({ operation: "apply-migration", version }, "applying migration");
    await db.transaction(async (tx) => {
      await tx.exec(migrations[i]);
      await tx.query("INSERT INTO schema_migrations(version) VALUES ($1)", [version]);
    });
  }
}
