import { PGlite } from "@electric-sql/pglite";
import Fastify from "fastify";

import { runMigrations } from "../../db/migrations.js";
import { registerAnalyticsRoutes } from "../../routes/analytics.js";

export const DEVICE_A = "00000000-0000-0000-0000-000000000001";
export const DEVICE_B = "00000000-0000-0000-0000-000000000002";
export const MISSING_DEVICE = "00000000-0000-0000-0000-000000000099";

let sequence = 0;

export async function createAnalyticsFixture() {
  sequence = 0;
  const db = new PGlite();
  await runMigrations(db);
  const app = Fastify({ logger: false });
  await registerAnalyticsRoutes(app, db);
  await app.ready();
  return { app, db };
}

export async function seedDevice(db: PGlite, id: string, name = `Device ${id.slice(-1)}`) {
  await db.query("INSERT INTO devices(id, name, port) VALUES ($1, $2, $3)", [
    id,
    name,
    `/dev/test-${id.slice(-1)}`,
  ]);
}

export async function seedNode(
  db: PGlite,
  values: {
    nodeId: number;
    deviceId?: string;
    hopsAway?: number | null;
    hwModel?: number | null;
    snr?: number | null;
  },
) {
  await db.query(
    `INSERT INTO nodes(node_id, device_id, long_name, short_name, hw_model, last_heard, snr, hops_away)
     VALUES ($1, $2, $3, $4, $5, now(), $6, $7)`,
    [
      values.nodeId,
      values.deviceId ?? DEVICE_A,
      `Node ${values.nodeId}`,
      `N${values.nodeId}`,
      values.hwModel ?? null,
      values.snr ?? null,
      values.hopsAway ?? null,
    ],
  );
}

export async function seedMessage(
  db: PGlite,
  values: {
    deviceId?: string;
    fromNodeId?: number;
    toNodeId?: number;
    channelIndex?: number;
    rxTime: string;
    role?: "received" | "sent" | "relayed";
    wantAck?: boolean;
    ackStatus?: "acked" | "pending" | "error" | null;
    ackAt?: string | null;
    ackError?: string | null;
    text?: string | null;
  },
) {
  const n = ++sequence;
  await db.query(
    `INSERT INTO messages(
       id, packet_id, device_id, from_node_id, to_node_id, channel_index, text,
       rx_time, want_ack, role, ack_status, ack_at, ack_error
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
    [
      `message-${n}`,
      10_000 + n,
      values.deviceId ?? DEVICE_A,
      values.fromNodeId ?? 101,
      values.toNodeId ?? 202,
      values.channelIndex ?? 2,
      values.text === undefined ? `message ${n}` : values.text,
      values.rxTime,
      values.wantAck ?? false,
      values.role ?? "received",
      values.ackStatus ?? null,
      values.ackAt ?? null,
      values.ackError ?? null,
    ],
  );
  return `message-${n}`;
}

export async function seedPacket(
  db: PGlite,
  values: {
    id?: string;
    packetId?: number;
    deviceId?: string;
    fromNodeId?: number;
    toNodeId?: number;
    channel?: number;
    portnum?: number;
    portnumName?: string;
    rxTime: string;
    rxSnr?: number | null;
    rxRssi?: number | null;
    hopLimit?: number | null;
    hopStart?: number | null;
    viaMqtt?: boolean;
    decodedJson?: unknown;
  },
) {
  const n = ++sequence;
  const id = values.id ?? `packet-${n}`;
  await db.query(
    `INSERT INTO packets(
       id, packet_id, device_id, from_node_id, to_node_id, channel, portnum,
       portnum_name, rx_time, rx_snr, rx_rssi, hop_limit, hop_start, via_mqtt, decoded_json
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
    [
      id,
      values.packetId ?? 20_000 + n,
      values.deviceId ?? DEVICE_A,
      values.fromNodeId ?? 101,
      values.toNodeId ?? 202,
      values.channel ?? 2,
      values.portnum ?? 1,
      values.portnumName ?? "TEXT_MESSAGE_APP",
      values.rxTime,
      values.rxSnr ?? null,
      values.rxRssi ?? null,
      values.hopLimit ?? null,
      values.hopStart ?? null,
      values.viaMqtt ?? false,
      values.decodedJson === undefined ? null : JSON.stringify(values.decodedJson),
    ],
  );
  return id;
}

export async function seedPosition(
  db: PGlite,
  values: {
    id: string;
    deviceId?: string;
    nodeId: number;
    latitude: number;
    longitude: number;
    altitude?: number | null;
    speed?: number | null;
    groundTrack?: number | null;
    satsInView?: number | null;
    recordedAt: string;
  },
) {
  await db.query(
    `INSERT INTO position_history(
       id, device_id, node_id, latitude, longitude, altitude, speed,
       ground_track, sats_in_view, recorded_at
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [
      values.id,
      values.deviceId ?? DEVICE_A,
      values.nodeId,
      values.latitude,
      values.longitude,
      values.altitude ?? null,
      values.speed ?? null,
      values.groundTrack ?? null,
      values.satsInView ?? null,
      values.recordedAt,
    ],
  );
}

export function truncateIso(iso: string, unit: "minute" | "hour" | "day" | "fiveMinutes") {
  const date = new Date(iso);
  date.setUTCSeconds(0, 0);
  if (unit === "hour" || unit === "day") date.setUTCMinutes(0);
  if (unit === "day") date.setUTCHours(0);
  if (unit === "fiveMinutes") date.setUTCMinutes(Math.floor(date.getUTCMinutes() / 5) * 5);
  return date.toISOString();
}
