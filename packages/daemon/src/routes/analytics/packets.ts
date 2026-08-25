import { z } from "zod";

import { deviceIdSchema, limitSchema, offsetSchema, sendValidationError } from "../schemas.js";

import { buildFilters, parseSince } from "./shared.js";

import type { PGlite } from "@electric-sql/pglite";
import type { FastifyInstance } from "fastify";

const packetQuerySchema = z.object({
  since: z.string().default("24h"),
  deviceId: deviceIdSchema.optional(),
});
const packetTimelineQuerySchema = packetQuerySchema.extend({
  bucket: z.enum(["minute", "hour"]).default("hour"),
});
const packetLogFiltersSchema = packetQuerySchema.extend({ portnum: z.string().optional() });
const packetLogQuerySchema = packetLogFiltersSchema.extend({
  limit: limitSchema(5_000, 500),
  offset: offsetSchema(5_000),
});

type PacketLogRow = {
  id: string;
  packet_id: string;
  device_id: string;
  from_node_id: string;
  to_node_id: string;
  portnum_name: string;
  rx_time: string;
  rx_snr: number | null;
  rx_rssi: number | null;
  hop_limit: number | null;
  hop_start: number | null;
  via_mqtt: boolean;
};

export function buildPortnumBreakdownQuery(opts: { since?: string; deviceId?: string }) {
  const { where, params } = buildFilters(opts);
  return {
    sql: `SELECT portnum_name, COUNT(*) AS count FROM packets ${where}
    GROUP BY portnum_name ORDER BY 2 DESC`,
    params,
  };
}

export function buildPacketTimelineQuery(opts: {
  since?: string;
  deviceId?: string;
  bucket: "minute" | "hour";
}) {
  const { where, params } = buildFilters(opts);
  return {
    sql: `SELECT date_trunc('${opts.bucket}', rx_time) AS ts, portnum_name,
    COUNT(*) AS count FROM packets ${where} GROUP BY 1, 2 ORDER BY 1 ASC, 2 ASC`,
    params,
  };
}

export function buildPacketLogQuery(opts: {
  since?: string;
  deviceId?: string;
  portnum?: string;
  limit: number;
  offset: number;
}) {
  const conditions: string[] = [];
  const params: unknown[] = [];
  const sinceDate = parseSince(opts.since);
  if (sinceDate) {
    params.push(sinceDate.toISOString());
    conditions.push(`rx_time >= $${params.length}`);
  }
  if (opts.deviceId) {
    params.push(opts.deviceId);
    conditions.push(`device_id = $${params.length}`);
  }
  if (opts.portnum) {
    params.push(opts.portnum);
    conditions.push(`portnum_name = $${params.length}`);
  }
  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  params.push(opts.limit, opts.offset);
  return {
    sql: `SELECT id, packet_id, device_id, from_node_id, to_node_id,
    portnum_name, rx_time, rx_snr, rx_rssi, hop_limit, hop_start, via_mqtt
    FROM packets ${where} ORDER BY rx_time DESC
    LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  };
}

export async function registerPacketsRoutes(app: FastifyInstance, db: PGlite) {
  app.get("/api/analytics/portnum-breakdown", async (req, reply) => {
    const result = packetQuerySchema.safeParse(req.query);
    if (!result.success) return sendValidationError(reply, result.error);
    const { since, deviceId } = result.data;
    const q = buildPortnumBreakdownQuery({ since, deviceId });
    const { rows } = await db.query<{ portnum_name: string; count: string }>(q.sql, q.params);
    return rows.map((r) => ({ portnumName: r.portnum_name, count: Number(r.count) }));
  });
  app.get("/api/analytics/packet-timeline", async (req, reply) => {
    const result = packetTimelineQuerySchema.safeParse(req.query);
    if (!result.success) return sendValidationError(reply, result.error);
    const { since, bucket, deviceId } = result.data;
    const q = buildPacketTimelineQuery({ since, deviceId, bucket });
    const { rows } = await db.query<{ ts: string; portnum_name: string; count: string }>(
      q.sql,
      q.params,
    );
    const byTs = new Map<string, { ts: string; counts: Record<string, number>; total: number }>();
    for (const r of rows) {
      const ts = new Date(r.ts).toISOString();
      if (!byTs.has(ts)) byTs.set(ts, { ts, counts: {}, total: 0 });
      const entry = byTs.get(ts)!;
      const n = Number(r.count);
      entry.counts[r.portnum_name] = (entry.counts[r.portnum_name] ?? 0) + n;
      entry.total += n;
    }
    return [...byTs.values()].sort((a, b) => a.ts.localeCompare(b.ts));
  });
  app.get("/api/analytics/packet-log", async (req, reply) => {
    const result = packetLogQuerySchema.safeParse(req.query);
    if (!result.success) return sendValidationError(reply, result.error);
    const { since, deviceId, portnum, limit, offset } = result.data;
    const q = buildPacketLogQuery({ since, deviceId, portnum, limit, offset });
    const { rows } = await db.query<PacketLogRow>(q.sql, q.params);
    return rows.map((r) => ({
      id: r.id,
      packetId: Number(r.packet_id),
      deviceId: r.device_id,
      fromNodeId: Number(r.from_node_id),
      toNodeId: Number(r.to_node_id),
      portnumName: r.portnum_name,
      rxTime: new Date(r.rx_time).toISOString(),
      rxSnr: r.rx_snr ?? null,
      rxRssi: r.rx_rssi ?? null,
      hopLimit: r.hop_limit ?? null,
      hopStart: r.hop_start ?? null,
      viaMqtt: r.via_mqtt,
    }));
  });
  app.get("/api/analytics/packet-log.csv", async (req, reply) => {
    const result = packetLogFiltersSchema.safeParse(req.query);
    if (!result.success) return sendValidationError(reply, result.error);
    const { since, deviceId, portnum } = result.data;
    const q = buildPacketLogQuery({ since, deviceId, portnum, limit: 50_000, offset: 0 });
    const { rows } = await db.query<PacketLogRow>(q.sql, q.params);
    const header =
      "id,packetId,deviceId,fromNodeId,toNodeId,portnumName,rxTime,rxSnr,rxRssi,hopLimit,hopStart,viaMqtt\n";
    const body = rows
      .map((r) =>
        [
          r.id,
          r.packet_id,
          r.device_id,
          r.from_node_id,
          r.to_node_id,
          r.portnum_name,
          new Date(r.rx_time).toISOString(),
          r.rx_snr ?? "",
          r.rx_rssi ?? "",
          r.hop_limit ?? "",
          r.hop_start ?? "",
          r.via_mqtt ? "true" : "false",
        ].join(","),
      )
      .join("\n");
    reply.header("Content-Type", "text/csv");
    reply.header("Content-Disposition", `attachment; filename="packet-log-${since}.csv"`);
    return header + body;
  });
}
