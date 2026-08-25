import { randomUUID } from "node:crypto";

/* eslint-disable @typescript-eslint/no-explicit-any -- TASK-024 preserves the untyped traceroute SDK boundary. */

import { formatNodeId } from "@foreman/shared";

import { createLogger } from "../logger.js";

import type { PGlite } from "@electric-sql/pglite";
import type { ServerEvent } from "@foreman/shared";

export interface TracerouteHandlerDeps {
  db: PGlite;
  emit: (event: ServerEvent) => void;
  getMyNodeId: (deviceId: string) => number | undefined;
}
const log = createLogger("devices");

// SDK traceroute packet typing remains intentionally unchanged from DeviceManager.
export async function handleTraceroutePacket(
  deps: TracerouteHandlerDeps,
  deviceId: string,
  pkt: any,
) {
  const route: number[] = Array.from(pkt.data?.route ?? []);
  const routeBack: number[] = Array.from(pkt.data?.routeBack ?? []);
  const nodeId: number = pkt.from ?? 0;
  const fromNodeId = deps.getMyNodeId(deviceId) ?? 0;
  deps.emit({
    type: "traceroute:result",
    payload: { deviceId, nodeId, route, routeBack },
  });
  log.info(
    {
      deviceId,
      operation: "traceroute-result",
      nodeId: formatNodeId(nodeId),
      route: route.map((node) => formatNodeId(node, 0)),
    },
    "traceroute result received",
  );
  await deps.db.query(
    `INSERT INTO traceroutes(id, device_id, from_node_id, to_node_id, route, route_back)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [randomUUID(), deviceId, fromNodeId, nodeId, JSON.stringify(route), JSON.stringify(routeBack)],
  );
}
