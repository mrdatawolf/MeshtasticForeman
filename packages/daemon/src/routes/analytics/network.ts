import { z } from "zod";

import { deviceIdSchema, sendValidationError } from "../schemas.js";

import { parseSince } from "./shared.js";

import type { PGlite } from "@electric-sql/pglite";
import type { FastifyInstance } from "fastify";

const deviceQuerySchema = z.object({ deviceId: deviceIdSchema.optional() });
const neighborQuerySchema = deviceQuerySchema.extend({ since: z.string().default("24h") });

export function buildHopDistributionQuery(deviceId?: string) {
  const conditions = ["hops_away IS NOT NULL"];
  const params: unknown[] = [];
  if (deviceId) {
    params.push(deviceId);
    conditions.push(`device_id = $${params.length}`);
  }
  return {
    sql: `SELECT hops_away, COUNT(DISTINCT node_id) AS count FROM nodes
    WHERE ${conditions.join(" AND ")} GROUP BY hops_away ORDER BY hops_away ASC`,
    params,
  };
}

export function buildHardwareBreakdownQuery(deviceId?: string) {
  const conditions = ["n.hw_model IS NOT NULL"];
  const params: unknown[] = [];
  if (deviceId) {
    params.push(deviceId);
    conditions.push(`n.device_id = $${params.length}`);
  }
  return {
    sql: `SELECT n.hw_model, h.name AS hw_model_name, COUNT(DISTINCT n.node_id) AS count
    FROM nodes n LEFT JOIN hw_models h ON h.model_num = n.hw_model
    WHERE ${conditions.join(" AND ")} GROUP BY n.hw_model, h.name ORDER BY 3 DESC`,
    params,
  };
}

export function buildNeighborGraphQuery(opts: { since?: string; deviceId?: string }) {
  const conditions = ["portnum_name = 'NEIGHBORINFO_APP'", "decoded_json IS NOT NULL"];
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
    sql: `SELECT DISTINCT ON (from_node_id) from_node_id, decoded_json, rx_time
    FROM packets WHERE ${conditions.join(" AND ")} ORDER BY from_node_id, rx_time DESC`,
    params,
  };
}

export async function registerNetworkRoutes(app: FastifyInstance, db: PGlite) {
  app.get("/api/analytics/hop-distribution", async (req, reply) => {
    const result = deviceQuerySchema.safeParse(req.query);
    if (!result.success) return sendValidationError(reply, result.error);
    const { deviceId } = result.data;
    const q = buildHopDistributionQuery(deviceId);
    const { rows } = await db.query<{ hops_away: number; count: string }>(q.sql, q.params);
    return rows.map((r) => ({ hopsAway: r.hops_away, count: Number(r.count) }));
  });
  app.get("/api/analytics/hardware-breakdown", async (req, reply) => {
    const result = deviceQuerySchema.safeParse(req.query);
    if (!result.success) return sendValidationError(reply, result.error);
    const { deviceId } = result.data;
    const q = buildHardwareBreakdownQuery(deviceId);
    const { rows } = await db.query<{
      hw_model: number;
      hw_model_name: string | null;
      count: string;
    }>(q.sql, q.params);
    return rows.map((r) => ({
      hwModel: r.hw_model,
      hwModelName: r.hw_model_name ?? `Model ${r.hw_model}`,
      count: Number(r.count),
    }));
  });
  app.get("/api/analytics/neighbor-graph", async (req, reply) => {
    const result = neighborQuerySchema.safeParse(req.query);
    if (!result.success) return sendValidationError(reply, result.error);
    const { since, deviceId } = result.data;
    const q = buildNeighborGraphQuery({ since, deviceId });
    const { rows } = await db.query<{
      from_node_id: string;
      decoded_json: { nodeId?: number; neighbors?: { nodeId: number; snr?: number }[] };
      rx_time: string;
    }>(q.sql, q.params);
    const links: { fromNodeId: number; toNodeId: number; snr: number | null; lastSeen: string }[] =
      [];
    for (const row of rows) {
      const fromNodeId = Number(row.from_node_id);
      for (const nb of row.decoded_json?.neighbors ?? []) {
        if (!nb.nodeId || nb.nodeId === fromNodeId) continue;
        links.push({ fromNodeId, toNodeId: nb.nodeId, snr: nb.snr ?? null, lastSeen: row.rx_time });
      }
    }
    return links;
  });
}
