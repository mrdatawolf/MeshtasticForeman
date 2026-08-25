import { Buffer } from "node:buffer";

import { fromBinary } from "@bufbuild/protobuf";
import { formatNodeId } from "@foreman/shared";
import { Protobuf } from "@meshtastic/core";

import { activityLog } from "../activity/log.js";

import { decrypt } from "./codec.js";
import { haversineMeters, type NodePersistence, type NodeWriteMeta } from "./node-persistence.js";
import { parseInboundTopic } from "./topic-parsing.js";

import type { PGlite } from "@electric-sql/pglite";

export interface InboundHandlingDeps {
  db: PGlite;
  resolveChannelKey(channelName: string): Buffer;
  getOwnLatLon(): { lat: number; lon: number } | null;
  nodePersistence: NodePersistence;
}

export interface InboundDispatch {
  handleJsonInbound(
    payload: Buffer,
    channelName: string,
    gatewayId: string,
    regionPath: string,
  ): Promise<void>;
  upsertFromData(
    nodeId: number,
    data: Protobuf.Mesh.Data,
    rxTime: string,
    gatewayId: string,
    regionPath: string,
    channelName: string,
    snr: number | null,
    hopsAway: number | null,
  ): Promise<void>;
}

export async function handleInbound(
  deps: InboundHandlingDeps,
  dispatch: InboundDispatch,
  topic: string,
  payload: Buffer,
): Promise<void> {
  const parsed = parseInboundTopic(topic);
  if (parsed.kind === "json") {
    await dispatch.handleJsonInbound(
      payload,
      parsed.channelName,
      parsed.gatewayId,
      parsed.regionPath,
    );
    return;
  }
  if (parsed.kind === "skip") {
    console.log(`[mqtt] inbound skip (not 2/e): ${topic}`);
    return;
  }
  const { channelName, gatewayId, regionPath } = parsed;
  console.log(
    `[mqtt] inbound topic=${topic} channel=${channelName} gw=${gatewayId} region=${regionPath}`,
  );

  let envelope: Protobuf.Mqtt.ServiceEnvelope;
  try {
    envelope = fromBinary(Protobuf.Mqtt.ServiceEnvelopeSchema, payload);
  } catch (err) {
    console.log(`[mqtt] inbound envelope parse failed: ${err}`);
    return;
  }
  const pkt = envelope.packet;
  if (!pkt) {
    console.log("[mqtt] inbound: no packet in envelope");
    return;
  }
  const fromNum = pkt.from ?? 0;
  const packetId = pkt.id ?? 0;
  console.log(
    `[mqtt] inbound pkt from=${formatNodeId(fromNum)} variant=${pkt.payloadVariant?.case}`,
  );

  let data: Protobuf.Mesh.Data;
  if (pkt.payloadVariant?.case === "decoded") {
    data = pkt.payloadVariant.value as Protobuf.Mesh.Data;
  } else if (pkt.payloadVariant?.case === "encrypted") {
    try {
      const plain = decrypt(
        deps.resolveChannelKey(channelName),
        packetId,
        fromNum,
        Buffer.from(pkt.payloadVariant.value as Uint8Array),
      );
      data = fromBinary(Protobuf.Mesh.DataSchema, plain);
    } catch {
      console.log(`[mqtt] privately encrypted data from=${formatNodeId(fromNum)}`);
      return;
    }
  } else {
    console.log(
      `[mqtt] inbound skip unknown variant=${pkt.payloadVariant?.case} from=${formatNodeId(fromNum)}`,
    );
    return;
  }

  const portname =
    (Protobuf.Portnums.PortNum as Record<number, string>)[data.portnum] ?? String(data.portnum);
  console.log(`[mqtt] inbound decoded portnum=${portname} from=${formatNodeId(fromNum)}`);
  const rxTime =
    pkt.rxTime && pkt.rxTime > 0
      ? new Date(pkt.rxTime * 1000).toISOString()
      : new Date().toISOString();
  activityLog.add({
    ts: rxTime,
    source: "mqtt",
    portnum: portname,
    fromHex: formatNodeId(fromNum),
    region: regionPath || null,
    gateway: gatewayId || null,
    viaMqtt: false,
  });
  await dispatch.upsertFromData(
    fromNum,
    data,
    rxTime,
    gatewayId,
    regionPath,
    channelName,
    pkt.rxSnr ?? null,
    pkt.hopLimit ?? null,
  );
}

export async function upsertFromData(
  deps: InboundHandlingDeps,
  nodeId: number,
  data: Protobuf.Mesh.Data,
  rxTime: string,
  gatewayId: string,
  regionPath: string,
  channelName: string,
  snr: number | null,
  hopsAway: number | null,
): Promise<void> {
  if (nodeId === 0) return;
  const meta: NodeWriteMeta = { rxTime, gatewayId, regionPath, channelName, snr, hopsAway };
  if (data.portnum === Protobuf.Portnums.PortNum.NODEINFO_APP) {
    let user: Protobuf.Mesh.User;
    try {
      user = fromBinary(Protobuf.Mesh.UserSchema, data.payload);
    } catch {
      return;
    }
    await deps.nodePersistence.upsertNodeInfo(nodeId, user, meta);
  } else if (data.portnum === Protobuf.Portnums.PortNum.POSITION_APP) {
    let pos: Protobuf.Mesh.Position;
    try {
      pos = fromBinary(Protobuf.Mesh.PositionSchema, data.payload);
    } catch {
      return;
    }
    const lat = pos.latitudeI != null ? pos.latitudeI / 1e7 : null;
    const lon = pos.longitudeI != null ? pos.longitudeI / 1e7 : null;
    const alt = pos.altitude ?? null;
    console.log(
      `[mqtt] POSITION_APP from=${formatNodeId(nodeId)} latI=${pos.latitudeI ?? "null"} lonI=${pos.longitudeI ?? "null"} → lat=${lat} lon=${lon}`,
    );
    if (lat === null || lon === null || (lat === 0 && lon === 0)) {
      console.log(`[mqtt] POSITION_APP dropped (lat=${lat} lon=${lon})`);
      return;
    }
    const own = deps.getOwnLatLon();
    await deps.nodePersistence.upsertNodePosition(
      nodeId,
      {
        lat,
        lon,
        alt,
        distanceM: own ? haversineMeters(own.lat, own.lon, lat, lon) : null,
      },
      meta,
    );
  } else {
    await deps.nodePersistence.upsertNodeSeen(nodeId, meta);
  }
}

export async function handleJsonInbound(
  deps: InboundHandlingDeps,
  payload: Buffer,
  channelName: string,
  gatewayId: string,
  regionPath: string,
): Promise<void> {
  let msg: Record<string, unknown>;
  try {
    msg = JSON.parse(payload.toString("utf8"));
  } catch {
    console.log("[mqtt] json inbound: failed to parse JSON");
    return;
  }
  const fromNode = typeof msg.from === "number" ? msg.from : null;
  if (!fromNode) {
    console.log("[mqtt] json inbound: missing 'from' field");
    return;
  }
  const type = typeof msg.type === "string" ? msg.type : null;
  const sender = typeof msg.sender === "string" ? msg.sender : null;
  const channel = typeof msg.channel === "number" ? msg.channel : null;
  const toNode = typeof msg.to === "number" ? msg.to : null;
  const packetId = typeof msg.id === "number" ? msg.id : null;
  const rssi = typeof msg.rssi === "number" ? msg.rssi : null;
  const snr = typeof msg.snr === "number" ? msg.snr : null;
  const hopsAway = typeof msg.hops_away === "number" ? msg.hops_away : null;
  const hopStart = typeof msg.hop_start === "number" ? msg.hop_start : null;
  const tsRaw = typeof msg.timestamp === "number" ? msg.timestamp : null;
  const rxTime = tsRaw ? new Date(tsRaw * 1000).toISOString() : new Date().toISOString();
  const pld = msg.payload && typeof msg.payload === "object" ? msg.payload : null;
  console.log(
    `[mqtt] json inbound type=${type ?? "unknown"} from=${sender ?? formatNodeId(fromNode)} channel=${channelName}`,
  );
  await deps.db.query(
    `INSERT INTO mqtt_json_packets
       (packet_id, from_node, to_node, sender, channel, type, payload,
        rssi, snr, hops_away, hop_start, region_path, channel_name, gateway_id, rx_time)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
    [
      packetId,
      fromNode,
      toNode,
      sender,
      channel,
      type,
      pld ? JSON.stringify(pld) : null,
      rssi,
      snr,
      hopsAway,
      hopStart,
      regionPath,
      channelName,
      gatewayId,
      rxTime,
    ],
  );
  if (type !== "position" || !pld) return;
  const p = pld as Record<string, unknown>;
  const latI = typeof p.latitude_i === "number" ? p.latitude_i : null;
  const lonI = typeof p.longitude_i === "number" ? p.longitude_i : null;
  const alt = typeof p.altitude === "number" ? p.altitude : null;
  if (latI === null || lonI === null) return;
  const lat = latI / 1e7;
  const lon = lonI / 1e7;
  if (lat === 0 && lon === 0) return;
  const own = deps.getOwnLatLon();
  await deps.nodePersistence.upsertNodePosition(
    fromNode,
    {
      lat,
      lon,
      alt,
      distanceM: own ? haversineMeters(own.lat, own.lon, lat, lon) : null,
    },
    { rxTime, gatewayId, regionPath, channelName, snr, hopsAway },
    false,
  );
}
