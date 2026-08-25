import { Buffer } from "node:buffer";
import { randomUUID } from "node:crypto";

import { formatNodeId, resolveNodeName } from "@foreman/shared";

import { mapNodeRow, type NodeRow } from "../db/repositories/nodes.js";
import { createLogger } from "../logger.js";

import type { AdaptedNodeInfo, AdaptedPosition } from "./meshtastic-adapter.js";
import type { PGlite } from "@electric-sql/pglite";
import type { ServerEvent } from "@foreman/shared";

export interface NodeUpdateHandlerDeps {
  db: PGlite;
  emit: (event: ServerEvent) => void;
}
const log = createLogger("devices");

export async function handleNodeInfo(
  deps: NodeUpdateHandlerDeps,
  deviceId: string,
  nodeInfo: AdaptedNodeInfo,
): Promise<void> {
  const nodeId: number = nodeInfo.num ?? 0;
  if (nodeId === 0) return;
  log.info(
    {
      deviceId,
      operation: "node-info",
      nodeId: formatNodeId(nodeId),
      nodeName: resolveNodeName(nodeId, nodeInfo.user ?? {}, { fallback: "?" }),
    },
    "node info received",
  );
  const macBytes = nodeInfo.user?.macaddr;
  const macAddress =
    macBytes && macBytes.length > 0
      ? Array.from(macBytes)
          .map((b) => b.toString(16).padStart(2, "0"))
          .join(":")
      : null;
  const pubKeyBytes = nodeInfo.user?.publicKey;
  const publicKey =
    pubKeyBytes && pubKeyBytes.length > 0 ? Buffer.from(pubKeyBytes).toString("hex") : null;
  const lastHeardSec = nodeInfo.lastHeard ?? 0;
  const lastHeard = lastHeardSec > 0 ? new Date(lastHeardSec * 1000).toISOString() : null;

  await deps.db.query(
    `INSERT INTO nodes(node_id, device_id, long_name, short_name, mac_address,
       hw_model, public_key, last_heard, snr, hops_away)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
     ON CONFLICT(node_id, device_id) DO UPDATE SET
       long_name   = COALESCE(EXCLUDED.long_name,   nodes.long_name),
       short_name  = COALESCE(EXCLUDED.short_name,  nodes.short_name),
       mac_address = COALESCE(EXCLUDED.mac_address, nodes.mac_address),
       hw_model    = COALESCE(EXCLUDED.hw_model,    nodes.hw_model),
       public_key  = COALESCE(EXCLUDED.public_key,  nodes.public_key),
       last_heard  = COALESCE(EXCLUDED.last_heard,  nodes.last_heard),
       snr         = COALESCE(EXCLUDED.snr,         nodes.snr),
       hops_away   = COALESCE(EXCLUDED.hops_away,   nodes.hops_away)`,
    [
      nodeId,
      deviceId,
      nodeInfo.user?.longName ?? null,
      nodeInfo.user?.shortName ?? null,
      macAddress,
      nodeInfo.user?.hwModel ?? null,
      publicKey,
      lastHeard,
      nodeInfo.snr || null,
      nodeInfo.hopsAway ?? null,
    ],
  );
  const { rows } = await deps.db.query<{
    latitude: number | null;
    longitude: number | null;
    altitude: number | null;
  }>("SELECT latitude, longitude, altitude FROM nodes WHERE device_id = $1 AND node_id = $2", [
    deviceId,
    nodeId,
  ]);
  const pos = rows[0];
  deps.emit({
    type: "node:update",
    payload: {
      nodeId,
      longName: nodeInfo.user?.longName ?? null,
      shortName: nodeInfo.user?.shortName ?? null,
      macAddress,
      hwModel: nodeInfo.user?.hwModel ?? null,
      publicKey,
      lastHeard,
      snr: nodeInfo.snr || null,
      hopsAway: nodeInfo.hopsAway ?? null,
      latitude: pos?.latitude ?? null,
      longitude: pos?.longitude ?? null,
      altitude: pos?.altitude ?? null,
    },
  });
}

export async function handlePosition(
  deps: NodeUpdateHandlerDeps,
  deviceId: string,
  pkt: AdaptedPosition,
): Promise<void> {
  const fromNodeId = pkt.from ?? 0;
  if (fromNodeId === 0) return;
  const pos = pkt.data;
  if (!pos) return;
  const lat = pos.latitudeI != null ? pos.latitudeI / 1e7 : null;
  const lon = pos.longitudeI != null ? pos.longitudeI / 1e7 : null;
  if (lat === null || lon === null || (lat === 0 && lon === 0)) return;
  const alt = pos.altitude ?? null;
  const speed = pos.groundSpeed != null ? pos.groundSpeed / 100 : null;
  const groundTrack = pos.groundTrack ?? null;
  const satsInView = pos.satsInView ?? null;
  const rxTime = pkt.rxTime instanceof Date ? pkt.rxTime.toISOString() : new Date().toISOString();

  await deps.db.query(
    `UPDATE nodes SET latitude = $1, longitude = $2, altitude = $3, last_heard = GREATEST(last_heard, $4)
     WHERE device_id = $5 AND node_id = $6`,
    [lat, lon, alt, rxTime, deviceId, fromNodeId],
  );
  await deps.db.query(
    `INSERT INTO position_history(id, device_id, node_id, latitude, longitude, altitude,
       speed, ground_track, sats_in_view, recorded_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [randomUUID(), deviceId, fromNodeId, lat, lon, alt, speed, groundTrack, satsInView, rxTime],
  );
  const { rows } = await deps.db.query<NodeRow>(
    `SELECT node_id, long_name, short_name, mac_address, hw_model, public_key,
            last_heard, snr, hops_away, latitude, longitude, altitude
     FROM nodes WHERE device_id = $1 AND node_id = $2`,
    [deviceId, fromNodeId],
  );
  if (!rows[0]) return;
  const node = mapNodeRow(rows[0]);
  deps.emit({
    type: "node:update",
    payload: {
      ...node,
      latitude: lat,
      longitude: lon,
      altitude: alt,
    },
  });
}
