import type { MqttGateway } from "../mqtt/gateway.js";
import type { PGlite } from "@electric-sql/pglite";
import type { FastifyInstance } from "fastify";

export interface ReadinessBody {
  status: "healthy" | "degraded" | "failed";
  checks: {
    pglite: "ok" | "failed";
    mqtt?: "ok" | "disconnected";
  };
}

async function checkPglite(db: PGlite): Promise<"ok" | "failed"> {
  let timeout: ReturnType<typeof setTimeout> | undefined;

  try {
    await Promise.race([
      Promise.resolve().then(() => db.query("SELECT 1")),
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => reject(new Error("PGlite readiness check timed out")), 2000);
      }),
    ]);
    return "ok";
  } catch {
    return "failed";
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

export async function registerHealthRoutes(
  app: FastifyInstance,
  db: PGlite,
  mqttGateway: MqttGateway | null,
): Promise<void> {
  app.get("/api/health", (_request, reply) => reply.code(200).send({ status: "ok" }));

  app.get("/api/ready", async (_request, reply) => {
    const checks: ReadinessBody["checks"] = {
      pglite: await checkPglite(db),
    };

    try {
      if (mqttGateway !== null && mqttGateway.isRunning) {
        checks.mqtt = mqttGateway.connected ? "ok" : "disconnected";
      }
    } catch {
      checks.mqtt = "disconnected";
    }

    const status: ReadinessBody["status"] =
      checks.pglite === "failed"
        ? "failed"
        : checks.mqtt === "disconnected"
          ? "degraded"
          : "healthy";
    const body: ReadinessBody = { status, checks };

    return reply.code(status === "failed" ? 503 : 200).send(body);
  });
}
