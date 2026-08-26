import fastifyCors from "@fastify/cors";
import fastifyStatic from "@fastify/static";
import fastifyWebsocket from "@fastify/websocket";
import Fastify from "fastify";

import { consoleLog } from "./activity/console-log.js";
import { loadConfig } from "./config.js";
import { db } from "./db/client.js";
import { runMigrations } from "./db/migrations.js";
import { clearDbLock } from "./db/open.js";
import { startRetentionSweep, type RetentionSweepHandle } from "./db/repositories/retention.js";
import { DeviceManager } from "./device/device-manager.js";
import { syncHwModels } from "./hw-models.js";
import { createLogger } from "./logger.js";
import { MqttGateway } from "./mqtt/gateway.js";
import { registerAnalyticsRoutes } from "./routes/analytics.js";
import { registerCoverageRoutes } from "./routes/coverage.js";
import { registerDeviceRoutes } from "./routes/devices.js";
import { registerHealthRoutes } from "./routes/health.js";
import { registerProposalRoutes } from "./routes/proposals.js";
import { registerWsRoute, type WsRouteHandle } from "./routes/websocket.js";

import type { FastifyInstance } from "fastify";

let app: FastifyInstance | undefined;
let deviceManager: DeviceManager | undefined;
let mqttGateway: MqttGateway | null | undefined;
let wsHandle: WsRouteHandle | undefined;
let retentionSweep: RetentionSweepHandle | null | undefined;
const shutdownLog = createLogger("shutdown");
const dbLog = createLogger("db");
const mqttLog = createLogger("mqtt");
const foremanLog = createLogger("foreman");
const hwModelsLog = createLogger("hw-models");

type ShutdownSignal = "SIGTERM" | "SIGINT";
type ShutdownStep =
  | "websocket clients"
  | "HTTP server"
  | "MQTT gateway"
  | "serial devices"
  | "retention sweep"
  | "PGlite worker"
  | "database lock";

interface ShutdownDependencies {
  getApp(): { close(): Promise<void> } | undefined;
  getDeviceManager(): Pick<DeviceManager, "shutdown"> | undefined;
  getMqttGateway(): Pick<MqttGateway, "shutdown"> | null | undefined;
  getRetentionSweep(): RetentionSweepHandle | null | undefined;
  getWsHandle(): WsRouteHandle | undefined;
  db: { close(): Promise<void> };
  clearDbLock(): void;
}

export function createShutdownCoordinator(
  dependencies: ShutdownDependencies,
  timeoutMs = 10_000,
): (signal: ShutdownSignal) => Promise<never> {
  return async (signal: ShutdownSignal): Promise<never> => {
    let currentStep: ShutdownStep = "websocket clients";
    const startedAt = new Date();
    shutdownLog.info({ operation: "shutdown", signal, startedAt }, "shutdown begun");

    const timeout = setTimeout(() => {
      shutdownLog.error(
        { operation: "shutdown", step: currentStep },
        "shutdown timed out; forcing exit",
      );
      process.exit(124);
    }, timeoutMs);
    timeout.unref();

    const runStep = async (step: ShutdownStep, action: () => void | Promise<void>) => {
      currentStep = step;
      try {
        await action();
        shutdownLog.info({ operation: "shutdown", step }, "shutdown step complete");
      } catch (err) {
        shutdownLog.error({ operation: "shutdown", step, err }, "shutdown step failed");
      }
    };

    await runStep("websocket clients", () =>
      dependencies.getWsHandle()?.closeAll(1001, "server shutting down"),
    );
    await runStep("HTTP server", async () => dependencies.getApp()?.close());
    await runStep("MQTT gateway", async () => dependencies.getMqttGateway()?.shutdown());
    await runStep("serial devices", async () => dependencies.getDeviceManager()?.shutdown());
    await runStep("retention sweep", () => dependencies.getRetentionSweep()?.stop());
    await runStep("PGlite worker", () => dependencies.db.close());
    await runStep("database lock", () => dependencies.clearDbLock());

    clearTimeout(timeout);
    shutdownLog.info(
      { operation: "shutdown", durationMs: Date.now() - startedAt.getTime() },
      "shutdown complete",
    );
    process.exit(0);
  };
}

/**
 * Pause the terminal, show an error, and wait for any keypress before
 * exiting with code 1. The start scripts loop on exit so this gives the
 * user time to read the error before the window restarts.
 */
async function fatalError(label: string, err: unknown): Promise<never> {
  const msg = err instanceof Error ? (err.stack ?? err.message) : String(err);
  process.stderr.write(`\n\n${"=".repeat(60)}\n`);
  process.stderr.write(`  FATAL — ${label}\n\n`);
  process.stderr.write(`  ${msg.split("\n").join("\n  ")}\n`);
  process.stderr.write(`${"=".repeat(60)}\n\n`);
  process.stderr.write("  Press any key to restart the service...\n\n");

  // Wait for a single keypress if stdin is a TTY; otherwise just pause 5 s
  // so the log is visible before the loop restarts the process.
  if (process.stdin.isTTY) {
    process.stdin.setRawMode(true);
    process.stdin.resume();
    await new Promise<void>((resolve) =>
      process.stdin.once("data", () => {
        process.stdin.setRawMode(false);
        process.stdin.pause();
        resolve();
      }),
    );
  } else {
    await new Promise<void>((resolve) => setTimeout(resolve, 5000));
  }

  process.exit(1);
}

process.on("unhandledRejection", (reason) => {
  fatalError("unhandled rejection", reason);
});

process.on("uncaughtException", (err) => {
  fatalError("uncaught exception", err);
});

const shutdown = createShutdownCoordinator({
  getApp: () => app,
  getDeviceManager: () => deviceManager,
  getMqttGateway: () => mqttGateway,
  getRetentionSweep: () => retentionSweep,
  getWsHandle: () => wsHandle,
  db,
  clearDbLock,
});
let shuttingDown = false;
for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.on(signal, () => {
    if (shuttingDown) {
      process.exit(1);
      return;
    }
    shuttingDown = true;
    void shutdown(signal);
  });
}

async function main() {
  const config = loadConfig();

  // Capture all console.log/warn/error into the in-memory ring buffer
  // before anything else logs, so no lines are missed.
  consoleLog.install();

  // 1. Database
  await runMigrations(db);
  dbLog.info({ operation: "migrate" }, "migrations complete");

  // 2. HTTP + WebSocket server
  app = Fastify({ logger: { level: "info" } });

  await app.register(fastifyCors, { origin: "*" });
  await app.register(fastifyWebsocket);

  // Serve built frontend from web package (in production)
  // WEB_DIST env var allows Electron packaging to override the default path
  await app.register(fastifyStatic, {
    root: config.api.webDist,
    wildcard: false,
  });

  // 3. Device manager (owns all serial/TCP connections)
  deviceManager = new DeviceManager(db, { bot: config.bot });
  deviceManager.on("transport:error", (err: unknown) => {
    void fatalError("serial transport failure", err);
  });

  // 4. MQTT gateway (optional — configured when MQTT_BROKER is set; only
  //    auto-started when ENABLE_MQTT=true so the system is lightweight by default)
  mqttGateway = null;
  if (config.mqtt.broker) {
    mqttGateway = new MqttGateway(
      {
        broker: config.mqtt.broker,
        port: config.mqtt.port,
        username: config.mqtt.username,
        password: config.mqtt.password,
        rootTopic: config.mqtt.rootTopic,
      },
      db,
    );
    deviceManager.setMqttGateway(mqttGateway);
    if (config.mqtt.enabled === true) {
      mqttGateway.start();
      mqttLog.info({ operation: "start", broker: config.mqtt.broker }, "gateway started");
    } else {
      mqttLog.info(
        { operation: "configure", broker: config.mqtt.broker, enabled: false },
        "gateway configured but not started",
      );
    }
  }

  // Auto-connect to device specified in env (takes priority over DB-saved devices)
  if (config.meshtastic.port) {
    const port = config.meshtastic.port;
    const name = config.meshtastic.name ?? config.meshtastic.port;
    foremanLog.info({ operation: "auto-connect", port }, "auto-connecting to device");
    await deviceManager.connect(port, name).catch((err) => {
      foremanLog.error({ operation: "auto-connect", port, err }, "failed to connect to device");
    });
  } else {
    await deviceManager.reconnectSaved();
  }

  // 4. Routes
  await registerDeviceRoutes(app, deviceManager, mqttGateway, db);
  await registerAnalyticsRoutes(app, db);
  await registerCoverageRoutes(app, db, { coverage: config.coverage });
  await registerProposalRoutes(app, db);
  await registerHealthRoutes(app, db, mqttGateway);
  wsHandle = await registerWsRoute(app, deviceManager, mqttGateway, db);

  // Fallback to index.html for SPA routing
  app.setNotFoundHandler((_req, reply) => {
    reply.sendFile("index.html");
  });

  await app.listen({ port: config.api.port, host: config.api.host });
  foremanLog.info(
    { operation: "listen", host: config.api.host, port: config.api.port },
    "daemon listening",
  );

  retentionSweep = startRetentionSweep(db, config.retention);

  // Background: sync hardware model names from the protobufs repo.
  // Runs after the server is up so it never delays startup.
  syncHwModels(db).catch((err) =>
    hwModelsLog.warn({ operation: "sync", err }, "unexpected error during sync"),
  );
}

if (!process.env.VITEST) {
  main().catch((err) => fatalError("startup failure", err));
}
