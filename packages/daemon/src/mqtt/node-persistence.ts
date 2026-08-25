import { Buffer } from "node:buffer";

import { mapMqttNodeRow, type MqttNodeRow } from "../db/repositories/mqtt-nodes.js";

import type { PGlite } from "@electric-sql/pglite";
import type { MqttNode } from "@foreman/shared";
import type { Protobuf } from "@meshtastic/core";

export interface NodeWriteMeta {
  rxTime: string;
  gatewayId: string;
  regionPath: string;
  channelName: string;
  snr: number | null;
  hopsAway: number | null;
}

export class NodePersistence {
  constructor(
    private readonly db: PGlite,
    private readonly emit: (event: string, node: MqttNode) => boolean,
  ) {}

  async upsertNodeInfo(
    nodeId: number,
    user: Protobuf.Mesh.User,
    meta: NodeWriteMeta,
  ): Promise<void> {
    await this.db.query(
      `INSERT INTO mqtt_nodes(node_id, long_name, short_name, hw_model, public_key,
         last_heard, last_gateway, region_path, channel_name, snr, hops_away)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       ON CONFLICT(node_id) DO UPDATE SET
         long_name    = COALESCE(EXCLUDED.long_name,    mqtt_nodes.long_name),
         short_name   = COALESCE(EXCLUDED.short_name,   mqtt_nodes.short_name),
         hw_model     = COALESCE(EXCLUDED.hw_model,     mqtt_nodes.hw_model),
         public_key   = COALESCE(EXCLUDED.public_key,   mqtt_nodes.public_key),
         last_heard   = GREATEST(EXCLUDED.last_heard,   mqtt_nodes.last_heard),
         last_gateway = EXCLUDED.last_gateway,
         region_path  = EXCLUDED.region_path,
         channel_name = EXCLUDED.channel_name,
         snr          = COALESCE(EXCLUDED.snr,          mqtt_nodes.snr),
         hops_away    = COALESCE(EXCLUDED.hops_away,    mqtt_nodes.hops_away)`,
      [
        nodeId,
        user.longName || null,
        user.shortName || null,
        user.hwModel ?? null,
        user.publicKey?.length ? Buffer.from(user.publicKey).toString("hex") : null,
        meta.rxTime,
        meta.gatewayId,
        meta.regionPath,
        meta.channelName,
        meta.snr,
        meta.hopsAway,
      ],
    );
    await this.emitNodeUpdate(nodeId, meta);
  }

  async upsertNodePosition(
    nodeId: number,
    position: { lat: number; lon: number; alt: number | null; distanceM: number | null },
    meta: NodeWriteMeta,
    updateLocalNode = true,
  ): Promise<void> {
    await this.db.query(
      `INSERT INTO mqtt_nodes(node_id, latitude, longitude, altitude, last_heard, last_gateway, region_path, channel_name, snr, hops_away, distance_m)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       ON CONFLICT(node_id) DO UPDATE SET
         latitude     = EXCLUDED.latitude,
         longitude    = EXCLUDED.longitude,
         altitude     = COALESCE(EXCLUDED.altitude,    mqtt_nodes.altitude),
         last_heard   = GREATEST(EXCLUDED.last_heard,  mqtt_nodes.last_heard),
         last_gateway = EXCLUDED.last_gateway,
         region_path  = EXCLUDED.region_path,
         channel_name = EXCLUDED.channel_name,
         snr          = COALESCE(EXCLUDED.snr,         mqtt_nodes.snr),
         hops_away    = COALESCE(EXCLUDED.hops_away,   mqtt_nodes.hops_away),
         distance_m   = COALESCE(EXCLUDED.distance_m,  mqtt_nodes.distance_m)`,
      [
        nodeId,
        position.lat,
        position.lon,
        position.alt,
        meta.rxTime,
        meta.gatewayId,
        meta.regionPath,
        meta.channelName,
        meta.snr,
        meta.hopsAway,
        position.distanceM,
      ],
    );
    if (updateLocalNode) {
      await this.db.query(
        `UPDATE nodes SET latitude = $1, longitude = $2, altitude = COALESCE($3, altitude),
           last_heard = GREATEST(last_heard, $4)
         WHERE node_id = $5`,
        [position.lat, position.lon, position.alt, meta.rxTime, nodeId],
      );
    }
    await this.emitNodeUpdate(nodeId, meta);
  }

  async upsertNodeSeen(nodeId: number, meta: NodeWriteMeta): Promise<void> {
    await this.db.query(
      `INSERT INTO mqtt_nodes(node_id, last_heard, last_gateway, region_path, channel_name)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT(node_id) DO UPDATE SET
         last_heard   = GREATEST(EXCLUDED.last_heard,  mqtt_nodes.last_heard),
         last_gateway = EXCLUDED.last_gateway,
         region_path  = EXCLUDED.region_path,
         channel_name = EXCLUDED.channel_name`,
      [nodeId, meta.rxTime, meta.gatewayId, meta.regionPath, meta.channelName],
    );
    await this.emitNodeUpdate(nodeId, meta);
  }

  async upsertSelfPosition(
    nodeId: number,
    position: { lat: number; lon: number; alt: number | null },
    meta: NodeWriteMeta,
  ): Promise<void> {
    await this.db.query(
      `INSERT INTO mqtt_nodes(node_id, latitude, longitude, altitude, last_heard, last_gateway, region_path, distance_m)
       VALUES ($1,$2,$3,$4,$5,$6,$7,0)
       ON CONFLICT(node_id) DO UPDATE SET
         latitude     = EXCLUDED.latitude,
         longitude    = EXCLUDED.longitude,
         altitude     = COALESCE(EXCLUDED.altitude, mqtt_nodes.altitude),
         last_heard   = GREATEST(EXCLUDED.last_heard, mqtt_nodes.last_heard),
         last_gateway = EXCLUDED.last_gateway,
         region_path  = EXCLUDED.region_path,
         distance_m   = 0`,
      [
        nodeId,
        position.lat,
        position.lon,
        position.alt,
        meta.rxTime,
        meta.gatewayId,
        meta.regionPath,
      ],
    );
    await this.emitNodeUpdate(nodeId, meta);
  }

  async emitNodeUpdate(nodeId: number, meta: NodeWriteMeta): Promise<void> {
    const { rows } = await this.db.query<MqttNodeRow>(
      `SELECT node_id, long_name, short_name, hw_model, public_key, last_heard,
              latitude, longitude, altitude, last_gateway, region_path, channel_name,
              snr, hops_away, distance_m FROM mqtt_nodes WHERE node_id = $1`,
      [nodeId],
    );
    if (!rows[0]) return;
    const node = mapMqttNodeRow(rows[0]);
    this.emit("mqtt_node:update", {
      ...node,
      lastHeard: meta.rxTime,
      lastGateway: meta.gatewayId,
      regionPath: meta.regionPath,
      channelName: meta.channelName,
      snr: meta.snr,
      hopsAway: meta.hopsAway,
    });
  }
}

export function haversineMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const radius = 6_371_000;
  const phi1 = (lat1 * Math.PI) / 180;
  const phi2 = (lat2 * Math.PI) / 180;
  const deltaPhi = ((lat2 - lat1) * Math.PI) / 180;
  const deltaLambda = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(deltaPhi / 2) ** 2 + Math.cos(phi1) * Math.cos(phi2) * Math.sin(deltaLambda / 2) ** 2;
  return radius * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
