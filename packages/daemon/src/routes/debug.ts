import { DEBUG_TOOL_IDS } from "@foreman/shared";
import { z } from "zod";

import { collectDebugChecks, createPortInspector, readCoreVersion } from "../debug/checks.js";
import { ProbeInterruptedError } from "../device/device-manager.js";

import { deviceIdSchema, sendValidationError } from "./schemas.js";

import type { PortInspector } from "../debug/checks.js";
import type { DeviceManager } from "../device/device-manager.js";
import type { MqttGateway } from "../mqtt/gateway.js";
import type { PGlite } from "@electric-sql/pglite";
import type { DebugToolStatus } from "@foreman/shared";
import type { FastifyInstance } from "fastify";

const checksQuerySchema = z.object({ deviceId: deviceIdSchema.optional() });
const toolParamsSchema = z.object({ toolId: z.enum(DEBUG_TOOL_IDS) });
// Strict so that a caller cannot believe it chose the port: tools only use the saved one.
const toolBodySchema = z.object({ deviceId: deviceIdSchema }).strict();

const NOT_HELD = "The daemon does not hold this device's port";
const ALREADY_HELD = "The daemon already holds this device's port";
const TOOL_RUNNING = "Another debug tool is already running on this device";

export async function registerDebugRoutes(
  app: FastifyInstance,
  deviceManager: DeviceManager,
  mqttGateway: MqttGateway | null,
  db: PGlite,
  inspector: PortInspector = createPortInspector(),
) {
  const coreVersion = await readCoreVersion();
  const runningTools = new Set<string>();

  app.get("/api/debug/checks", async (req, reply) => {
    const query = checksQuerySchema.safeParse(req.query);
    if (!query.success) return sendValidationError(reply, query.error);

    const report = await collectDebugChecks(
      { db, deviceManager, mqttGateway, inspector, coreVersion },
      query.data.deviceId,
    );
    if (!report) return reply.status(404).send({ error: "Device not found" });
    return report;
  });

  app.post("/api/debug/tools/:toolId", async (req, reply) => {
    const params = toolParamsSchema.safeParse(req.params);
    if (!params.success) return sendValidationError(reply, params.error);
    const body = toolBodySchema.safeParse(req.body);
    if (!body.success) return sendValidationError(reply, body.error);

    const { toolId } = params.data;
    const { deviceId } = body.data;
    const { rows } = await db.query<{ name: string; port: string }>(
      "SELECT name, port FROM devices WHERE id = $1",
      [deviceId],
    );
    const saved = rows[0];
    if (!saved) return reply.status(404).send({ error: "Device not found" });

    if (runningTools.has(deviceId)) return reply.status(409).send({ error: TOOL_RUNNING });
    runningTools.add(deviceId);
    try {
      switch (toolId) {
        case "reconfigure": {
          if (!deviceManager.requestConfig(deviceId)) {
            return await reply.status(409).send({ error: NOT_HELD });
          }
          const status: DebugToolStatus = { toolId, status: "accepted" };
          return await reply.status(202).send(status);
        }
        case "reconnect": {
          if (deviceManager.getConnectionFacts(deviceId).portHeld) {
            return await reply.status(409).send({ error: ALREADY_HELD });
          }
          deviceManager.reconnect(deviceId, saved.port, saved.name);
          const status: DebugToolStatus = { toolId, status: "accepted" };
          return await reply.status(202).send(status);
        }
        case "disconnect": {
          await deviceManager.disconnect(deviceId);
          const status: DebugToolStatus = { toolId, status: "released" };
          return await reply.status(200).send(status);
        }
        case "raw-probe":
          return await reply
            .status(200)
            .send(await deviceManager.rawProbe(deviceId, saved.port, saved.name));
      }
    } catch (err) {
      if (err instanceof ProbeInterruptedError) {
        return reply.status(409).send({ error: err.message });
      }
      throw err;
    } finally {
      runningTools.delete(deviceId);
    }
  });
}
