import { z } from "zod";

import { deviceIdSchema, limitSchema, nodeIdSchema, sendValidationError } from "../schemas.js";

import { parseSince } from "./shared.js";

import type { PGlite } from "@electric-sql/pglite";
import type { FastifyInstance } from "fastify";

const positionHistoryQuerySchema = z.object({
  since: z.string().default("24h"),
  nodeId: nodeIdSchema({ sign: "any" }).optional(),
  deviceId: deviceIdSchema.optional(),
  limit: limitSchema(10_000, 2_000),
});

export function buildPositionHistoryQuery(opts: {
  since?: string;
  deviceId?: string;
  nodeId?: number;
  limit: number;
}) {
  const conditions: string[] = [];
  const params: unknown[] = [];
  const sinceDate = parseSince(opts.since);
  if (sinceDate) {
    params.push(sinceDate.toISOString());
    conditions.push(`recorded_at >= $${params.length}`);
  }
  if (opts.deviceId) {
    params.push(opts.deviceId);
    conditions.push(`device_id = $${params.length}`);
  }
  if (opts.nodeId !== undefined) {
    params.push(opts.nodeId);
    conditions.push(`node_id = $${params.length}`);
  }
  params.push(opts.limit);
  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  return {
    sql: `SELECT id, node_id, latitude, longitude, altitude, speed, ground_track,
    sats_in_view, recorded_at FROM position_history ${where}
    ORDER BY recorded_at DESC LIMIT $${params.length}`,
    params,
  };
}

export async function registerPositionsRoutes(app: FastifyInstance, db: PGlite) {
  app.get("/api/analytics/position-history", async (req, reply) => {
    const result = positionHistoryQuerySchema.safeParse(req.query);
    if (!result.success) return sendValidationError(reply, result.error);
    const { since, nodeId, deviceId, limit } = result.data;
    const q = buildPositionHistoryQuery({ since, deviceId, nodeId, limit });
    const { rows } = await db.query<{
      id: string;
      node_id: string;
      latitude: number;
      longitude: number;
      altitude: number | null;
      speed: number | null;
      ground_track: number | null;
      sats_in_view: number | null;
      recorded_at: string;
    }>(q.sql, q.params);
    return rows.map((r) => ({
      id: r.id,
      nodeId: Number(r.node_id),
      latitude: r.latitude,
      longitude: r.longitude,
      altitude: r.altitude,
      speed: r.speed,
      groundTrack: r.ground_track,
      satsInView: r.sats_in_view,
      recordedAt: r.recorded_at,
    }));
  });
}
