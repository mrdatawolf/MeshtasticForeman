import fastifyCors from "@fastify/cors";
import fastifyStatic from "@fastify/static";
import fastifyWebsocket from "@fastify/websocket";
import Fastify from "fastify";

import { consoleLog } from "./activity/console-log.js";
import { loadConfig } from "./config.js";
import { db } from "./db/client.js";
import { runMigrations } from "./db/migrations.js";
import { DeviceManager } from "./device/device-manager.js";
import { syncHwModels } from "./hw-models.js";
import { MqttGateway } from "./mqtt/gateway.js";
import { registerAnalyticsRoutes } from "./routes/analytics.js";
import { registerCoverageRoutes } from "./routes/coverage.js";
import { registerDeviceRoutes } from "./routes/devices.js";
import { registerProposalRoutes } from "./routes/proposals.js";
import { registerWsRoute } from "./routes/websocket.js";

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

// The serial transport calls AbortController.abort() on disconnect, which rejects
// any in-flight reads using that signal. Those rejections are unhandled inside the
// transport's own machinery and would otherwise crash the process.
process.on("unhandledRejection", (reason) => {
  if (reason instanceof Error && reason.name === "AbortError") return;
  fatalError("unhandled rejection", reason);
});

// Serial port disconnect sequences can emit 'error' events on the SerialPort
// EventEmitter after the port is already closed (e.g. "Port is not open",
// ERR_STREAM_PREMATURE_CLOSE). These become uncaught exceptions that would
// crash the process. We swallow only the known serial-disconnect error codes
// so the daemon stays up and waits for the device to reconnect.
const SERIAL_DISCONNECT_CODES = new Set(["ABORT_ERR", "ERR_STREAM_PREMATURE_CLOSE"]);
process.on("uncaughtException", (err) => {
  const code = (err as NodeJS.ErrnoException).code ?? "";
  const msg = err.message ?? "";
  if (SERIAL_DISCONNECT_CODES.has(code) || msg === "Port is not open") {
    console.warn("[foreman] suppressed serial-disconnect error:", msg || code);
    return;
  }
  fatalError("uncaught exception", err);
});

async function main() {
  const config = loadConfig();

  // Capture all console.log/warn/error into the in-memory ring buffer
  // before anything else logs, so no lines are missed.
  consoleLog.install();

  // 1. Database
  await runMigrations(db);
  console.log("[db] migrations complete");

  // 2. HTTP + WebSocket server
  const app = Fastify({ logger: { level: "info" } });

  await app.register(fastifyCors, { origin: "*" });
  await app.register(fastifyWebsocket);

  // Serve built frontend from web package (in production)
  // WEB_DIST env var allows Electron packaging to override the default path
  await app.register(fastifyStatic, {
    root: config.api.webDist,
    wildcard: false,
  });

  // 3. Device manager (owns all serial/TCP connections)
  const deviceManager = new DeviceManager(db, { bot: config.bot });

  // 4. MQTT gateway (optional — configured when MQTT_BROKER is set; only
  //    auto-started when ENABLE_MQTT=true so the system is lightweight by default)
  let mqttGateway: MqttGateway | null = null;
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
      console.log(`[mqtt] gateway started → ${config.mqtt.broker}`);
    } else {
      console.log(
        `[mqtt] gateway configured (ENABLE_MQTT is not true, not starting) → ${config.mqtt.broker}`,
      );
    }
  }

  // Auto-connect to device specified in env (takes priority over DB-saved devices)
  if (config.meshtastic.port) {
    const port = config.meshtastic.port;
    const name = config.meshtastic.name ?? config.meshtastic.port;
    console.log(`[foreman] auto-connecting to ${port}`);
    await deviceManager.connect(port, name).catch((err) => {
      console.error(`[foreman] failed to connect to ${port}:`, err.message);
    });
  } else {
    await deviceManager.reconnectSaved();
  }

  // 4. Routes
  await registerDeviceRoutes(app, deviceManager, mqttGateway, db);
  await registerAnalyticsRoutes(app, db);
  await registerCoverageRoutes(app, db, { coverage: config.coverage });
  await registerProposalRoutes(app, db);
  await registerWsRoute(app, deviceManager, mqttGateway, db);

  // Fallback to index.html for SPA routing
  app.setNotFoundHandler((_req, reply) => {
    reply.sendFile("index.html");
  });

  await app.listen({ port: config.api.port, host: config.api.host });
  console.log(`[foreman] daemon listening on http://${config.api.host}:${config.api.port}`);

  // Background: sync hardware model names from the protobufs repo.
  // Runs after the server is up so it never delays startup.
  syncHwModels(db).catch((err) => console.warn("[hw-models] unexpected error during sync:", err));
}

main().catch((err) => fatalError("startup failure", err));
