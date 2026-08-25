/**
 * MqttGateway — publishes Meshtastic mesh traffic to an MQTT broker.
 *
 * Mirrors what a WiFi-capable Meshtastic device would do natively.
 * Necessary because nRF52-based devices (e.g. Seeed Wio Tracker L1) have no
 * WiFi and cannot connect to MQTT on their own.
 *
 * Topic layout:
 *   {root}/2/e/{channel}/{!gatewayId}  — encrypted ServiceEnvelope (all traffic)
 *   {root}/2/map/                       — unencrypted ServiceEnvelope (MapReport)
 */

import { Buffer } from "node:buffer";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { EventEmitter } from "node:events";

import { create, toBinary, fromBinary } from "@bufbuild/protobuf";
import { formatNodeId } from "@foreman/shared";
import { MeshDevice, Types, Protobuf } from "@meshtastic/core";
import mqtt from "mqtt";

import { activityLog } from "../activity/log.js";

import type { PGlite } from "@electric-sql/pglite";
import type { MqttNode } from "@foreman/shared";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

export interface MqttGatewayConfig {
  broker: string;
  port: number;
  username: string;
  password: string;
  rootTopic: string;
  /** Re-announce our own node on this interval (ms). Default: 15 minutes. */
  selfAnnounceInterval?: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * The well-known default Meshtastic channel key.
 * PSK value 0x01 ("AQ==") on the device expands to this 16-byte key.
 * Public knowledge — documented in every Meshtastic client.
 */
const DEFAULT_KEY = Buffer.from("1PG7OiApB1nwvP+rz05pAQ==", "base64");

const DEFAULT_SELF_ANNOUNCE_INTERVAL = 15 * 60 * 1000; // 15 minutes

// ---------------------------------------------------------------------------
// Per-device state
// ---------------------------------------------------------------------------

interface ChannelInfo {
  name: string;
  key: Buffer;
}

interface DeviceState {
  nodeNum: number;
  gatewayId: string;
  channels: Map<number, ChannelInfo>; // channel index → name + AES key
  cachedUser: Protobuf.Mesh.User | null;
  cachedPosition: Protobuf.Mesh.Position | null;
  selfAnnounceTimer: NodeJS.Timeout | null;
  announceScheduled: boolean; // prevents duplicate announce timers
  lastRelayAnnounceMs: number; // timestamp of last relay-triggered self-announce
  lastDistanceRecalcMs: number; // timestamp of last bulk distance recalculation
}

// ---------------------------------------------------------------------------
// MqttGateway
// ---------------------------------------------------------------------------

export class MqttGateway extends EventEmitter {
  private readonly cfg: Required<MqttGatewayConfig>;
  private client: mqtt.MqttClient | null = null;
  private connected = false;
  private readonly devices = new Map<string, DeviceState>();

  constructor(
    cfg: MqttGatewayConfig,
    private readonly db: PGlite,
  ) {
    super();
    this.cfg = {
      selfAnnounceInterval: DEFAULT_SELF_ANNOUNCE_INTERVAL,
      ...cfg,
    };
  }

  // ---------------------------------------------------------------------------
  // MQTT connection lifecycle
  // ---------------------------------------------------------------------------

  start(): void {
    const url = `mqtt://${this.cfg.broker}:${this.cfg.port}`;
    const clientId = `foreman_${randomBytes(4).toString("hex")}`;
    this.client = mqtt.connect(url, {
      username: this.cfg.username,
      password: this.cfg.password,
      clientId,
      reconnectPeriod: 5000,
      keepalive: 60,
    });
    console.log(`[mqtt] connecting as clientId=${clientId}`);

    this.client.on("connect", () => {
      this.connected = true;
      console.log(`[mqtt] connected to ${this.cfg.broker}`);

      // Subscribe to everything under the configured root topic.
      // Regions use inconsistent depths (centralvalley = 4 levels, Humboldt/Eureka = 5 levels,
      // CentralCoast// = 5 levels with empty city) so a fixed +/+/2/e/# pattern misses some.
      // _handleInbound already finds 2/e by searching, so a broad # subscription is safe.
      // Special value "all" subscribes to every topic on the broker.
      const subTopic = this.cfg.rootTopic === "all" ? "#" : `${this.cfg.rootTopic}/#`;
      this.client!.subscribe(subTopic, (err) => {
        if (err) console.error("[mqtt] subscribe error:", err.message);
        else console.log(`[mqtt] subscribed to ${subTopic}`);
      });

      // Re-announce all currently attached devices on reconnect
      for (const [deviceId] of this.devices) {
        this._publishSelf(deviceId).catch(console.error);
      }
    });

    this.client.on("message", (topic, payload) => {
      this._handleInbound(topic, payload).catch((err) =>
        console.error("[mqtt] inbound error:", err.message),
      );
    });

    this.client.on(
      "disconnect",
      (packet: { reasonCode?: number; properties?: { reasonString?: string } } | undefined) => {
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

    this.client.on("error", (err) => {
      console.error("[mqtt] error:", err.message);
    });
  }

  stop(): void {
    for (const [, state] of this.devices) {
      if (state.selfAnnounceTimer) {
        clearInterval(state.selfAnnounceTimer);
        state.selfAnnounceTimer = null;
      }
    }
    this.client?.end(true); // force-close so reconnectPeriod doesn't restart it
    this.client = null;
    this.connected = false;
    console.log("[mqtt] stopped");
  }

  get isRunning(): boolean {
    return this.client !== null;
  }

  // ---------------------------------------------------------------------------
  // Device attachment
  // ---------------------------------------------------------------------------

  /**
   * Subscribe to a MeshDevice's events so its traffic is forwarded to MQTT.
   * Call this immediately after the device connects and is configured.
   */
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

    // Schedule a single self-announce once we have both nodeNum and channels.
    // Called after every piece of config arrives — safe to call repeatedly.
    const scheduleAnnounceIfReady = () => {
      if (state.announceScheduled) return;
      if (state.nodeNum === 0 || state.channels.size === 0) return;
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

    // Our own node number — arrives early in the configure handshake
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    meshDevice.events.onMyNodeInfo.subscribe((info: any) => {
      state.nodeNum = info.myNodeNum;
      state.gatewayId = formatNodeId(info.myNodeNum);
      console.log(`[mqtt] device ${deviceId} nodeNum = ${state.gatewayId}`);
      scheduleAnnounceIfReady();
    });

    // Channel config — needed for channel name and PSK
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    meshDevice.events.onChannelPacket.subscribe((ch: any) => {
      const idx = ch.index;
      const name = ch.settings?.name || "LongFast";
      const rawPsk = ch.settings?.psk;
      const key = rawPsk ? this._expandPsk(rawPsk) : DEFAULT_KEY;
      state.channels.set(idx, { name, key });
      console.log(`[mqtt] device ${deviceId} channel ${idx} = "${name}"`);
      scheduleAnnounceIfReady();
    });

    // Cache own user info and position for self-announce only — do NOT write to mqtt_nodes here.
    // mqtt_nodes is exclusively populated from _handleInbound (remote broker data).
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

    // Cache own position for self-announce — fires when device transmits its own position
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    meshDevice.events.onPositionPacket.subscribe((pkt: any) => {
      console.log(
        `[mqtt] positionPacket from=${formatNodeId(pkt.from ?? 0)} stateNum=${state.gatewayId} latI=${pkt.data?.latitudeI ?? "none"}`,
      );
      if (pkt.from === state.nodeNum) {
        const hadPosition = !!state.cachedPosition;
        state.cachedPosition = pkt.data as Protobuf.Mesh.Position;
        console.log(
          `[mqtt] cached own position from positionPacket: lat=${pkt.data?.latitudeI / 1e7}`,
        );
        // Re-announce immediately if this is the first position fix — the initial
        // self-announce fired before GPS was ready so remote instances missed our location.
        if (!hadPosition && state.announceScheduled) {
          this._publishSelf(deviceId).catch(console.error);
        }
        // Notify device-manager of current GPS detail on every fix
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
        // Recalculate distance_m for all known nodes — rate-limited to once per 5 min
        const RECALC_INTERVAL_MS = 5 * 60 * 1000;
        if (
          state.cachedPosition.latitudeI &&
          state.cachedPosition.longitudeI &&
          Date.now() - state.lastDistanceRecalcMs > RECALC_INTERVAL_MS
        ) {
          state.lastDistanceRecalcMs = Date.now();
          const lat = state.cachedPosition.latitudeI / 1e7;
          const lon = state.cachedPosition.longitudeI / 1e7;
          this._recalcAllDistances(lat, lon).catch(console.error);
        }
      }
    });

    // Forward all raw mesh packets to MQTT
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    meshDevice.events.onMeshPacket.subscribe((pkt: any) => {
      this._handleMeshPacket(deviceId, pkt).catch((err) =>
        console.error(`[mqtt] packet error on ${deviceId}:`, err.message),
      );
    });

    // DeviceConfigured is a fallback trigger in case onMyNodeInfo/onChannelPacket
    // fire after this event (ordering varies by firmware version)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    meshDevice.events.onDeviceStatus.subscribe((status: any) => {
      console.log(`[mqtt] device ${deviceId} status = ${Types.DeviceStatusEnum[status] ?? status}`);
      if (status === Types.DeviceStatusEnum.DeviceConfigured) {
        scheduleAnnounceIfReady();
      }
    });
  }

  detachDevice(deviceId: string): void {
    const state = this.devices.get(deviceId);
    if (!state) return;
    if (state.selfAnnounceTimer) clearInterval(state.selfAnnounceTimer);
    this.devices.delete(deviceId);
  }

  // ---------------------------------------------------------------------------
  // Packet handling
  // ---------------------------------------------------------------------------

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private async _handleMeshPacket(deviceId: string, pkt: any): Promise<void> {
    if (!this.connected || !this.client) return;

    const state = this.devices.get(deviceId);
    if (!state) return;

    // Don't re-publish packets that arrived via MQTT downlink
    if (pkt.viaMqtt) return;

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

    const ch = state.channels.get(chIdx) ?? { name: "LongFast", key: DEFAULT_KEY };

    let encryptedPayload: Uint8Array;

    if (isEncrypted) {
      // Packet couldn't be decrypted locally — pass encrypted bytes straight through
      encryptedPayload = pkt.payloadVariant.value as Uint8Array;
    } else {
      // Packet was decrypted by the library — re-encrypt for MQTT
      const portnum: number = pkt.payloadVariant.value.portnum ?? 0;
      const innerPayload: Uint8Array = pkt.payloadVariant.value.payload ?? new Uint8Array();

      const dataBytes = toBinary(
        Protobuf.Mesh.DataSchema,
        create(Protobuf.Mesh.DataSchema, {
          portnum,
          payload: innerPayload,
        }),
      );

      encryptedPayload = this._encrypt(ch.key, packetId, fromNum, Buffer.from(dataBytes));
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

    const topic = `${this.cfg.rootTopic === "all" ? "msh" : this.cfg.rootTopic}/2/e/${ch.name}/${state.gatewayId}`;
    this.client.publish(
      topic,
      Buffer.from(toBinary(Protobuf.Mqtt.ServiceEnvelopeSchema, envelope)),
    );

    const portnumName = isDecoded
      ? ((Protobuf.Portnums.PortNum as Record<number, string>)[pkt.payloadVariant.value.portnum] ??
        "?")
      : "encrypted";
    console.log(`[mqtt] pub  ${portnumName} from ${formatNodeId(fromNum)} → ${topic}`);

    // Piggyback a self-announce on relay traffic so remote app instances can see
    // this gateway node without waiting for the 15-minute announce timer.
    // Rate-limited to once per 5 minutes to avoid flooding the channel.
    const RELAY_ANNOUNCE_INTERVAL_MS = 5 * 60 * 1000;
    if (
      state.cachedPosition &&
      Date.now() - state.lastRelayAnnounceMs > RELAY_ANNOUNCE_INTERVAL_MS
    ) {
      state.lastRelayAnnounceMs = Date.now();
      this._publishSelf(deviceId).catch(console.error);
    }
  }

  // ---------------------------------------------------------------------------
  // Self-announcement
  // ---------------------------------------------------------------------------

  private async _publishSelf(deviceId: string): Promise<void> {
    if (!this.connected || !this.client) return;

    const state = this.devices.get(deviceId);
    if (!state || state.nodeNum === 0) return;

    console.log(
      `[mqtt] _publishSelf ${state.gatewayId}: hasUser=${!!state.cachedUser} hasPos=${!!state.cachedPosition} latI=${state.cachedPosition?.latitudeI ?? "none"} lonI=${state.cachedPosition?.longitudeI ?? "none"}`,
    );

    const ch = state.channels.get(0) ?? { name: "LongFast", key: DEFAULT_KEY };

    // NODEINFO_APP
    if (state.cachedUser) {
      await this._publishOwnPacket(
        state,
        ch,
        Protobuf.Portnums.PortNum.NODEINFO_APP,
        toBinary(Protobuf.Mesh.UserSchema, state.cachedUser),
      );
    }

    // POSITION_APP
    const pos = state.cachedPosition;
    if (pos && (pos.latitudeI || pos.longitudeI)) {
      await this._publishOwnPacket(
        state,
        ch,
        Protobuf.Portnums.PortNum.POSITION_APP,
        toBinary(Protobuf.Mesh.PositionSchema, pos),
      );

      // Write our own position directly — don't rely on broker echo
      const lat = pos.latitudeI != null ? pos.latitudeI / 1e7 : null;
      const lon = pos.longitudeI != null ? pos.longitudeI / 1e7 : null;
      const alt = pos.altitude ?? null;
      const publishRoot = this.cfg.rootTopic === "all" ? "msh" : this.cfg.rootTopic;
      const regionPath = publishRoot.split("/").slice(1).join("/"); // strip leading "msh"
      const rxTime = new Date().toISOString();
      if (lat !== null && lon !== null && !(lat === 0 && lon === 0)) {
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
          [state.nodeNum, lat, lon, alt, rxTime, state.gatewayId, regionPath],
        );
        await this._emitNodeUpdate(
          state.nodeNum,
          rxTime,
          state.gatewayId,
          regionPath,
          "LongFast",
          null,
          null,
        );
        console.log(
          `[mqtt] self position written to mqtt_nodes: ${lat.toFixed(5)}, ${lon.toFixed(5)}`,
        );
      }
    }

    // MAP_REPORT_APP — unencrypted, goes to 2/map/
    if (state.cachedUser) {
      await this._publishMapReport(state, ch.name);
    }
  }

  private async _publishOwnPacket(
    state: DeviceState,
    ch: ChannelInfo,
    portnum: Protobuf.Portnums.PortNum,
    innerPayload: Uint8Array,
  ): Promise<void> {
    if (!this.client) return;

    const packetId = this._randomPacketId();
    const dataBytes = toBinary(
      Protobuf.Mesh.DataSchema,
      create(Protobuf.Mesh.DataSchema, {
        portnum,
        payload: innerPayload,
      }),
    );
    const encrypted = this._encrypt(ch.key, packetId, state.nodeNum, Buffer.from(dataBytes));

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

    const topic = `${this.cfg.rootTopic === "all" ? "msh" : this.cfg.rootTopic}/2/e/${ch.name}/${state.gatewayId}`;
    this.client.publish(
      topic,
      Buffer.from(toBinary(Protobuf.Mqtt.ServiceEnvelopeSchema, envelope)),
    );
    console.log(`[mqtt] self ${Protobuf.Portnums.PortNum[portnum]} → ${topic}`);
  }

  private async _publishMapReport(state: DeviceState, channelName: string): Promise<void> {
    if (!this.client || !state.cachedUser) return;

    const user = state.cachedUser;
    const pos = state.cachedPosition;
    const packetId = this._randomPacketId();
    const hasDefaultCh = (state.channels.get(0)?.key ?? DEFAULT_KEY).equals(DEFAULT_KEY);

    const report = create(Protobuf.Mqtt.MapReportSchema, {
      longName: user.longName,
      shortName: user.shortName,
      hwModel: user.hwModel,
      hasDefaultChannel: hasDefaultCh,
      numOnlineLocalNodes: state.channels.size,
      ...(pos?.latitudeI
        ? {
            latitudeI: pos.latitudeI,
            longitudeI: pos.longitudeI ?? 0,
            altitude: pos.altitude ?? 0,
          }
        : {}),
    });

    const reportBytes = toBinary(Protobuf.Mqtt.MapReportSchema, report);

    // Map reports: unencrypted MeshPacket (decoded variant), topic = 2/map/
    const data = create(Protobuf.Mesh.DataSchema, {
      portnum: Protobuf.Portnums.PortNum.MAP_REPORT_APP,
      payload: reportBytes,
    });

    const meshPkt = create(Protobuf.Mesh.MeshPacketSchema, {
      from: state.nodeNum,
      to: 0xffffffff,
      id: packetId,
      rxTime: Math.floor(Date.now() / 1000),
      hopLimit: 3,
      payloadVariant: { case: "decoded", value: data },
    });

    const envelope = create(Protobuf.Mqtt.ServiceEnvelopeSchema, {
      packet: meshPkt,
      channelId: channelName,
      gatewayId: state.gatewayId,
    });

    const topic = `${this.cfg.rootTopic === "all" ? "msh" : this.cfg.rootTopic}/2/map/`;
    this.client.publish(
      topic,
      Buffer.from(toBinary(Protobuf.Mqtt.ServiceEnvelopeSchema, envelope)),
    );
    console.log(`[mqtt] self MAP_REPORT_APP → ${topic}`);
  }

  // ---------------------------------------------------------------------------
  // Public DB accessors
  // ---------------------------------------------------------------------------

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
    }>(
      `SELECT node_id, long_name, short_name, hw_model, public_key, last_heard,
              latitude, longitude, altitude, last_gateway, region_path, channel_name, snr, hops_away, distance_m
       FROM mqtt_nodes ORDER BY last_heard DESC NULLS LAST`,
    );
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

  // ---------------------------------------------------------------------------
  // Inbound MQTT message handling
  // ---------------------------------------------------------------------------

  private async _handleInbound(topic: string, payload: Buffer): Promise<void> {
    const parts = topic.split("/");

    // JSON traffic: {root}/2/json/{channel}/{!gatewayId}
    const jsonIdx = parts.indexOf("json");
    if (jsonIdx !== -1 && parts[jsonIdx - 1] === "2") {
      const channelName = parts[jsonIdx + 1] ?? "unknown";
      const gatewayId = parts[jsonIdx + 2] ?? "unknown";
      const regionPath = parts
        .slice(1, jsonIdx - 1)
        .filter(Boolean)
        .join("/");
      await this._handleJsonInbound(payload, channelName, gatewayId, regionPath);
      return;
    }

    // Only process encrypted traffic: {root}/2/e/{channel}/{!gatewayId}
    const eIdx = parts.indexOf("e");
    if (eIdx === -1 || parts[eIdx - 1] !== "2") {
      console.log(`[mqtt] inbound skip (not 2/e): ${topic}`);
      return;
    }
    const channelName = parts[eIdx + 1] ?? "LongFast";
    const gatewayId = parts[eIdx + 2] ?? "unknown";
    // Region path = everything between "msh/" and "/2/e" e.g. "US/CA/Humboldt/Eureka"
    // Filter empty segments to handle topics without a city level (double-slash, e.g. msh/US/CA/CentralCoast//2/e/...)
    const regionPath = parts
      .slice(1, eIdx - 1)
      .filter(Boolean)
      .join("/");

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
      // Cleartext packet — node has MQTT encryption disabled, use payload directly
      data = pkt.payloadVariant.value as Protobuf.Mesh.Data;
    } else if (pkt.payloadVariant?.case === "encrypted") {
      // Try to decrypt with the channel key — fall back to DEFAULT_KEY
      let channelKey = DEFAULT_KEY;
      for (const state of this.devices.values()) {
        for (const [, ch] of state.channels) {
          if (ch.name === channelName) {
            channelKey = Buffer.from(ch.key) as Buffer<ArrayBuffer>;
            break;
          }
        }
      }
      try {
        const plain = this._decrypt(
          channelKey,
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

    await this._upsertFromData(
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
    if (nodeId === 0) return;

    const portnum = data.portnum;

    if (portnum === Protobuf.Portnums.PortNum.NODEINFO_APP) {
      let user: Protobuf.Mesh.User;
      try {
        user = fromBinary(Protobuf.Mesh.UserSchema, data.payload);
      } catch {
        return;
      }

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
          rxTime,
          gatewayId,
          regionPath,
          channelName,
          snr,
          hopsAway,
        ],
      );
      await this._emitNodeUpdate(nodeId, rxTime, gatewayId, regionPath, channelName, snr, hopsAway);
    } else if (portnum === Protobuf.Portnums.PortNum.POSITION_APP) {
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

      const own = this._getOwnLatLon();
      const distM = own ? this._haversineMeters(own.lat, own.lon, lat, lon) : null;

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
        [nodeId, lat, lon, alt, rxTime, gatewayId, regionPath, channelName, snr, hopsAway, distM],
      );

      // Also update the local mesh nodes table — MQTT is authoritative for position
      // when the node isn't being heard directly over radio by the connected device.
      await this.db.query(
        `UPDATE nodes SET latitude = $1, longitude = $2, altitude = COALESCE($3, altitude),
           last_heard = GREATEST(last_heard, $4)
         WHERE node_id = $5`,
        [lat, lon, alt, rxTime, nodeId],
      );

      await this._emitNodeUpdate(nodeId, rxTime, gatewayId, regionPath, channelName, snr, hopsAway);
    } else {
      // Any other portnum — upsert so an unknown node is created on first contact,
      // then fill in details when NODEINFO / POSITION packets eventually arrive.
      await this.db.query(
        `INSERT INTO mqtt_nodes(node_id, last_heard, last_gateway, region_path, channel_name)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT(node_id) DO UPDATE SET
           last_heard   = GREATEST(EXCLUDED.last_heard,  mqtt_nodes.last_heard),
           last_gateway = EXCLUDED.last_gateway,
           region_path  = EXCLUDED.region_path,
           channel_name = EXCLUDED.channel_name`,
        [nodeId, rxTime, gatewayId, regionPath, channelName],
      );
      await this._emitNodeUpdate(nodeId, rxTime, gatewayId, regionPath, channelName, snr, hopsAway);
    }
  }

  private async _emitNodeUpdate(
    nodeId: number,
    rxTime: string,
    gatewayId: string,
    regionPath: string,
    channelName: string,
    snr: number | null,
    hopsAway: number | null,
  ): Promise<void> {
    const { rows } = await this.db.query<{
      node_id: number;
      long_name: string | null;
      short_name: string | null;
      hw_model: number | null;
      public_key: string | null;
      latitude: number | null;
      longitude: number | null;
      altitude: number | null;
      distance_m: number | null;
    }>(
      `SELECT node_id, long_name, short_name, hw_model, public_key,
              latitude, longitude, altitude, distance_m FROM mqtt_nodes WHERE node_id = $1`,
      [nodeId],
    );
    if (!rows[0]) return;
    const r = rows[0];
    const node: MqttNode = {
      nodeId: r.node_id,
      longName: r.long_name,
      shortName: r.short_name,
      hwModel: r.hw_model,
      publicKey: r.public_key,
      lastHeard: rxTime,
      latitude: r.latitude,
      longitude: r.longitude,
      altitude: r.altitude,
      lastGateway: gatewayId,
      regionPath,
      channelName,
      snr,
      hopsAway,
      distanceM: r.distance_m,
    };
    this.emit("mqtt_node:update", node);
  }

  private async _handleJsonInbound(
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

    await this.db.query(
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

    // For position packets, also keep mqtt_nodes up-to-date so the node
    // appears on the map immediately without waiting for a protobuf packet.
    if (type === "position" && pld && typeof pld === "object") {
      const p = pld as Record<string, unknown>;
      const latI = typeof p.latitude_i === "number" ? p.latitude_i : null;
      const lonI = typeof p.longitude_i === "number" ? p.longitude_i : null;
      const alt = typeof p.altitude === "number" ? p.altitude : null;

      if (latI !== null && lonI !== null) {
        const lat = latI / 1e7;
        const lon = lonI / 1e7;

        if (lat !== 0 || lon !== 0) {
          const own = this._getOwnLatLon();
          const distM = own ? this._haversineMeters(own.lat, own.lon, lat, lon) : null;

          await this.db.query(
            `INSERT INTO mqtt_nodes(node_id, latitude, longitude, altitude, last_heard,
               last_gateway, region_path, channel_name, snr, hops_away, distance_m)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
             ON CONFLICT(node_id) DO UPDATE SET
               latitude     = EXCLUDED.latitude,
               longitude    = EXCLUDED.longitude,
               altitude     = COALESCE(EXCLUDED.altitude,   mqtt_nodes.altitude),
               last_heard   = GREATEST(EXCLUDED.last_heard, mqtt_nodes.last_heard),
               last_gateway = EXCLUDED.last_gateway,
               region_path  = EXCLUDED.region_path,
               channel_name = EXCLUDED.channel_name,
               snr          = COALESCE(EXCLUDED.snr,        mqtt_nodes.snr),
               hops_away    = COALESCE(EXCLUDED.hops_away,  mqtt_nodes.hops_away),
               distance_m   = COALESCE(EXCLUDED.distance_m, mqtt_nodes.distance_m)`,
            [
              fromNode,
              lat,
              lon,
              alt,
              rxTime,
              gatewayId,
              regionPath,
              channelName,
              snr,
              hopsAway,
              distM,
            ],
          );

          await this._emitNodeUpdate(
            fromNode,
            rxTime,
            gatewayId,
            regionPath,
            channelName,
            snr,
            hopsAway,
          );
        }
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Crypto helpers
  // ---------------------------------------------------------------------------

  private _expandPsk(psk: Uint8Array): Buffer {
    if (psk.length === 1 && psk[0] === 0x01) return DEFAULT_KEY;
    if (psk.length === 16 || psk.length === 32) return Buffer.from(psk);
    return Buffer.from(psk).subarray(0, 16).equals(Buffer.alloc(16))
      ? DEFAULT_KEY
      : Buffer.concat([Buffer.from(psk), Buffer.alloc(16)]).subarray(0, 16);
  }

  private _decrypt(key: Buffer, packetId: number, fromNode: number, ciphertext: Buffer): Buffer {
    const nonce = Buffer.alloc(16);
    nonce.writeUInt32LE(packetId >>> 0, 0);
    nonce.writeUInt32LE(fromNode >>> 0, 8);
    const decipher = createDecipheriv("aes-128-ctr", key, nonce);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  }

  private _encrypt(key: Buffer, packetId: number, fromNode: number, plaintext: Buffer): Buffer {
    // Nonce: packetId as uint64 LE (upper 4 bytes = 0) + fromNode as uint64 LE
    const nonce = Buffer.alloc(16);
    nonce.writeUInt32LE(packetId >>> 0, 0);
    nonce.writeUInt32LE(fromNode >>> 0, 8);
    const cipher = createCipheriv("aes-128-ctr", key, nonce);
    return Buffer.concat([cipher.update(plaintext), cipher.final()]);
  }

  private _randomPacketId(): number {
    return randomBytes(4).readUInt32LE(0);
  }

  // ---------------------------------------------------------------------------
  // Distance helpers
  // ---------------------------------------------------------------------------

  /** Haversine distance in metres between two lat/lon points. */
  private _haversineMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
    const R = 6_371_000;
    const φ1 = (lat1 * Math.PI) / 180;
    const φ2 = (lat2 * Math.PI) / 180;
    const Δφ = ((lat2 - lat1) * Math.PI) / 180;
    const Δλ = ((lon2 - lon1) * Math.PI) / 180;
    const a = Math.sin(Δφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  /** Returns the cached lat/lon of the first attached device that has a GPS fix. */
  private _getOwnLatLon(): { lat: number; lon: number } | null {
    for (const state of this.devices.values()) {
      const pos = state.cachedPosition;
      if (pos?.latitudeI && pos.longitudeI) {
        return { lat: pos.latitudeI / 1e7, lon: pos.longitudeI / 1e7 };
      }
    }
    return null;
  }

  /**
   * Bulk-recalculate distance_m for every node with a known position.
   * Only updates the DB — does NOT emit individual node updates to avoid
   * flooding the WS clients with hundreds of messages. Each node will carry
   * its refreshed distance the next time it emits a natural update event.
   */
  private async _recalcAllDistances(ownLat: number, ownLon: number): Promise<void> {
    // GREATEST(0, ...) guards against sqrt of a tiny negative from floating-point rounding
    // (haversine 'a' is mathematically in [0,1] but can exceed 1 by epsilon in practice)
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
       )
       WHERE latitude IS NOT NULL AND longitude IS NOT NULL`,
      [ownLat, ownLon],
    );
    console.log(`[mqtt] recalculated distances for all positioned nodes`);
  }
}
