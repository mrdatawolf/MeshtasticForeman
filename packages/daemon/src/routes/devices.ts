import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";
import type { DeviceManager } from "../device/device-manager.js";
import type { MqttGateway } from "../mqtt/gateway.js";
import type { PGlite } from "@electric-sql/pglite";
import { getHwModels } from "../hw-models.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
// region-presets.json lives at the project root — 3 levels up from src/ or dist/
const REGION_PRESETS_PATH = join(__dirname, "../../..", "region-presets.json");

const connectBodySchema = z.object({
  port: z.string().min(1),
  name: z.string().min(1),
});

const nodeOverrideBodySchema = z.object({
  aliasName: z.string().max(64).nullable().optional(),
  latitude:  z.number().min(-90).max(90).nullable().optional(),
  longitude: z.number().min(-180).max(180).nullable().optional(),
  altitude:  z.number().int().nullable().optional(),
  notes:     z.string().max(512).nullable().optional(),
});

export async function registerDeviceRoutes(
  app: FastifyInstance,
  deviceManager: DeviceManager,
  mqttGateway?: MqttGateway | null,
  db?: PGlite,
) {
  // Serve region-presets.json from the project root so both the web frontend
  // and any other tooling can consume it via a single canonical URL.
  app.get("/api/region-presets", async (_req, reply) => {
    try {
      const json = await readFile(REGION_PRESETS_PATH, "utf8");
      reply.header("Content-Type", "application/json");
      return reply.send(json);
    } catch {
      return reply.status(404).send({ error: "region-presets.json not found at project root" });
    }
  });

  app.get("/api/devices", async () => {
    const rows = await deviceManager.listDevices();
    return rows;
  });

  app.post("/api/devices/connect", async (req, reply) => {
    const result = connectBodySchema.safeParse(req.body);
    if (!result.success) {
      return reply.status(400).send({ error: result.error.flatten() });
    }
    const device = await deviceManager.connect(result.data.port, result.data.name);
    return device;
  });

  app.get("/api/devices/:id/nodes", async (req, reply) => {
    const { id } = req.params as { id: string };
    const nodes = await deviceManager.listNodes(id);
    return nodes;
  });

  app.get("/api/devices/:id/config", async (req, reply) => {
    const { id } = req.params as { id: string };
    const config = await deviceManager.getDeviceConfig(id);
    if (!config) return reply.status(404).send({ error: "Device not found" });
    return config;
  });

  app.get("/api/mqtt-nodes", async () => {
    if (!mqttGateway) return [];
    return mqttGateway.listMqttNodes();
  });

  app.delete("/api/devices/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    await deviceManager.disconnect(id);
    return reply.status(204).send();
  });

  app.delete("/api/devices/:id/messages/:nodeId", async (req, reply) => {
    const { id, nodeId: rawNodeId } = req.params as { id: string; nodeId: string };
    const nodeId = Number(rawNodeId);
    if (!Number.isInteger(nodeId) || nodeId < 0) {
      return reply.status(400).send({ error: "Invalid nodeId" });
    }
    await deviceManager.deleteConversation(id, nodeId);
    return reply.status(204).send();
  });

  // ---------------------------------------------------------------------------
  // Node overrides — local fallback names/positions, never written to the mesh
  // ---------------------------------------------------------------------------

  app.get("/api/node-overrides", async () => {
    if (!db) return [];
    const { rows } = await db.query<{
      node_id: number; alias_name: string | null;
      latitude: number | null; longitude: number | null;
      altitude: number | null; notes: string | null;
    }>("SELECT node_id, alias_name, latitude, longitude, altitude, notes FROM node_overrides ORDER BY node_id");
    return rows.map((r) => ({
      nodeId: r.node_id, aliasName: r.alias_name,
      latitude: r.latitude, longitude: r.longitude,
      altitude: r.altitude, notes: r.notes,
    }));
  });

  app.put("/api/node-overrides/:nodeId", async (req, reply) => {
    if (!db) return reply.status(503).send({ error: "DB not available" });
    const nodeId = Number((req.params as { nodeId: string }).nodeId);
    if (!Number.isInteger(nodeId) || nodeId <= 0) {
      return reply.status(400).send({ error: "Invalid nodeId" });
    }
    const result = nodeOverrideBodySchema.safeParse(req.body);
    if (!result.success) return reply.status(400).send({ error: result.error.flatten() });
    const { aliasName = null, latitude = null, longitude = null, altitude = null, notes = null } = result.data;
    await db.query(
      `INSERT INTO node_overrides(node_id, alias_name, latitude, longitude, altitude, notes)
       VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT(node_id) DO UPDATE SET
         alias_name = EXCLUDED.alias_name,
         latitude   = EXCLUDED.latitude,
         longitude  = EXCLUDED.longitude,
         altitude   = EXCLUDED.altitude,
         notes      = EXCLUDED.notes`,
      [nodeId, aliasName, latitude, longitude, altitude, notes]
    );
    return { nodeId, aliasName, latitude, longitude, altitude, notes };
  });

  // ---------------------------------------------------------------------------
  // Hardware model lookup table (populated from protobufs repo by syncHwModels)
  // ---------------------------------------------------------------------------

  app.get("/api/hw-models", async (_req, reply) => {
    if (!db) return reply.status(503).send({ error: "DB not available" });
    return getHwModels(db);
  });

  app.delete("/api/node-overrides/:nodeId", async (req, reply) => {
    if (!db) return reply.status(503).send({ error: "DB not available" });
    const nodeId = Number((req.params as { nodeId: string }).nodeId);
    await db.query("DELETE FROM node_overrides WHERE node_id = $1", [nodeId]);
    return reply.status(204).send();
  });

  // ---------------------------------------------------------------------------
  // Traceroutes — persisted route discovery results
  // ---------------------------------------------------------------------------

  app.get("/api/traceroutes", async (req, reply) => {
    if (!db) return reply.status(503).send({ error: "DB not available" });
    const { since, deviceId: filterDevice } = req.query as { since?: string; deviceId?: string };

    const conditions: string[] = [];
    const params: unknown[] = [];

    if (since) {
      const ts = new Date(since);
      if (isNaN(ts.getTime())) return reply.status(400).send({ error: "Invalid 'since' date" });
      params.push(ts.toISOString());
      conditions.push(`recorded_at >= $${params.length}`);
    }
    if (filterDevice) {
      params.push(filterDevice);
      conditions.push(`device_id = $${params.length}`);
    }

    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    const { rows } = await db.query<{
      id: string; device_id: string; from_node_id: number; to_node_id: number;
      route: number[]; route_back: number[]; recorded_at: string;
    }>(
      `SELECT id, device_id, from_node_id, to_node_id, route, route_back, recorded_at
       FROM traceroutes ${where}
       ORDER BY recorded_at DESC
       LIMIT 500`,
      params
    );
    return rows.map((r) => ({
      id: r.id,
      deviceId: r.device_id,
      fromNodeId: r.from_node_id,
      toNodeId: r.to_node_id,
      route: r.route,
      routeBack: r.route_back,
      recordedAt: r.recorded_at,
    }));
  });
}
