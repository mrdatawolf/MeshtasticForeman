import { registerMessagesRoutes } from "./analytics/messages.js";
import { registerNetworkRoutes } from "./analytics/network.js";
import { registerPacketsRoutes } from "./analytics/packets.js";
import { registerPositionsRoutes } from "./analytics/positions.js";
import { registerSignalRoutes } from "./analytics/signal.js";
import { registerTelemetryRoutes } from "./analytics/telemetry.js";

import type { PGlite } from "@electric-sql/pglite";
import type { FastifyInstance } from "fastify";

export async function registerAnalyticsRoutes(app: FastifyInstance, db: PGlite) {
  await registerSignalRoutes(app, db);
  await registerMessagesRoutes(app, db);
  await registerNetworkRoutes(app, db);
  await registerTelemetryRoutes(app, db);
  await registerPacketsRoutes(app, db);
  await registerPositionsRoutes(app, db);
}
