/** MQTT gateway orchestrator. Protocol and persistence responsibilities live in sibling modules. */
import { Buffer } from "node:buffer";
import { EventEmitter } from "node:events";

import { formatNodeId } from "@foreman/shared";
import { MeshDevice, Types, Protobuf } from "@meshtastic/core";

import { DEFAULT_KEY, decrypt, encrypt, expandPsk } from "./codec.js";
import {
  handleInbound,
  handleJsonInbound,
  upsertFromData,
  type InboundHandlingDeps,
} from "./inbound-handling.js";
import { NodePersistence, haversineMeters } from "./node-persistence.js";
import {
  handleMeshPacket,
  publishMapReport,
  publishOwnPacket,
  publishSelf,
  randomPacketId,
  type ChannelInfo,
  type DeviceState,
  type PublishingDeps,
} from "./publishing.js";
import { connectTransport, stopTransport, subscribeTransport } from "./transport.js";

import type { PGlite } from "@electric-sql/pglite";
import type { MqttNode } from "@foreman/shared";
import type mqtt from "mqtt";

export interface MqttGatewayConfig {
  broker: string;
  port: number;
  username: string;
  password: string;
  rootTopic: string;
  selfAnnounceInterval?: number;
}

const DEFAULT_SELF_ANNOUNCE_INTERVAL = 15 * 60 * 1000;

export class MqttGateway extends EventEmitter {
  private readonly cfg: Required<MqttGatewayConfig>;
  private client: mqtt.MqttClient | null = null;
  private connected = false;
  private readonly devices = new Map<string, DeviceState>();
  private readonly nodePersistence: NodePersistence;

  constructor(
    cfg: MqttGatewayConfig,
    private readonly db: PGlite,
  ) {
    super();
    this.cfg = { selfAnnounceInterval: DEFAULT_SELF_ANNOUNCE_INTERVAL, ...cfg };
    this.nodePersistence = new NodePersistence(db, this.emit.bind(this));
  }

  start(): void {
    this.client = connectTransport(this.cfg);
    this.client.on("connect", () => {
      this.connected = true;
      console.log(`[mqtt] connected to ${this.cfg.broker}`);
      subscribeTransport(this.client!, this.cfg.rootTopic);
      for (const [deviceId] of this.devices) this._publishSelf(deviceId).catch(console.error);
    });
    this.client.on("message", (topic, payload) => {
      this._handleInbound(topic, payload).catch((err) =>
        console.error("[mqtt] inbound error:", err.message),
      );
    });
    this.client.on(
      "disconnect",
      (
        packet:
          | {
              reasonCode?: number;
              properties?: { reasonString?: string };
            }
          | undefined,
      ) => {
        this.connected = false;
        console.log(
          `[mqtt] disconnected reason=${packet?.reasonCode ?? "?"} (${packet?.properties?.reasonString ?? "no reason"})`,
        );
      },
    );
    this.client.on("close", () => {
      this.connected = false;
      console.log("[mqtt] connection closed");
    });
    this.client.on("error", (err) => console.error("[mqtt] error:", err.message));
  }

  stop(): void {
    for (const state of this.devices.values()) {
      if (state.selfAnnounceTimer) {
        clearInterval(state.selfAnnounceTimer);
        state.selfAnnounceTimer = null;
      }
    }
    stopTransport(this.client);
    this.client = null;
    this.connected = false;
    console.log("[mqtt] stopped");
  }

  get isRunning(): boolean {
    return this.client !== null;
  }

  attachDevice(deviceId: string, meshDevice: MeshDevice): void {
    const state: DeviceState = {
      nodeNum: 0,
      gatewayId: "!00000000",
      channels: new Map(),
      cachedUser: null,
      cachedPosition: null,
      selfAnnounceTimer: null,
      announceScheduled: false,
      lastRelayAnnounceMs: 0,
      lastDistanceRecalcMs: 0,
    };
    this.devices.set(deviceId, state);
    const scheduleAnnounceIfReady = () => {
      if (state.announceScheduled || state.nodeNum === 0 || state.channels.size === 0) return;
      state.announceScheduled = true;
      console.log(`[mqtt] device ${deviceId} ready (${state.gatewayId}), announcing in 2s`);
      setTimeout(() => {
        this._publishSelf(deviceId).catch(console.error);
        if (!state.selfAnnounceTimer) {
          state.selfAnnounceTimer = setInterval(() => {
            this._publishSelf(deviceId).catch(console.error);
          }, this.cfg.selfAnnounceInterval);
        }
      }, 2000);
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    meshDevice.events.onMyNodeInfo.subscribe((info: any) => {
      state.nodeNum = info.myNodeNum;
      state.gatewayId = formatNodeId(info.myNodeNum);
      console.log(`[mqtt] device ${deviceId} nodeNum = ${state.gatewayId}`);
      scheduleAnnounceIfReady();
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    meshDevice.events.onChannelPacket.subscribe((ch: any) => {
      const idx = ch.index;
      const name = ch.settings?.name || "LongFast";
      const rawPsk = ch.settings?.psk;
      state.channels.set(idx, { name, key: rawPsk ? this._expandPsk(rawPsk) : DEFAULT_KEY });
      console.log(`[mqtt] device ${deviceId} channel ${idx} = "${name}"`);
      scheduleAnnounceIfReady();
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    meshDevice.events.onNodeInfoPacket.subscribe((nodeInfo: any) => {
      const isOurs =
        state.nodeNum !== 0
          ? nodeInfo.num === state.nodeNum
          : !!(nodeInfo.user?.id && nodeInfo.user.id === state.gatewayId);
      console.log(
        `[mqtt] nodeInfo num=${formatNodeId(nodeInfo.num ?? 0)} ours=${isOurs} stateNum=${state.gatewayId} hasPos=${!!nodeInfo.position?.latitudeI} latI=${nodeInfo.position?.latitudeI ?? "none"}`,
      );
      if (isOurs) {
        if (nodeInfo.user) state.cachedUser = nodeInfo.user as Protobuf.Mesh.User;
        if (nodeInfo.position?.latitudeI) {
          state.cachedPosition = nodeInfo.position as Protobuf.Mesh.Position;
          console.log(
            `[mqtt] cached own position from nodeInfo: lat=${nodeInfo.position.latitudeI / 1e7} lon=${nodeInfo.position.longitudeI / 1e7}`,
          );
        }
      }
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    meshDevice.events.onPositionPacket.subscribe((pkt: any) => {
      console.log(
        `[mqtt] positionPacket from=${formatNodeId(pkt.from ?? 0)} stateNum=${state.gatewayId} latI=${pkt.data?.latitudeI ?? "none"}`,
      );
      if (pkt.from !== state.nodeNum) return;
      const hadPosition = !!state.cachedPosition;
      state.cachedPosition = pkt.data as Protobuf.Mesh.Position;
      console.log(
        `[mqtt] cached own position from positionPacket: lat=${pkt.data?.latitudeI / 1e7}`,
      );
      if (!hadPosition && state.announceScheduled) this._publishSelf(deviceId).catch(console.error);
      if (state.cachedPosition.latitudeI && state.cachedPosition.longitudeI) {
        const pos = state.cachedPosition;
        this.emit("gps:position", deviceId, {
          latitude: pos.latitudeI / 1e7,
          longitude: pos.longitudeI / 1e7,
          altitude: pos.altitude ?? null,
          satsInView: pos.satsInView > 0 ? pos.satsInView : null,
          fixType: pos.fixType > 0 ? pos.fixType : null,
          fixQuality: pos.fixQuality > 0 ? pos.fixQuality : null,
          pdop: pos.PDOP > 0 ? pos.PDOP : null,
          hdop: pos.HDOP > 0 ? pos.HDOP : null,
          locationSource: pos.locationSource != null ? pos.locationSource : null,
          gpsTimestamp: pos.time ? new Date(Number(pos.time) * 1000).toISOString() : null,
        });
      }
      const recalcInterval = 5 * 60 * 1000;
      if (
        state.cachedPosition.latitudeI &&
        state.cachedPosition.longitudeI &&
        Date.now() - state.lastDistanceRecalcMs > recalcInterval
      ) {
        state.lastDistanceRecalcMs = Date.now();
        this._recalcAllDistances(
          state.cachedPosition.latitudeI / 1e7,
          state.cachedPosition.longitudeI / 1e7,
        ).catch(console.error);
      }
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    meshDevice.events.onMeshPacket.subscribe((pkt: any) => {
      this._handleMeshPacket(deviceId, pkt).catch((err) =>
        console.error(`[mqtt] packet error on ${deviceId}:`, err.message),
      );
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    meshDevice.events.onDeviceStatus.subscribe((status: any) => {
      console.log(`[mqtt] device ${deviceId} status = ${Types.DeviceStatusEnum[status] ?? status}`);
      if (status === Types.DeviceStatusEnum.DeviceConfigured) scheduleAnnounceIfReady();
    });
  }

  detachDevice(deviceId: string): void {
    const state = this.devices.get(deviceId);
    if (!state) return;
    if (state.selfAnnounceTimer) clearInterval(state.selfAnnounceTimer);
    this.devices.delete(deviceId);
  }

  async listMqttNodes(): Promise<MqttNode[]> {
    const { rows } = await this.db.query<{
      node_id: number;
      long_name: string | null;
      short_name: string | null;
      hw_model: number | null;
      public_key: string | null;
      last_heard: string | null;
      latitude: number | null;
      longitude: number | null;
      altitude: number | null;
      last_gateway: string | null;
      region_path: string | null;
      channel_name: string | null;
      snr: number | null;
      hops_away: number | null;
      distance_m: number | null;
    }>(`SELECT node_id, long_name, short_name, hw_model, public_key, last_heard,
              latitude, longitude, altitude, last_gateway, region_path, channel_name, snr, hops_away, distance_m
       FROM mqtt_nodes ORDER BY last_heard DESC NULLS LAST`);
    return rows.map((r) => ({
      nodeId: r.node_id,
      longName: r.long_name,
      shortName: r.short_name,
      hwModel: r.hw_model,
      publicKey: r.public_key,
      lastHeard: r.last_heard,
      latitude: r.latitude,
      longitude: r.longitude,
      altitude: r.altitude,
      lastGateway: r.last_gateway,
      regionPath: r.region_path,
      channelName: r.channel_name,
      snr: r.snr,
      hopsAway: r.hops_away,
      distanceM: r.distance_m,
    }));
  }

  private inboundDeps(): InboundHandlingDeps {
    return {
      db: this.db,
      resolveChannelKey: (channelName) => this._resolveChannelKey(channelName),
      getOwnLatLon: () => this._getOwnLatLon(),
      nodePersistence: this.nodePersistence,
    };
  }

  private publishingDeps(): PublishingDeps {
    return {
      getClient: () => this.client,
      isConnected: () => this.connected,
      rootTopic: this.cfg.rootTopic,
      db: this.db,
      nodePersistence: this.nodePersistence,
      codec: { DEFAULT_KEY, encrypt },
    };
  }

  private _expandPsk(psk: Uint8Array): Buffer {
    return expandPsk(psk);
  }
  private _encrypt(key: Buffer, packetId: number, fromNode: number, plaintext: Buffer): Buffer {
    return encrypt(key, packetId, fromNode, plaintext);
  }
  private _decrypt(key: Buffer, packetId: number, fromNode: number, ciphertext: Buffer): Buffer {
    return decrypt(key, packetId, fromNode, ciphertext);
  }
  private async _handleInbound(topic: string, payload: Buffer): Promise<void> {
    await handleInbound(
      this.inboundDeps(),
      {
        handleJsonInbound: (...args) => this._handleJsonInbound(...args),
        upsertFromData: (...args) => this._upsertFromData(...args),
      },
      topic,
      payload,
    );
  }
  private async _handleJsonInbound(
    payload: Buffer,
    channelName: string,
    gatewayId: string,
    regionPath: string,
  ): Promise<void> {
    await handleJsonInbound(this.inboundDeps(), payload, channelName, gatewayId, regionPath);
  }
  private async _upsertFromData(
    nodeId: number,
    data: Protobuf.Mesh.Data,
    rxTime: string,
    gatewayId: string,
    regionPath: string,
    channelName: string,
    snr: number | null,
    hopsAway: number | null,
  ): Promise<void> {
    await upsertFromData(
      this.inboundDeps(),
      nodeId,
      data,
      rxTime,
      gatewayId,
      regionPath,
      channelName,
      snr,
      hopsAway,
    );
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private async _handleMeshPacket(deviceId: string, pkt: any): Promise<void> {
    const state = this.devices.get(deviceId);
    if (!state) return;
    await handleMeshPacket(this.publishingDeps(), state, pkt, () => this._publishSelf(deviceId));
  }
  private async _publishSelf(deviceId: string): Promise<void> {
    const state = this.devices.get(deviceId);
    if (!state) return;
    await publishSelf(this.publishingDeps(), state);
  }
  private async _publishOwnPacket(
    state: DeviceState,
    ch: ChannelInfo,
    portnum: Protobuf.Portnums.PortNum,
    innerPayload: Uint8Array,
  ): Promise<void> {
    await publishOwnPacket(this.publishingDeps(), state, ch, portnum, innerPayload);
  }
  private async _publishMapReport(state: DeviceState, channelName: string): Promise<void> {
    await publishMapReport(this.publishingDeps(), state, channelName);
  }
  private _randomPacketId(): number {
    return randomPacketId();
  }
  private _haversineMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
    return haversineMeters(lat1, lon1, lat2, lon2);
  }
  private _resolveChannelKey(channelName: string): Buffer {
    for (const state of this.devices.values()) {
      for (const ch of state.channels.values()) {
        if (ch.name === channelName) return Buffer.from(ch.key) as Buffer<ArrayBuffer>;
      }
    }
    return DEFAULT_KEY;
  }
  private _getOwnLatLon(): { lat: number; lon: number } | null {
    for (const state of this.devices.values()) {
      const pos = state.cachedPosition;
      if (pos?.latitudeI && pos.longitudeI)
        return { lat: pos.latitudeI / 1e7, lon: pos.longitudeI / 1e7 };
    }
    return null;
  }
  private async _recalcAllDistances(ownLat: number, ownLon: number): Promise<void> {
    await this.db.query(
      `UPDATE mqtt_nodes SET distance_m = (
         6371000.0 * 2.0 * atan2(
           sqrt(GREATEST(0.0,
             power(sin(radians((latitude  - $1) / 2.0)), 2) +
             cos(radians($1)) * cos(radians(latitude)) *
             power(sin(radians((longitude - $2) / 2.0)), 2)
           )),
           sqrt(GREATEST(0.0, 1.0 - (
             power(sin(radians((latitude  - $1) / 2.0)), 2) +
             cos(radians($1)) * cos(radians(latitude)) *
             power(sin(radians((longitude - $2) / 2.0)), 2)
           )))
         )
       ) WHERE latitude IS NOT NULL AND longitude IS NOT NULL`,
      [ownLat, ownLon],
    );
    console.log("[mqtt] recalculated distances for all positioned nodes");
  }
}
