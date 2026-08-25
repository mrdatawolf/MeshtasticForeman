import { z } from "zod";

import { deviceIdSchema, limitSchema, sendValidationError } from "../schemas.js";

import { buildFilters, parseSince, percentile } from "./shared.js";

import type { PGlite } from "@electric-sql/pglite";
import type { FastifyInstance } from "fastify";

const LATENCY_BUCKETS = [
  { label: "<1s", maxMs: 1_000 },
  { label: "1-5s", maxMs: 5_000 },
  { label: "5-30s", maxMs: 30_000 },
  { label: "30s-1m", maxMs: 60_000 },
  { label: ">1m", maxMs: Infinity },
];

const analyticsQuerySchema = z.object({
  since: z.string().optional(),
  deviceId: deviceIdSchema.optional(),
});
const sevenDayQuerySchema = analyticsQuerySchema.extend({ since: z.string().default("7d") });
const bucketQuerySchema = sevenDayQuerySchema.extend({
  bucket: z.enum(["hour", "day"]).default("hour"),
});
const busiestNodesQuerySchema = sevenDayQuerySchema.extend({ limit: limitSchema(100, 20) });

export function buildMessageVolumeQuery(opts: {
  since?: string;
  deviceId?: string;
  bucket: "hour" | "day";
}) {
  const { where, params } = buildFilters(opts);
  return {
    sql: `SELECT date_trunc('${opts.bucket}', rx_time) AS ts,
    COUNT(*) FILTER (WHERE role = 'received') AS received,
    COUNT(*) FILTER (WHERE role = 'sent') AS sent,
    COUNT(*) FILTER (WHERE role = 'relayed') AS relayed, COUNT(*) AS total
    FROM messages ${where} GROUP BY 1 ORDER BY 1 ASC`,
    params,
  };
}

export function buildMessageDeliveryQueries(opts: { since?: string; deviceId?: string }) {
  const conditions = ["role = 'sent'", "want_ack = true"];
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
  const where = `WHERE ${conditions.join(" AND ")}`;
  return {
    statusSql: `SELECT ack_status, COUNT(*) AS count FROM messages ${where} GROUP BY ack_status`,
    errorSql: `SELECT ack_error, COUNT(*) AS count FROM messages ${where}
      AND ack_status = 'error' AND ack_error IS NOT NULL GROUP BY ack_error ORDER BY 2 DESC`,
    params,
  };
}

export function buildBusiestNodesQuery(opts: { since?: string; deviceId?: string; limit: number }) {
  const { where, params } = buildFilters(opts);
  params.push(opts.limit);
  return {
    sql: `SELECT from_node_id AS node_id,
    COUNT(*) FILTER (WHERE role = 'received') AS received,
    COUNT(*) FILTER (WHERE role = 'sent') AS sent,
    COUNT(*) FILTER (WHERE role = 'relayed') AS relayed, COUNT(*) AS total
    FROM messages ${where} GROUP BY from_node_id ORDER BY total DESC LIMIT $${params.length}`,
    params,
  };
}

export function buildChannelUtilizationQuery(opts: { since?: string; deviceId?: string }) {
  const conditions: string[] = [];
  const params: unknown[] = [];
  const sinceDate = parseSince(opts.since);
  if (sinceDate) {
    params.push(sinceDate.toISOString());
    conditions.push(`m.rx_time >= $${params.length}`);
  }
  if (opts.deviceId) {
    params.push(opts.deviceId);
    conditions.push(`m.device_id = $${params.length}`);
  }
  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  return {
    sql: `SELECT m.channel_index, c.name AS channel_name,
    COUNT(*) FILTER (WHERE m.role = 'received') AS received,
    COUNT(*) FILTER (WHERE m.role = 'sent') AS sent,
    COUNT(*) FILTER (WHERE m.role = 'relayed') AS relayed, COUNT(*) AS total
    FROM messages m LEFT JOIN channels c ON c.device_id = m.device_id AND c.idx = m.channel_index
    ${where} GROUP BY m.channel_index, c.name ORDER BY m.channel_index ASC`,
    params,
  };
}

export function buildMessageLatencyQuery(opts: { since?: string; deviceId?: string }) {
  const conditions = ["role = 'sent'", "ack_status = 'acked'", "ack_at IS NOT NULL"];
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
  return {
    sql: `SELECT EXTRACT(epoch FROM (ack_at - rx_time)) * 1000 AS latency_ms
    FROM messages WHERE ${conditions.join(" AND ")} ORDER BY latency_ms ASC`,
    params,
  };
}

export function buildNodeActivityQuery(opts: {
  since?: string;
  deviceId?: string;
  bucket: "hour" | "day";
}) {
  const { where, params } = buildFilters(opts);
  const select = (table: string) => `SELECT date_trunc('${opts.bucket}', rx_time) AS ts,
    from_node_id AS node_id, COUNT(*) AS count FROM ${table} ${where} GROUP BY 1, 2`;
  return { sql: `${select("messages")} UNION ALL ${select("packets")}`, params };
}

export async function registerMessagesRoutes(app: FastifyInstance, db: PGlite) {
  app.get("/api/analytics/message-volume", async (req, reply) => {
    const result = bucketQuerySchema.safeParse(req.query);
    if (!result.success) return sendValidationError(reply, result.error);
    const { since, bucket, deviceId } = result.data;
    const q = buildMessageVolumeQuery({ since, deviceId, bucket });
    const { rows } = await db.query<{
      ts: string;
      received: string;
      sent: string;
      relayed: string;
      total: string;
    }>(q.sql, q.params);
    return rows.map((r) => ({
      ts: new Date(r.ts).toISOString(),
      received: Number(r.received),
      sent: Number(r.sent),
      relayed: Number(r.relayed),
      total: Number(r.total),
    }));
  });
  app.get("/api/analytics/message-delivery", async (req, reply) => {
    const result = analyticsQuerySchema.safeParse(req.query);
    if (!result.success) return sendValidationError(reply, result.error);
    const { since, deviceId } = result.data;
    const q = buildMessageDeliveryQueries({ since, deviceId });
    const [statusRows, errorRows] = await Promise.all([
      db.query<{ ack_status: string | null; count: string }>(q.statusSql, q.params),
      db.query<{ ack_error: string | null; count: string }>(q.errorSql, q.params),
    ]);
    let acked = 0,
      pending = 0,
      error = 0;
    for (const r of statusRows.rows) {
      const n = Number(r.count);
      if (r.ack_status === "acked") acked = n;
      if (r.ack_status === "pending") pending = n;
      if (r.ack_status === "error") error = n;
    }
    return {
      acked,
      pending,
      error,
      total: acked + pending + error,
      errorTypes: errorRows.rows.map((r) => ({
        type: r.ack_error ?? "unknown",
        count: Number(r.count),
      })),
    };
  });
  app.get("/api/analytics/busiest-nodes", async (req, reply) => {
    const result = busiestNodesQuerySchema.safeParse(req.query);
    if (!result.success) return sendValidationError(reply, result.error);
    const { since, limit, deviceId } = result.data;
    const q = buildBusiestNodesQuery({
      since,
      deviceId,
      limit,
    });
    const { rows } = await db.query<{
      node_id: string;
      received: string;
      sent: string;
      relayed: string;
      total: string;
    }>(q.sql, q.params);
    return rows.map((r) => ({
      nodeId: Number(r.node_id),
      received: Number(r.received),
      sent: Number(r.sent),
      relayed: Number(r.relayed),
      total: Number(r.total),
    }));
  });
  app.get("/api/analytics/channel-utilization", async (req, reply) => {
    const result = sevenDayQuerySchema.safeParse(req.query);
    if (!result.success) return sendValidationError(reply, result.error);
    const { since, deviceId } = result.data;
    const q = buildChannelUtilizationQuery({ since, deviceId });
    const { rows } = await db.query<{
      channel_index: number;
      channel_name: string | null;
      received: string;
      sent: string;
      relayed: string;
      total: string;
    }>(q.sql, q.params);
    return rows.map((r) => ({
      channelIndex: r.channel_index,
      channelName: r.channel_name ?? null,
      received: Number(r.received),
      sent: Number(r.sent),
      relayed: Number(r.relayed),
      total: Number(r.total),
    }));
  });
  app.get("/api/analytics/message-latency", async (req, reply) => {
    const result = sevenDayQuerySchema.safeParse(req.query);
    if (!result.success) return sendValidationError(reply, result.error);
    const { since, deviceId } = result.data;
    const q = buildMessageLatencyQuery({ since, deviceId });
    const { rows } = await db.query<{ latency_ms: number }>(q.sql, q.params);
    if (rows.length === 0)
      return {
        buckets: LATENCY_BUCKETS.map((b) => ({ label: b.label, maxMs: b.maxMs, count: 0 })),
        medianMs: null,
        p95Ms: null,
        totalSamples: 0,
      };
    const buckets = LATENCY_BUCKETS.map((b) => ({ ...b, count: 0 }));
    for (const { latency_ms } of rows) {
      const ms = Number(latency_ms);
      (buckets.find((b) => ms <= b.maxMs) ?? buckets[buckets.length - 1]).count++;
    }
    const values = rows.map((r) => Number(r.latency_ms));
    return {
      buckets: buckets.map(({ label, maxMs, count }) => ({ label, maxMs, count })),
      medianMs: percentile(values, 50),
      p95Ms: percentile(values, 95),
      totalSamples: values.length,
    };
  });
  app.get("/api/analytics/node-activity", async (req, reply) => {
    const result = bucketQuerySchema.safeParse(req.query);
    if (!result.success) return sendValidationError(reply, result.error);
    const { since, bucket, deviceId } = result.data;
    const q = buildNodeActivityQuery({ since, deviceId, bucket });
    const { rows } = await db.query<{ ts: string; node_id: string; count: string }>(
      q.sql,
      q.params,
    );
    const merged = new Map<string, { ts: string; nodeId: number; count: number }>();
    for (const r of rows) {
      const key = `${r.ts}_${r.node_id}`;
      const existing = merged.get(key);
      if (existing) existing.count += Number(r.count);
      else
        merged.set(key, {
          ts: new Date(r.ts).toISOString(),
          nodeId: Number(r.node_id),
          count: Number(r.count),
        });
    }
    return [...merged.values()].sort((a, b) => a.ts.localeCompare(b.ts) || a.nodeId - b.nodeId);
  });
}
