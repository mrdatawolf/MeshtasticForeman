import { buildFilters, parseSince } from "./shared.js";

import type { PGlite } from "@electric-sql/pglite";
import type { FastifyInstance } from "fastify";

export function buildSnrHistoryQuery(opts: { since?: string; deviceId?: string; nodeId?: number }) {
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
  if (opts.nodeId !== undefined) {
    params.push(opts.nodeId);
    conditions.push(`from_node_id = $${params.length}`);
  }
  conditions.push("(rx_snr IS NOT NULL OR rx_rssi IS NOT NULL)");
  return {
    sql: `
      SELECT to_timestamp(floor(EXTRACT(epoch FROM rx_time) / 300) * 300) AS ts,
        from_node_id AS node_id, AVG(rx_snr)::REAL AS snr, AVG(rx_rssi)::REAL AS rssi,
        COUNT(*) AS count FROM packets WHERE ${conditions.join(" AND ")}
      GROUP BY 1, 2 ORDER BY 1 ASC, 2 ASC`,
    params,
  };
}

export function buildLinkQualityQuery(opts: { since?: string; deviceId?: string }) {
  const { where, params } = buildFilters(opts);
  return {
    sql: `
      SELECT from_node_id, to_node_id, AVG(rx_snr)::REAL AS avg_snr,
        COUNT(*) AS message_count FROM packets
      ${where ? where + " AND rx_snr IS NOT NULL" : "WHERE rx_snr IS NOT NULL"}
      GROUP BY from_node_id, to_node_id ORDER BY message_count DESC LIMIT 2500`,
    params,
  };
}

export async function registerSignalRoutes(app: FastifyInstance, db: PGlite) {
  app.get("/api/analytics/snr-history", async (req, reply) => {
    const {
      since = "24h",
      nodeId,
      deviceId,
    } = req.query as { since?: string; nodeId?: string; deviceId?: string };
    let parsedNodeId: number | undefined;
    if (nodeId) {
      parsedNodeId = Number(nodeId);
      if (!Number.isFinite(parsedNodeId))
        return reply.status(400).send({ error: "Invalid nodeId" });
    }
    const query = buildSnrHistoryQuery({ since, deviceId, nodeId: parsedNodeId });
    const { rows } = await db.query<{
      ts: string;
      node_id: string;
      snr: number | null;
      rssi: number | null;
      count: string;
    }>(query.sql, query.params);
    return rows.map((r) => ({
      ts: new Date(r.ts).toISOString(),
      nodeId: Number(r.node_id),
      snr: r.snr ?? null,
      rssi: r.rssi ?? null,
      count: Number(r.count),
    }));
  });

  app.get("/api/analytics/link-quality", async (req) => {
    const { since = "7d", deviceId } = req.query as { since?: string; deviceId?: string };
    const query = buildLinkQualityQuery({ since, deviceId });
    const { rows } = await db.query<{
      from_node_id: string;
      to_node_id: string;
      avg_snr: number | null;
      message_count: string;
    }>(query.sql, query.params);
    return rows.map((r) => ({
      fromNodeId: Number(r.from_node_id),
      toNodeId: Number(r.to_node_id),
      avgSnr: r.avg_snr ?? null,
      messageCount: Number(r.message_count),
    }));
  });
}
