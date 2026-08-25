/** MQTT gateway orchestrator. Protocol and persistence responsibilities live in sibling modules. */
import { Buffer } from "node:buffer";
import { EventEmitter } from "node:events";

import { formatNodeId } from "@foreman/shared";
import { MeshDevice, Types, Protobuf } from "@meshtastic/core";

import { mapMqttNodeRow, type MqttNodeRow } from "../db/repositories/mqtt-nodes.js";
import { createLogger } from "../logger.js";

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
const log = createLogger("mqtt");
const mqttError = (err: unknown) => ({
  name: err instanceof Error ? err.name : "UnknownError",
  code: err instanceof Error ? (err as NodeJS.ErrnoException).code : undefined,
});

export class MqttGateway extends EventEmitter {
  private readonly cfg: Required<MqttGatewayConfig>;
  private client: mqtt.MqttClient | null = null;
  private _connected = false;
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
      this._connected = true;
      log.info({ operation: "connect", broker: this.cfg.broker }, "connected to broker");
      subscribeTransport(this.client!, this.cfg.rootTopic);
      for (const [deviceId] of this.devices)
        this._publishSelf(deviceId).catch((err) =>
          log.error(
            { deviceId, operation: "publish-self", err: mqttError(err) },
            "self publish failed",
          ),
        );
    });
    this.client.on("message", (topic, payload) => {
      this._handleInbound(topic, payload).catch((err) =>
        log.error({ operation: "handle-inbound", err: mqttError(err) }, "inbound handling failed"),
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
        this._connected = false;
        log.info(
          { operation: "disconnect", reasonCode: packet?.reasonCode },
          "disconnected from broker",
        );
      },
    );
    this.client.on("close", () => {
      this._connected = false;
      log.info({ operation: "close" }, "broker connection closed");
    });
    this.client.on("error", (err) =>
      log.error({ operation: "client", err: mqttError(err) }, "MQTT client error"),
    );
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
    this._connected = false;
    log.info({ operation: "stop" }, "gateway stopped");
  }

  /**
   * Process-shutdown hook. Safe to call before the gateway has been started
   * and contains teardown errors so the process coordinator can continue.
   */
  async shutdown(): Promise<void> {
    try {
      this.stop();
    } catch (err) {
      log.error({ operation: "shutdown", err: mqttError(err) }, "gateway shutdown failed");
    }
  }

  get isRunning(): boolean {
    return this.client !== null;
  }

  /** True only while the underlying mqtt.js client has fired "connect" and
   *  has not since fired "disconnect"/"close"/"error"-induced closure.
   *  Backed by the gateway's existing private `_connected` field. */
  get connected(): boolean {
    return this._connected;
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
      log.info(
        { deviceId, operation: "schedule-announce", gatewayId: state.gatewayId, delayMs: 2000 },
        "device ready; scheduling announcement",
      );
      setTimeout(() => {
        this._publishSelf(deviceId).catch((err) =>
          log.error(
            { deviceId, operation: "publish-self", err: mqttError(err) },
            "self publish failed",
          ),
        );
        if (!state.selfAnnounceTimer) {
          state.selfAnnounceTimer = setInterval(() => {
            this._publishSelf(deviceId).catch((err) =>
              log.error(
                { deviceId, operation: "publish-self", err: mqttError(err) },
                "self publish failed",
              ),
            );
          }, this.cfg.selfAnnounceInterval);
        }
      }, 2000);
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    meshDevice.events.onMyNodeInfo.subscribe((info: any) => {
      state.nodeNum = info.myNodeNum;
      state.gatewayId = formatNodeId(info.myNodeNum);
      log.info(
        { deviceId, operation: "own-node-info", gatewayId: state.gatewayId },
        "device node number received",
      );
      scheduleAnnounceIfReady();
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    meshDevice.events.onChannelPacket.subscribe((ch: any) => {
      const idx = ch.index;
      const name = ch.settings?.name || "LongFast";
      const rawPsk = ch.settings?.psk;
      state.channels.set(idx, { name, key: rawPsk ? this._expandPsk(rawPsk) : DEFAULT_KEY });
      log.info(
        { deviceId, operation: "channel-info", channelIndex: idx, channelName: name },
        "device channel received",
      );
      scheduleAnnounceIfReady();
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    meshDevice.events.onNodeInfoPacket.subscribe((nodeInfo: any) => {
      const isOurs =
        state.nodeNum !== 0
          ? nodeInfo.num === state.nodeNum
          : !!(nodeInfo.user?.id && nodeInfo.user.id === state.gatewayId);
      log.info(
        {
          deviceId,
          operation: "node-info",
          nodeId: formatNodeId(nodeInfo.num ?? 0),
          ownNode: isOurs,
          hasPosition: !!nodeInfo.position?.latitudeI,
        },
        "node info received",
      );
      if (isOurs) {
        if (nodeInfo.user) state.cachedUser = nodeInfo.user as Protobuf.Mesh.User;
        if (nodeInfo.position?.latitudeI) {
          state.cachedPosition = nodeInfo.position as Protobuf.Mesh.Position;
          log.info(
            { deviceId, operation: "cache-own-position", source: "node-info" },
            "cached own position",
          );
        }
      }
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    meshDevice.events.onPositionPacket.subscribe((pkt: any) => {
      log.info(
        {
          deviceId,
          packetId: pkt.id,
          operation: "position-packet",
          fromNodeId: formatNodeId(pkt.from ?? 0),
        },
        "position packet received",
      );
      if (pkt.from !== state.nodeNum) return;
      const hadPosition = !!state.cachedPosition;
      state.cachedPosition = pkt.data as Protobuf.Mesh.Position;
      log.info(
        { deviceId, packetId: pkt.id, operation: "cache-own-position", source: "position-packet" },
        "cached own position",
      );
      if (!hadPosition && state.announceScheduled)
        this._publishSelf(deviceId).catch((err) =>
          log.error(
            { deviceId, operation: "publish-self", err: mqttError(err) },
            "self publish failed",
          ),
        );
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
        ).catch((err) =>
          log.error(
            { deviceId, operation: "recalculate-distances", err: mqttError(err) },
            "distance recalculation failed",
          ),
        );
      }
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    meshDevice.events.onMeshPacket.subscribe((pkt: any) => {
      this._handleMeshPacket(deviceId, pkt).catch((err) =>
        log.error(
          { deviceId, packetId: pkt.id, operation: "handle-mesh-packet", err: mqttError(err) },
          "mesh packet handling failed",
        ),
      );
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    meshDevice.events.onDeviceStatus.subscribe((status: any) => {
      log.info(
        { deviceId, operation: "device-status", status: Types.DeviceStatusEnum[status] ?? status },
        "device status changed",
      );
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
    const { rows } = await this.db
      .query<MqttNodeRow>(`SELECT node_id, long_name, short_name, hw_model, public_key, last_heard,
              latitude, longitude, altitude, last_gateway, region_path, channel_name, snr, hops_away, distance_m
       FROM mqtt_nodes ORDER BY last_heard DESC NULLS LAST`);
    return rows.map(mapMqttNodeRow);
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
      isConnected: () => this._connected,
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
    log.info({ operation: "recalculate-distances" }, "recalculated positioned-node distances");
  }
}
