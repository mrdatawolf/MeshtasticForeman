import { buildFilters, parseSince } from "./shared.js";

import type { PGlite } from "@electric-sql/pglite";
import type { FastifyInstance } from "fastify";

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
  app.get("/api/analytics/portnum-breakdown", async (req) => {
    const { since = "24h", deviceId } = req.query as { since?: string; deviceId?: string };
    const q = buildPortnumBreakdownQuery({ since, deviceId });
    const { rows } = await db.query<{ portnum_name: string; count: string }>(q.sql, q.params);
    return rows.map((r) => ({ portnumName: r.portnum_name, count: Number(r.count) }));
  });
  app.get("/api/analytics/packet-timeline", async (req, reply) => {
    const {
      since = "24h",
      bucket = "hour",
      deviceId,
    } = req.query as { since?: string; bucket?: string; deviceId?: string };
    if (bucket !== "minute" && bucket !== "hour")
      return reply.status(400).send({ error: "bucket must be 'minute' or 'hour'" });
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
  app.get("/api/analytics/packet-log", async (req) => {
    const {
      since = "24h",
      deviceId,
      portnum,
      limit: lStr,
      offset: oStr,
    } = req.query as {
      since?: string;
      deviceId?: string;
      portnum?: string;
      limit?: string;
      offset?: string;
    };
    const limit = Math.min(5_000, Math.max(1, parseInt(lStr ?? "500", 10) || 500));
    const offset = Math.max(0, parseInt(oStr ?? "0", 10) || 0);
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
    const {
      since = "24h",
      deviceId,
      portnum,
    } = req.query as { since?: string; deviceId?: string; portnum?: string };
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
