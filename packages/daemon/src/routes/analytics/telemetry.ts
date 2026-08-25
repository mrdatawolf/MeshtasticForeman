import { z } from "zod";

import { deviceIdSchema, nodeIdSchema, sendValidationError } from "../schemas.js";

import { parseSince } from "./shared.js";

import type { PGlite } from "@electric-sql/pglite";
import type { FastifyInstance } from "fastify";

const telemetryHistoryQuerySchema = z.object({
  since: z.string().default("24h"),
  nodeId: nodeIdSchema({ sign: "any" }).optional(),
  deviceId: deviceIdSchema.optional(),
});

export function buildTelemetryHistoryQuery(opts: {
  since?: string;
  deviceId?: string;
  nodeId?: number;
}) {
  const conditions = ["portnum_name = 'TELEMETRY_APP'", "decoded_json IS NOT NULL"];
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
  return {
    sql: `SELECT
    to_timestamp(floor(EXTRACT(epoch FROM rx_time) / 300) * 300) AS ts,
    from_node_id AS node_id, decoded_json -> 'variant' ->> 'case' AS variant_case,
    (decoded_json -> 'variant' -> 'value' ->> 'batteryLevel')::numeric AS battery_level,
    (decoded_json -> 'variant' -> 'value' ->> 'voltage')::numeric AS voltage,
    (decoded_json -> 'variant' -> 'value' ->> 'channelUtilization')::numeric AS channel_utilization,
    (decoded_json -> 'variant' -> 'value' ->> 'airUtilTx')::numeric AS air_util_tx,
    (decoded_json -> 'variant' -> 'value' ->> 'uptimeSeconds')::numeric AS uptime_seconds,
    (decoded_json -> 'variant' -> 'value' ->> 'temperature')::numeric AS temperature,
    (decoded_json -> 'variant' -> 'value' ->> 'relativeHumidity')::numeric AS relative_humidity,
    (decoded_json -> 'variant' -> 'value' ->> 'barometricPressure')::numeric AS barometric_pressure
    FROM packets WHERE ${conditions.join(" AND ")} ORDER BY ts ASC, from_node_id ASC`,
    params,
  };
}

type TelemetryRow = {
  ts: string;
  node_id: string;
  variant_case: string | null;
  battery_level: number | null;
  voltage: number | null;
  channel_utilization: number | null;
  air_util_tx: number | null;
  uptime_seconds: number | null;
  temperature: number | null;
  relative_humidity: number | null;
  barometric_pressure: number | null;
};

export async function registerTelemetryRoutes(app: FastifyInstance, db: PGlite) {
  app.get("/api/analytics/telemetry-history", async (req, reply) => {
    const result = telemetryHistoryQuerySchema.safeParse(req.query);
    if (!result.success) return sendValidationError(reply, result.error);
    const { since, nodeId, deviceId } = result.data;
    const q = buildTelemetryHistoryQuery({ since, deviceId, nodeId });
    const { rows } = await db.query<TelemetryRow>(q.sql, q.params);
    const numFields = [
      "batteryLevel",
      "voltage",
      "channelUtilization",
      "airUtilTx",
      "uptimeSeconds",
      "temperature",
      "relativeHumidity",
      "barometricPressure",
    ] as const;
    const dbFields: Record<(typeof numFields)[number], keyof TelemetryRow> = {
      batteryLevel: "battery_level",
      voltage: "voltage",
      channelUtilization: "channel_utilization",
      airUtilTx: "air_util_tx",
      uptimeSeconds: "uptime_seconds",
      temperature: "temperature",
      relativeHumidity: "relative_humidity",
      barometricPressure: "barometric_pressure",
    };
    const bucketMap = new Map<
      string,
      {
        sums: Record<string, number>;
        counts: Record<string, number>;
        variantCase: string | null;
        ts: string;
        nodeId: number;
      }
    >();
    for (const r of rows) {
      const key = `${r.ts}_${r.node_id}`;
      if (!bucketMap.has(key))
        bucketMap.set(key, {
          sums: {},
          counts: {},
          variantCase: r.variant_case,
          ts: new Date(r.ts).toISOString(),
          nodeId: Number(r.node_id),
        });
      const b = bucketMap.get(key)!;
      for (const f of numFields) {
        const val = r[dbFields[f]] as number | null;
        if (val !== null && val !== undefined) {
          b.sums[f] = (b.sums[f] ?? 0) + Number(val);
          b.counts[f] = (b.counts[f] ?? 0) + 1;
        }
      }
    }
    return [...bucketMap.values()].map((b) => {
      const avg = (f: string) => (b.counts[f] ? b.sums[f] / b.counts[f] : null);
      return {
        ts: b.ts,
        nodeId: b.nodeId,
        variantCase: b.variantCase,
        batteryLevel: avg("batteryLevel"),
        voltage: avg("voltage"),
        channelUtilization: avg("channelUtilization"),
        airUtilTx: avg("airUtilTx"),
        uptimeSeconds: avg("uptimeSeconds"),
        temperature: avg("temperature"),
        relativeHumidity: avg("relativeHumidity"),
        barometricPressure: avg("barometricPressure"),
      };
    });
  });
}
