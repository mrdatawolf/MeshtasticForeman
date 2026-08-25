import { Buffer } from "node:buffer";
import { randomBytes } from "node:crypto";

import { create, toBinary } from "@bufbuild/protobuf";
import { formatNodeId } from "@foreman/shared";
import { Protobuf } from "@meshtastic/core";

import type { NodePersistence, NodeWriteMeta } from "./node-persistence.js";
import type { PGlite } from "@electric-sql/pglite";
import type mqtt from "mqtt";

export interface ChannelInfo {
  name: string;
  key: Buffer;
}
export interface DeviceState {
  nodeNum: number;
  gatewayId: string;
  channels: Map<number, ChannelInfo>;
  cachedUser: Protobuf.Mesh.User | null;
  cachedPosition: Protobuf.Mesh.Position | null;
  selfAnnounceTimer: NodeJS.Timeout | null;
  announceScheduled: boolean;
  lastRelayAnnounceMs: number;
  lastDistanceRecalcMs: number;
}

export interface PublishingDeps {
  getClient(): mqtt.MqttClient | null;
  isConnected(): boolean;
  rootTopic: string;
  db: PGlite;
  nodePersistence: NodePersistence;
  codec: {
    DEFAULT_KEY: Buffer;
    encrypt(key: Buffer, packetId: number, fromNode: number, plaintext: Buffer): Buffer;
  };
}

const publishRoot = (rootTopic: string) => (rootTopic === "all" ? "msh" : rootTopic);

export async function handleMeshPacket(
  deps: PublishingDeps,
  state: DeviceState,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  pkt: any,
  publishSelf: () => Promise<void>,
): Promise<void> {
  const client = deps.getClient();
  if (!deps.isConnected() || !client || pkt.viaMqtt) return;
  const isDecoded = pkt.payloadVariant?.case === "decoded";
  const isEncrypted = pkt.payloadVariant?.case === "encrypted";
  if (!isDecoded && !isEncrypted) return;
  const fromNum: number = pkt.from ?? 0;
  const toNum: number = pkt.to ?? 0xffffffff;
  const packetId: number = pkt.id ?? 0;
  const chIdx: number = pkt.channel ?? 0;
  const rxTime: number = pkt.rxTime ?? Math.floor(Date.now() / 1000);
  const hopLimit: number = pkt.hopLimit ?? 3;
  const hopStart: number = pkt.hopStart ?? 0;
  const wantAck: boolean = pkt.wantAck ?? false;
  const ch = state.channels.get(chIdx) ?? { name: "LongFast", key: deps.codec.DEFAULT_KEY };
  let encryptedPayload: Uint8Array;
  if (isEncrypted) {
    encryptedPayload = pkt.payloadVariant.value as Uint8Array;
  } else {
    const dataBytes = toBinary(
      Protobuf.Mesh.DataSchema,
      create(Protobuf.Mesh.DataSchema, {
        portnum: pkt.payloadVariant.value.portnum ?? 0,
        payload: pkt.payloadVariant.value.payload ?? new Uint8Array(),
      }),
    );
    encryptedPayload = deps.codec.encrypt(ch.key, packetId, fromNum, Buffer.from(dataBytes));
  }
  const meshPkt = create(Protobuf.Mesh.MeshPacketSchema, {
    from: fromNum,
    to: toNum,
    channel: chIdx,
    id: packetId,
    rxTime,
    hopLimit,
    hopStart,
    wantAck,
    payloadVariant: { case: "encrypted", value: encryptedPayload },
  });
  const envelope = create(Protobuf.Mqtt.ServiceEnvelopeSchema, {
    packet: meshPkt,
    channelId: ch.name,
    gatewayId: state.gatewayId,
  });
  const topic = `${publishRoot(deps.rootTopic)}/2/e/${ch.name}/${state.gatewayId}`;
  client.publish(topic, Buffer.from(toBinary(Protobuf.Mqtt.ServiceEnvelopeSchema, envelope)));
  const portnumName = isDecoded
    ? ((Protobuf.Portnums.PortNum as Record<number, string>)[pkt.payloadVariant.value.portnum] ??
      "?")
    : "encrypted";
  console.log(`[mqtt] pub  ${portnumName} from ${formatNodeId(fromNum)} → ${topic}`);
  const relayInterval = 5 * 60 * 1000;
  if (state.cachedPosition && Date.now() - state.lastRelayAnnounceMs > relayInterval) {
    state.lastRelayAnnounceMs = Date.now();
    publishSelf().catch(console.error);
  }
}

export async function publishSelf(deps: PublishingDeps, state: DeviceState): Promise<void> {
  if (!deps.isConnected() || !deps.getClient() || state.nodeNum === 0) return;
  console.log(
    `[mqtt] _publishSelf ${state.gatewayId}: hasUser=${!!state.cachedUser} hasPos=${!!state.cachedPosition} latI=${state.cachedPosition?.latitudeI ?? "none"} lonI=${state.cachedPosition?.longitudeI ?? "none"}`,
  );
  const ch = state.channels.get(0) ?? { name: "LongFast", key: deps.codec.DEFAULT_KEY };
  if (state.cachedUser) {
    await publishOwnPacket(
      deps,
      state,
      ch,
      Protobuf.Portnums.PortNum.NODEINFO_APP,
      toBinary(Protobuf.Mesh.UserSchema, state.cachedUser),
    );
  }
  const pos = state.cachedPosition;
  if (pos && (pos.latitudeI || pos.longitudeI)) {
    await publishOwnPacket(
      deps,
      state,
      ch,
      Protobuf.Portnums.PortNum.POSITION_APP,
      toBinary(Protobuf.Mesh.PositionSchema, pos),
    );
    const lat = pos.latitudeI != null ? pos.latitudeI / 1e7 : null;
    const lon = pos.longitudeI != null ? pos.longitudeI / 1e7 : null;
    const alt = pos.altitude ?? null;
    const regionPath = publishRoot(deps.rootTopic).split("/").slice(1).join("/");
    const rxTime = new Date().toISOString();
    if (lat !== null && lon !== null && !(lat === 0 && lon === 0)) {
      const meta: NodeWriteMeta = {
        rxTime,
        gatewayId: state.gatewayId,
        regionPath,
        channelName: "LongFast",
        snr: null,
        hopsAway: null,
      };
      await deps.nodePersistence.upsertSelfPosition(state.nodeNum, { lat, lon, alt }, meta);
      console.log(
        `[mqtt] self position written to mqtt_nodes: ${lat.toFixed(5)}, ${lon.toFixed(5)}`,
      );
    }
  }
  if (state.cachedUser) await publishMapReport(deps, state, ch.name);
}

export async function publishOwnPacket(
  deps: PublishingDeps,
  state: DeviceState,
  ch: ChannelInfo,
  portnum: Protobuf.Portnums.PortNum,
  innerPayload: Uint8Array,
): Promise<void> {
  const client = deps.getClient();
  if (!client) return;
  const packetId = randomPacketId();
  const dataBytes = toBinary(
    Protobuf.Mesh.DataSchema,
    create(Protobuf.Mesh.DataSchema, {
      portnum,
      payload: innerPayload,
    }),
  );
  const encrypted = deps.codec.encrypt(ch.key, packetId, state.nodeNum, Buffer.from(dataBytes));
  const meshPkt = create(Protobuf.Mesh.MeshPacketSchema, {
    from: state.nodeNum,
    to: 0xffffffff,
    channel: 0,
    id: packetId,
    rxTime: Math.floor(Date.now() / 1000),
    hopLimit: 3,
    payloadVariant: { case: "encrypted", value: encrypted },
  });
  const envelope = create(Protobuf.Mqtt.ServiceEnvelopeSchema, {
    packet: meshPkt,
    channelId: ch.name,
    gatewayId: state.gatewayId,
  });
  const topic = `${publishRoot(deps.rootTopic)}/2/e/${ch.name}/${state.gatewayId}`;
  client.publish(topic, Buffer.from(toBinary(Protobuf.Mqtt.ServiceEnvelopeSchema, envelope)));
  console.log(`[mqtt] self ${Protobuf.Portnums.PortNum[portnum]} → ${topic}`);
}

export async function publishMapReport(
  deps: PublishingDeps,
  state: DeviceState,
  channelName: string,
): Promise<void> {
  const client = deps.getClient();
  if (!client || !state.cachedUser) return;
  const user = state.cachedUser;
  const pos = state.cachedPosition;
  const report = create(Protobuf.Mqtt.MapReportSchema, {
    longName: user.longName,
    shortName: user.shortName,
    hwModel: user.hwModel,
    hasDefaultChannel: (state.channels.get(0)?.key ?? deps.codec.DEFAULT_KEY).equals(
      deps.codec.DEFAULT_KEY,
    ),
    numOnlineLocalNodes: state.channels.size,
    ...(pos?.latitudeI
      ? { latitudeI: pos.latitudeI, longitudeI: pos.longitudeI ?? 0, altitude: pos.altitude ?? 0 }
      : {}),
  });
  const data = create(Protobuf.Mesh.DataSchema, {
    portnum: Protobuf.Portnums.PortNum.MAP_REPORT_APP,
    payload: toBinary(Protobuf.Mqtt.MapReportSchema, report),
  });
  const meshPkt = create(Protobuf.Mesh.MeshPacketSchema, {
    from: state.nodeNum,
    to: 0xffffffff,
    id: randomPacketId(),
    rxTime: Math.floor(Date.now() / 1000),
    hopLimit: 3,
    payloadVariant: { case: "decoded", value: data },
  });
  const envelope = create(Protobuf.Mqtt.ServiceEnvelopeSchema, {
    packet: meshPkt,
    channelId: channelName,
    gatewayId: state.gatewayId,
  });
  const topic = `${publishRoot(deps.rootTopic)}/2/map/`;
  client.publish(topic, Buffer.from(toBinary(Protobuf.Mqtt.ServiceEnvelopeSchema, envelope)));
  console.log(`[mqtt] self MAP_REPORT_APP → ${topic}`);
}

export function randomPacketId(): number {
  return randomBytes(4).readUInt32LE(0);
}
