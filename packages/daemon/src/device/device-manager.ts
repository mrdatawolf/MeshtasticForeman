import { Buffer } from "node:buffer";
import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";

import { fromBinary } from "@bufbuild/protobuf";
import { formatNodeId, resolveNodeName } from "@foreman/shared";
import { MeshDevice, Types, Protobuf } from "@meshtastic/core";
import { TransportNodeSerial } from "@meshtastic/transport-node-serial";

import { activityLog } from "../activity/log.js";
import { toPlainObject, decodePayload } from "../decode-payload.js";

import type { DaemonConfig } from "../config.js";
import type { MqttGateway } from "../mqtt/gateway.js";
import type { PGlite } from "@electric-sql/pglite";
import type {
  ServerEvent,
  Message,
  NodeInfo,
  DeviceConfig,
  Channel,
  GpsDetail,
} from "@foreman/shared";

export interface ConnectedDevice {
  id: string;
  port: string;
  name: string;
  connectedAt: string;
  meshDevice: MeshDevice;
  transport: TransportNodeSerial;
}

/**
 * DeviceManager owns all physical device connections.
 * It runs for the lifetime of the daemon process — connections persist
 * regardless of frontend client activity.
 *
 * Responsibilities:
 * - Open/close serial connections to Meshtastic devices
 * - Reconnect automatically on disconnect
 * - Persist device config and state to PGlite
 * - Emit events that the WebSocket broadcaster listens to
 */
export class DeviceManager extends EventEmitter {
  private devices = new Map<string, ConnectedDevice>();
  /** Ports with a pending reconnect timer — prevents stacked reconnect loops */
  private reconnectingPorts = new Set<string>();
  /** Pending reconnect timers, so an explicit disconnect can cancel them. */
  private reconnectTimers = new Map<string, NodeJS.Timeout>();
  /** Reconnect attempt count per port — used for exponential backoff */
  private reconnectAttempts = new Map<string, number>();
  private mqttGateway: MqttGateway | null = null;
  /** Last time each device received any mesh packet (for watchdog) */
  private lastPacketMs = new Map<string, number>();
  /** Active watchdog timers */
  private watchdogTimers = new Map<string, NodeJS.Timeout>();
  /** Self node number for each device (populated from onMyNodeInfo) */
  private myNodeIds = new Map<string, number>();
  /** Most recent battery level (0–100) for each device */
  private batteryLevels = new Map<string, number>();
  /** Devices that have sent a valid GPS fix this session */
  private gpsAcquired = new Set<string>();
  /** Latest GPS detail per device */
  private gpsDetails = new Map<string, GpsDetail>();
  /** Correlates packetId → replyId for in-flight text packets between onMeshPacket and onMessagePacket */
  private pendingReplyIds = new Map<number, number>();

  constructor(
    private readonly db: PGlite,
    private readonly config: Pick<DaemonConfig, "bot">,
  ) {
    super();
  }

  setMqttGateway(gateway: MqttGateway): void {
    this.mqttGateway = gateway;
    gateway.on("gps:position", (deviceId: string, detail: GpsDetail) => {
      this.gpsAcquired.add(deviceId);
      this.gpsDetails.set(deviceId, detail);
      const device = this.devices.get(deviceId);
      // Re-emit status on every fix so the frontend GPS panel stays current
      if (device) {
        this._emitStatus(deviceId, device.name, device.port, "connected", device.connectedAt);
      }
    });
  }

  /** Reconnect all devices that were saved in the DB from a previous run. */
  async reconnectSaved() {
    const { rows } = await this.db.query<{ id: string; name: string; port: string }>(
      "SELECT id, name, port FROM devices ORDER BY created_at",
    );
    for (const row of rows) {
      await this.connect(row.port, row.name, row.id).catch((err) => {
        console.warn(`[devices] failed to reconnect ${row.port}:`, err.message);
      });
    }
  }

  async listDevices() {
    const { rows } = await this.db.query<{
      id: string;
      name: string;
      port: string;
      hw_model: string | null;
      firmware: string | null;
      last_seen: string | null;
    }>("SELECT id, name, port, hw_model, firmware, last_seen FROM devices ORDER BY created_at");
    return rows;
  }

  async connect(port: string, name: string, existingId?: string): Promise<ConnectedDevice> {
    // Check for existing live connection on this port
    for (const [, dev] of this.devices) {
      if (dev.port === port) return dev;
    }

    // Reuse existing DB row for this port if one exists, to avoid accumulating duplicates
    let id = existingId;
    if (!id) {
      const { rows } = await this.db.query<{ id: string }>(
        "SELECT id FROM devices WHERE port = $1 ORDER BY created_at LIMIT 1",
        [port],
      );
      id = rows[0]?.id ?? randomUUID();
    }

    // Delete any duplicate rows for this port that aren't the canonical id
    await this.db.query("DELETE FROM devices WHERE port = $1 AND id != $2", [port, id]);

    // Upsert canonical row
    await this.db.query(
      `INSERT INTO devices(id, name, port)
       VALUES ($1, $2, $3)
       ON CONFLICT(id) DO UPDATE SET name = EXCLUDED.name, port = EXCLUDED.port`,
      [id, name, port],
    );

    this._emitStatus(id, name, port, "connecting");

    // Open serial port and create transport
    let transport: TransportNodeSerial;
    try {
      transport = await TransportNodeSerial.create(port, 115200);
    } catch (err) {
      // A failed open must replace the earlier "connecting" event; otherwise
      // the UI remains stuck even though no connection attempt is active.
      this._emitStatus(id, name, port, "error");
      throw err;
    }

    // MeshDevice constructor starts piping the fromDevice stream immediately
    const meshDevice = new MeshDevice(transport);

    const connectedAt = new Date().toISOString();
    const device: ConnectedDevice = { id, port, name, connectedAt, meshDevice, transport };
    this.devices.set(id, device);
    await this.db.query("UPDATE devices SET last_seen = $1 WHERE id = $2", [connectedAt, id]);

    // Subscribe to all relevant events
    meshDevice.events.onMessagePacket.subscribe((pkt: Types.PacketMetadata<string>) => {
      this._handleMessage(id, pkt).catch((err) =>
        console.error(`[devices] message error on ${name}:`, err),
      );
    });

    // Protobuf types come from @meshtastic/protobufs which is bundled into core;
    // using `any` here since the package isn't separately resolvable by TypeScript.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    meshDevice.events.onMeshPacket.subscribe((pkt: any) => {
      this._handleRawPacket(id, pkt).catch((err) =>
        console.error(`[devices] raw packet error on ${name}:`, err),
      );
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    meshDevice.events.onNodeInfoPacket.subscribe((nodeInfo: any) => {
      this._handleNodeInfo(id, nodeInfo).catch((err) =>
        console.error(`[devices] node info error on ${name}:`, err),
      );
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    meshDevice.events.onPositionPacket.subscribe((pkt: any) => {
      this._handlePosition(id, pkt).catch((err) =>
        console.error(`[devices] position error on ${name}:`, err),
      );
    });

    meshDevice.events.onDeviceStatus.subscribe((status: Types.DeviceStatusEnum) => {
      console.log(`[devices] status ${name} → ${Types.DeviceStatusEnum[status] ?? status}`);
      void this._handleDeviceStatus(id, name, port, transport, status).catch((err) =>
        console.warn(`[devices] disconnect cleanup failed for ${name}:`, err),
      );
    });

    // Diagnostic: log every FromRadio frame so we know if the stream is alive
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    meshDevice.events.onFromRadio.subscribe((msg: any) => {
      const variant = msg?.payloadVariant?.case ?? "unknown";
      if (variant === "packet") return; // already handled by onMeshPacket
      if (variant === "fileInfo") {
        // Device is advertising a file on its local filesystem (map tiles,
        // ringtones, UI assets, etc.).  Informational only — log and move on.
        const f = msg.payloadVariant.value;
        console.log(
          `[devices] fileInfo ${name}: "${f?.fileName ?? "?"}" (${f?.sizeBytes ?? "??"} bytes)`,
        );
        return;
      }
      console.log(`[devices] fromRadio ${name} variant=${variant}`);
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    meshDevice.events.onQueueStatus.subscribe((status: any) => {
      console.log(
        `[devices] queue status on ${name}: res=${status.res} free=${status.free}/${status.maxlen} packetId=${status.meshPacketId}`,
      );
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    meshDevice.events.onTraceRoutePacket.subscribe((pkt: any) => {
      const route: number[] = Array.from(pkt.data?.route ?? []);
      const routeBack: number[] = Array.from(pkt.data?.routeBack ?? []);
      const nodeId: number = pkt.from ?? 0;
      const fromNodeId = this.myNodeIds.get(id) ?? 0;
      const event: ServerEvent = {
        type: "traceroute:result",
        payload: { deviceId: id, nodeId, route, routeBack },
      };
      this.emit("event", event);
      console.log(
        `[devices] traceroute result from ${formatNodeId(nodeId)} route=[${route.map((n) => formatNodeId(n, 0)).join(",")}]`,
      );
      // Persist to DB asynchronously
      this._saveTraceroute(id, fromNodeId, nodeId, route, routeBack).catch((err) =>
        console.error(`[devices] traceroute save error:`, err),
      );
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    meshDevice.events.onDeviceMetadataPacket.subscribe(({ data }: any) => {
      this._handleMetadata(id, data).catch((err) =>
        console.error(`[devices] metadata error on ${name}:`, err),
      );
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    meshDevice.events.onConfigPacket.subscribe((pkt: any) => {
      this._handleConfigPacket(id, name, pkt).catch((err) =>
        console.error(`[devices] config packet error on ${name}:`, err),
      );
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    meshDevice.events.onModuleConfigPacket.subscribe((pkt: any) => {
      this._handleModuleConfigPacket(id, name, pkt).catch((err) =>
        console.error(`[devices] module config packet error on ${name}:`, err),
      );
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    meshDevice.events.onChannelPacket.subscribe((pkt: any) => {
      this._handleChannelPacket(id, name, pkt).catch((err) =>
        console.error(`[devices] channel packet error on ${name}:`, err),
      );
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    meshDevice.events.onMyNodeInfo.subscribe((info: any) => {
      const nodeNum: number = info?.myNodeNum ?? 0;
      if (nodeNum !== 0) {
        this.myNodeIds.set(id, nodeNum);
        console.log(`[devices] myNodeInfo ${name} nodeNum=${formatNodeId(nodeNum)}`);
      }
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    meshDevice.events.onTelemetryPacket.subscribe((pkt: any) => {
      this._handleTelemetry(id, name, pkt).catch((err) =>
        console.error(`[devices] telemetry error on ${name}:`, err),
      );
    });

    // Attach to MQTT gateway BEFORE configure so it catches onMyNodeInfo/onChannelPacket
    this.mqttGateway?.attachDevice(id, meshDevice);

    // Send configure request — device will begin streaming its config back
    console.log(`[devices] configure start ${name}`);
    await meshDevice.configure();
    console.log(`[devices] configure done ${name}`);

    // Request the device's own position immediately after configure.
    // This ensures GPS data arrives even if the device hasn't broadcast a position yet.
    const ownNodeId = this.myNodeIds.get(id);
    if (ownNodeId) {
      meshDevice
        .requestPosition(ownNodeId)
        .catch((err: unknown) =>
          console.warn(`[devices] requestPosition failed for ${name}:`, err),
        );
    }

    // Send periodic heartbeats so the serial link stays alive indefinitely.
    // Without this the Meshtastic firmware stops forwarding packets to the host.
    meshDevice.setHeartbeatInterval(30_000);

    this._emitStatus(id, name, port, "connected", connectedAt);
    console.log(`[devices] connected ${name} on ${port} (id=${id})`);

    // Emit config snapshot now that all onConfigPacket/onModuleConfigPacket/onChannelPacket
    // handlers have fired and their DB writes are queued ahead of this read.
    await this._emitDeviceConfig(id);

    // Watchdog: if we receive zero mesh packets for 90 s after configure, re-run
    // configure().  This recovers from the rare case where the device's serial
    // stream silently stops delivering packets after the initial handshake.
    this._startPacketWatchdog(id, name, meshDevice);

    return device;
  }

  async disconnect(deviceId: string) {
    const device = this.devices.get(deviceId);
    if (!device) return;

    const reconnectTimer = this.reconnectTimers.get(device.port);
    if (reconnectTimer) clearTimeout(reconnectTimer);
    this.reconnectTimers.delete(device.port);
    this.reconnectingPorts.delete(device.port);
    this.devices.delete(deviceId);
    this.myNodeIds.delete(deviceId);
    this.batteryLevels.delete(deviceId);
    this.gpsAcquired.delete(deviceId);
    this.gpsDetails.delete(deviceId);
    this.reconnectAttempts.delete(device.port);
    this.mqttGateway?.detachDevice(deviceId);
    await device.transport.disconnect().catch(() => {});

    this._emitStatus(deviceId, device.name, device.port, "disconnected");
    console.log(`[devices] disconnected ${device.name}`);
  }

  getDevice(id: string) {
    return this.devices.get(id);
  }

  getBatteryLevel(id: string): number | null {
    return this.batteryLevels.get(id) ?? null;
  }

  hasGpsPosition(id: string): boolean {
    return this.gpsAcquired.has(id);
  }

  getGpsDetail(id: string): GpsDetail | null {
    return this.gpsDetails.get(id) ?? null;
  }

  /** Re-emit current cached GPS position to all WS clients immediately. */
  refreshGpsPosition(deviceId: string): void {
    const device = this.devices.get(deviceId);
    if (device) {
      this._emitStatus(deviceId, device.name, device.port, "connected", device.connectedAt);
    }
  }

  getMyNodeId(deviceId: string): number | undefined {
    return this.myNodeIds.get(deviceId);
  }

  async listNodes(deviceId: string): Promise<NodeInfo[]> {
    const { rows } = await this.db.query<{
      node_id: number;
      long_name: string | null;
      short_name: string | null;
      mac_address: string | null;
      hw_model: number | null;
      public_key: string | null;
      last_heard: string | null;
      snr: number | null;
      hops_away: number | null;
      latitude: number | null;
      longitude: number | null;
      altitude: number | null;
    }>(
      `SELECT node_id, long_name, short_name, mac_address, hw_model, public_key,
              last_heard, snr, hops_away, latitude, longitude, altitude
       FROM nodes WHERE device_id = $1 ORDER BY last_heard DESC NULLS LAST`,
      [deviceId],
    );
    return rows.map((r) => ({
      nodeId: r.node_id,
      longName: r.long_name,
      shortName: r.short_name,
      macAddress: r.mac_address,
      hwModel: r.hw_model,
      publicKey: r.public_key,
      lastHeard: r.last_heard,
      snr: r.snr,
      hopsAway: r.hops_away,
      latitude: r.latitude,
      longitude: r.longitude,
      altitude: r.altitude,
    }));
  }

  async getMessageHistory(
    deviceId: string,
    opts: { channelIndex?: number; toNodeId?: number; limit: number; before?: string },
  ): Promise<Message[]> {
    let query = `
      SELECT id, packet_id, from_node_id, to_node_id, channel_index, text,
             rx_time, rx_snr, rx_rssi, hop_limit, want_ack, via_mqtt, role,
             ack_status, ack_at, ack_error, reply_to_packet_id
      FROM messages
      WHERE device_id = $1`;
    const params: unknown[] = [deviceId];
    let p = 2;

    if (opts.channelIndex !== undefined) {
      query += ` AND channel_index = $${p++}`;
      params.push(opts.channelIndex);
    }
    if (opts.toNodeId !== undefined) {
      query += ` AND (to_node_id = $${p} OR from_node_id = $${p})`;
      params.push(opts.toNodeId);
      p++;
    }
    if (opts.before) {
      query += ` AND rx_time < $${p++}`;
      params.push(opts.before);
    }
    query += ` ORDER BY rx_time DESC LIMIT $${p}`;
    params.push(opts.limit);

    const { rows } = await this.db.query<{
      id: string;
      packet_id: number;
      from_node_id: number;
      to_node_id: number;
      channel_index: number;
      text: string | null;
      rx_time: string;
      rx_snr: number | null;
      rx_rssi: number | null;
      hop_limit: number | null;
      want_ack: boolean;
      via_mqtt: boolean;
      role: string;
      ack_status: string | null;
      ack_at: string | null;
      ack_error: string | null;
      reply_to_packet_id: number;
    }>(query, params);

    return rows.map((r) => ({
      id: r.id,
      packetId: r.packet_id,
      fromNodeId: r.from_node_id,
      toNodeId: r.to_node_id,
      channelIndex: r.channel_index,
      text: r.text,
      rxTime: r.rx_time,
      rxSnr: r.rx_snr,
      rxRssi: r.rx_rssi,
      hopLimit: r.hop_limit,
      wantAck: r.want_ack,
      viaMqtt: r.via_mqtt,
      role: r.role as Message["role"],
      ackStatus: r.ack_status as Message["ackStatus"],
      ackAt: r.ack_at,
      ackError: r.ack_error,
      replyToPacketId: r.reply_to_packet_id ?? 0,
    }));
  }

  async deleteConversation(deviceId: string, nodeId: number): Promise<void> {
    await this.db.query(
      `DELETE FROM messages
       WHERE device_id = $1
         AND (to_node_id = $2 OR from_node_id = $2)`,
      [deviceId, nodeId],
    );
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /**
   * Starts a watchdog that re-runs configure() if no mesh packet is received
   * within 90 s of the last packet (or since configure completed).
   * This recovers silently when the Meshtastic serial stream stalls.
   */
  private _startPacketWatchdog(deviceId: string, name: string, meshDevice: MeshDevice): void {
    this.lastPacketMs.set(deviceId, Date.now());

    const INTERVAL = 45_000; // check every 45 s
    const STALE_MS = 90_000; // re-configure if silent for 90 s

    const existing = this.watchdogTimers.get(deviceId);
    if (existing) clearInterval(existing);

    const timer = setInterval(async () => {
      if (!this.devices.has(deviceId)) {
        clearInterval(timer);
        this.watchdogTimers.delete(deviceId);
        return;
      }
      const last = this.lastPacketMs.get(deviceId) ?? 0;
      const silentMs = Date.now() - last;
      if (silentMs >= STALE_MS) {
        console.log(
          `[devices] watchdog: ${name} silent for ${Math.round(silentMs / 1000)}s — re-running configure()`,
        );
        this.lastPacketMs.set(deviceId, Date.now()); // prevent hammering
        try {
          await meshDevice.configure();
          console.log(`[devices] watchdog: configure() done for ${name}`);
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          console.warn(`[devices] watchdog: configure() failed for ${name}: ${msg}`);
        }
      }
    }, INTERVAL);
    this.watchdogTimers.set(deviceId, timer);
  }

  private _emitStatus(
    id: string,
    name: string,
    port: string,
    status: "disconnected" | "connecting" | "connected" | "error",
    connectedAt?: string,
  ) {
    const event: ServerEvent = {
      type: "device:status",
      payload: {
        id,
        name,
        port,
        status,
        connectedAt: connectedAt ?? null,
        lastSeenAt: null,
        hardwareModel: null,
        firmwareVersion: null,
        batteryLevel: this.batteryLevels.get(id) ?? null,
        hasGpsPosition: this.gpsAcquired.has(id),
        gpsDetail: this.gpsDetails.get(id) ?? null,
        ownNodeId: this.myNodeIds.get(id) ?? null,
      },
    };
    this.emit("event", event);
  }

  private async _handleDeviceStatus(
    deviceId: string,
    name: string,
    port: string,
    transport: TransportNodeSerial,
    status: Types.DeviceStatusEnum,
  ) {
    if (status === Types.DeviceStatusEnum.DeviceDisconnected) {
      const device = this.devices.get(deviceId);
      // Ignore duplicate/late events from a transport that has already been
      // removed or replaced (including events caused by manual disconnect()).
      if (!device || device.transport !== transport) return;
      // Stop watchdog — reconnect will start a fresh one
      const wt = this.watchdogTimers.get(deviceId);
      if (wt) {
        clearInterval(wt);
        this.watchdogTimers.delete(deviceId);
      }
      this.devices.delete(deviceId);
      this.myNodeIds.delete(deviceId);
      this.batteryLevels.delete(deviceId);
      this.gpsAcquired.delete(deviceId);
      this.gpsDetails.delete(deviceId);
      this.mqttGateway?.detachDevice(deviceId);

      // Releasing the old SerialPort handle is essential on Windows. Without
      // this, an automatic reopen can race the stale handle and COMx remains
      // unavailable even though the manager considers it disconnected.
      if (device) await device.transport.disconnect().catch(() => {});
      this._emitStatus(deviceId, name, port, "disconnected");
      console.log(`[devices] ${name} disconnected — scheduling reconnect in 5s`);
      this._scheduleReconnect(deviceId, port, name);
    }
  }

  private _scheduleReconnect(deviceId: string, port: string, name: string) {
    if (this.reconnectingPorts.has(port)) return;
    this.reconnectingPorts.add(port);

    const attempt = (this.reconnectAttempts.get(port) ?? 0) + 1;
    this.reconnectAttempts.set(port, attempt);

    // Exponential backoff: 5s, 10s, 20s, 40s, capped at 60s
    const delayMs = Math.min(5000 * Math.pow(2, attempt - 1), 60_000);
    console.log(`[devices] reconnect attempt ${attempt} for ${name} in ${delayMs / 1000}s`);

    const timer = setTimeout(async () => {
      this.reconnectTimers.delete(port);
      this.reconnectingPorts.delete(port);
      if (this.devices.has(deviceId)) {
        this.reconnectAttempts.delete(port);
        return; // already reconnected by another path
      }
      console.log(`[devices] attempting reconnect for ${name} on ${port} (attempt ${attempt})`);
      try {
        await this.connect(port, name, deviceId);
        this.reconnectAttempts.delete(port); // success — reset backoff
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`[devices] reconnect failed for ${port}:`, msg);
        this._emitStatus(deviceId, name, port, "disconnected");
        // Schedule another attempt — keeps retrying until the device comes back
        this._scheduleReconnect(deviceId, port, name);
      }
    }, delayMs);
    this.reconnectTimers.set(port, timer);
  }

  private async _saveTraceroute(
    deviceId: string,
    fromNodeId: number,
    toNodeId: number,
    route: number[],
    routeBack: number[],
  ) {
    const id = randomUUID();
    await this.db.query(
      `INSERT INTO traceroutes(id, device_id, from_node_id, to_node_id, route, route_back)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [id, deviceId, fromNodeId, toNodeId, JSON.stringify(route), JSON.stringify(routeBack)],
    );
  }

  private async _handleMessage(deviceId: string, packet: Types.PacketMetadata<string>) {
    const id = randomUUID();
    const rxTime = packet.rxTime.toISOString();
    const replyToPacketId = this.pendingReplyIds.get(packet.id) ?? 0;
    this.pendingReplyIds.delete(packet.id);

    await this.db.query(
      `INSERT INTO messages(id, packet_id, device_id, from_node_id, to_node_id, channel_index, text, rx_time, role, reply_to_packet_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'received', $9)
       ON CONFLICT(id) DO NOTHING`,
      [
        id,
        packet.id,
        deviceId,
        packet.from,
        packet.to,
        packet.channel,
        packet.data,
        rxTime,
        replyToPacketId,
      ],
    );
    await this.db.query("UPDATE devices SET last_seen = $1 WHERE id = $2", [rxTime, deviceId]);

    const event: ServerEvent = {
      type: "message:received",
      payload: {
        id,
        packetId: packet.id,
        fromNodeId: packet.from,
        toNodeId: packet.to,
        channelIndex: packet.channel,
        text: packet.data,
        rxTime,
        rxSnr: null,
        rxRssi: null,
        hopLimit: null,
        wantAck: false,
        viaMqtt: false,
        role: "received",
        ackStatus: null,
        ackAt: null,
        ackError: null,
        replyToPacketId,
      },
    };
    this.emit("event", event);

    // Bot command handler — only active when BOT_ENABLED=true
    if (this.config.bot.enabled && packet.data?.startsWith("!")) {
      await this._handleBotCommand(deviceId, packet).catch((err) =>
        console.error("[bot] command handler error:", err),
      );
    }
  }

  private async _handleBotCommand(
    deviceId: string,
    packet: Types.PacketMetadata<string>,
  ): Promise<void> {
    const device = this.devices.get(deviceId);
    if (!device) return;

    const raw = packet.data.trim();
    const [cmd, ...args] = raw.slice(1).toLowerCase().split(/\s+/);
    let reply: string | null = null;

    switch (cmd) {
      case "ping":
        reply = "pong!";
        break;

      case "help":
        reply = "Commands: !ping !nodes !status !help";
        break;

      case "nodes": {
        const { rows } = await this.db.query<{ cnt: string }>(
          "SELECT COUNT(*) AS cnt FROM nodes WHERE device_id = $1",
          [deviceId],
        );
        reply = `${rows[0]?.cnt ?? 0} nodes in mesh`;
        break;
      }

      case "status": {
        const { rows } = await this.db.query<{ cnt: string }>(
          "SELECT COUNT(*) AS cnt FROM nodes WHERE device_id = $1",
          [deviceId],
        );
        const nodeCount = rows[0]?.cnt ?? 0;
        const myNodeId = this.myNodeIds.get(deviceId);
        reply = `Foreman OK · ${nodeCount} nodes · me: ${formatNodeId(myNodeId ?? 0)}`;
        break;
      }

      default:
        // Unknown command — ignore silently unless it looks intentional
        if (args.length === 0 && raw.length < 20) {
          reply = `Unknown command "${cmd}". Try !help`;
        }
        break;
    }

    if (!reply) return;

    const toNodeId = packet.from; // reply to whoever sent it
    const channelIndex = packet.channel; // same channel

    const packetId = await device.meshDevice.sendText(
      reply,
      toNodeId,
      false,
      channelIndex as Types.ChannelNumber,
    );

    const txTime = new Date().toISOString();
    const msgId = randomUUID();
    const myNodeId = this.myNodeIds.get(deviceId) ?? 0;

    await this.db.query(
      `INSERT INTO messages(id, packet_id, device_id, from_node_id, to_node_id, channel_index,
         text, rx_time, want_ack, role, ack_status, reply_to_packet_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, false, 'sent', null, 0)`,
      [msgId, packetId, deviceId, myNodeId, toNodeId, channelIndex, reply, txTime],
    );

    const botEvent: ServerEvent = {
      type: "message:received",
      payload: {
        id: msgId,
        packetId,
        fromNodeId: myNodeId,
        toNodeId,
        channelIndex,
        text: reply,
        rxTime: txTime,
        rxSnr: null,
        rxRssi: null,
        hopLimit: null,
        wantAck: false,
        viaMqtt: false,
        role: "sent",
        ackStatus: null,
        ackAt: null,
        ackError: null,
        replyToPacketId: 0,
      },
    };
    this.emit("event", botEvent);
    console.log(`[bot] replied to !${cmd} → "${reply}" → ${formatNodeId(toNodeId)}`);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private async _handleRawPacket(deviceId: string, meshPacket: any) {
    // Use type assertion to access protobuf-es generated fields
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const p = meshPacket as any;
    const isDecoded = p.payloadVariant?.case === "decoded";
    const isEncrypted = p.payloadVariant?.case === "encrypted";

    const portnum: number = isDecoded ? (p.payloadVariant.value.portnum ?? 0) : 0;

    // Stash replyId synchronously before any await so _handleMessage can consume it.
    // onMeshPacket fires before the derived onMessagePacket, so the map entry will be
    // present by the time _handleMessage reads it.
    const TEXT_MESSAGE_APP_PORT = 1;
    if (portnum === TEXT_MESSAGE_APP_PORT && isDecoded && (p.id ?? 0) !== 0) {
      this.pendingReplyIds.set(p.id, p.replyId ?? 0);
    }
    const portnumName: string =
      (Protobuf.Portnums.PortNum as Record<number, string>)[portnum] ?? "UNKNOWN_APP";

    const rxTimeSec: number = p.rxTime ?? 0;
    const rxTime =
      rxTimeSec > 0 ? new Date(rxTimeSec * 1000).toISOString() : new Date().toISOString();

    let payloadRaw: string | null = null;
    let decodedJson: unknown = null;
    if (isDecoded && p.payloadVariant.value.payload instanceof Uint8Array) {
      const payloadBytes: Uint8Array = p.payloadVariant.value.payload;
      payloadRaw = Buffer.from(payloadBytes).toString("base64");
      decodedJson = decodePayload(portnumName, payloadBytes);
    } else if (isEncrypted && p.payloadVariant.value instanceof Uint8Array) {
      payloadRaw = Buffer.from(p.payloadVariant.value).toString("base64");
    }

    // Keep node last_heard fresh on every received packet, not just nodeinfo
    const fromNodeId: number = p.from ?? 0;
    const isMqttEcho = p.viaMqtt ?? false;
    // Update watchdog timestamp so it knows the stream is alive
    this.lastPacketMs.set(deviceId, Date.now());
    console.log(
      `[devices] raw pkt from=${formatNodeId(fromNodeId)} portnum=${portnumName} viaMqtt=${isMqttEcho}`,
    );
    if (fromNodeId !== 0) {
      activityLog.add({
        ts: rxTime,
        source: "mesh",
        portnum: portnumName,
        fromHex: formatNodeId(fromNodeId),
        region: null,
        gateway: null,
        viaMqtt: isMqttEcho,
      });
    }
    if (fromNodeId !== 0) {
      // Upsert so a node we hear packets from is always tracked, even before nodeinfo arrives
      await this.db.query(
        `INSERT INTO nodes(node_id, device_id, last_heard)
         VALUES ($1, $2, $3)
         ON CONFLICT(node_id, device_id) DO UPDATE SET
           last_heard = GREATEST(EXCLUDED.last_heard, nodes.last_heard)`,
        [fromNodeId, deviceId, rxTime],
      );

      const { rows } = await this.db.query<{
        node_id: number;
        long_name: string | null;
        short_name: string | null;
        mac_address: string | null;
        hw_model: number | null;
        public_key: string | null;
        snr: number | null;
        hops_away: number | null;
        latitude: number | null;
        longitude: number | null;
        altitude: number | null;
      }>(
        `SELECT node_id, long_name, short_name, mac_address, hw_model, public_key,
                snr, hops_away, latitude, longitude, altitude
         FROM nodes WHERE device_id = $1 AND node_id = $2`,
        [deviceId, fromNodeId],
      );
      if (rows[0]) {
        const r = rows[0];
        const nodeEvent: ServerEvent = {
          type: "node:update",
          payload: {
            nodeId: r.node_id,
            longName: r.long_name,
            shortName: r.short_name,
            macAddress: r.mac_address,
            hwModel: r.hw_model,
            publicKey: r.public_key,
            lastHeard: rxTime,
            snr: r.snr,
            hopsAway: r.hops_away,
            latitude: r.latitude,
            longitude: r.longitude,
            altitude: r.altitude,
          },
        };
        this.emit("event", nodeEvent);
      }
    }

    const id = randomUUID();
    await this.db.query(
      `INSERT INTO packets(id, packet_id, device_id, from_node_id, to_node_id, channel,
         portnum, portnum_name, rx_time, rx_snr, rx_rssi, hop_limit, hop_start,
         want_ack, via_mqtt, payload_raw, decoded_json)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17::jsonb)`,
      [
        id,
        p.id ?? 0,
        deviceId,
        p.from ?? 0,
        p.to ?? 0,
        p.channel ?? 0,
        portnum,
        portnumName,
        rxTime,
        p.rxSnr || null,
        p.rxRssi || null,
        p.hopLimit || null,
        p.hopStart || null,
        p.wantAck ?? false,
        p.viaMqtt ?? false,
        payloadRaw,
        decodedJson !== null ? JSON.stringify(decodedJson) : null,
      ],
    );

    const event: ServerEvent = {
      type: "packet:raw",
      payload: {
        id,
        packetId: p.id ?? 0,
        fromNodeId: p.from ?? 0,
        toNodeId: p.to ?? 0,
        channel: p.channel ?? 0,
        portnum,
        portnumName,
        rxTime,
        rxSnr: p.rxSnr || null,
        rxRssi: p.rxRssi || null,
        hopLimit: p.hopLimit || null,
        hopStart: p.hopStart || null,
        wantAck: p.wantAck ?? false,
        viaMqtt: p.viaMqtt ?? false,
        payloadRaw,
        decodedJson: null,
      },
    };
    this.emit("event", event);

    // ACK/NACK detection: ROUTING_APP (5) decoded packets contain delivery confirmations.
    // requestId links back to the original sent message's packet_id.
    const ROUTING_APP = 5;
    if (portnum === ROUTING_APP && isDecoded) {
      const requestId: number = p.payloadVariant?.value?.requestId ?? 0;
      const payload: Uint8Array | undefined = p.payloadVariant?.value?.payload;
      if (requestId !== 0 && payload?.length) {
        try {
          const routing = fromBinary(Protobuf.Mesh.RoutingSchema, payload);
          if (routing.variant.case === "errorReason") {
            const isAck = routing.variant.value === Protobuf.Mesh.Routing_Error.NONE;
            const ackAt = new Date().toISOString();
            const ackError = isAck
              ? null
              : ((Protobuf.Mesh.Routing_Error as Record<number, string>)[routing.variant.value] ??
                String(routing.variant.value));

            const { rows } = await this.db.query<{ id: string }>(
              `UPDATE messages
               SET ack_status = $1, ack_at = $2, ack_error = $3
               WHERE packet_id = $4 AND device_id = $5 AND role = 'sent' AND ack_status = 'pending'
               RETURNING id`,
              [isAck ? "acked" : "error", ackAt, ackError, requestId, deviceId],
            );

            if (rows[0]) {
              const ackEvent: ServerEvent = {
                type: "message:ack",
                payload: {
                  messageId: rows[0].id,
                  packetId: requestId,
                  status: isAck ? "acked" : "error",
                  ackAt,
                  ackError,
                },
              };
              this.emit("event", ackEvent);
              console.log(
                `[devices] ACK ${isAck ? "✓" : "✗"} for packet ${requestId}${ackError ? ` (${ackError})` : ""}`,
              );
            }
          }
        } catch (err) {
          console.warn("[devices] failed to decode routing packet:", err);
        }
      }
    }

    // Store encrypted text packets we forward for other nodes (role='relayed').
    // onMessagePacket already handles broadcast (0xffffffff) and direct-to-us messages,
    // so we only need to capture encrypted DMs passing through us.
    const TEXT_MESSAGE_APP = 1;
    const BROADCAST = 0xffffffff;
    const myNodeId = this.myNodeIds.get(deviceId);
    const toNodeId: number = p.to ?? 0;
    if (
      portnum === TEXT_MESSAGE_APP &&
      isEncrypted &&
      fromNodeId !== 0 &&
      fromNodeId !== myNodeId &&
      toNodeId !== myNodeId &&
      toNodeId !== BROADCAST
    ) {
      const relayId = randomUUID();
      await this.db.query(
        `INSERT INTO messages(id, packet_id, device_id, from_node_id, to_node_id, channel_index,
           text, rx_time, rx_snr, rx_rssi, hop_limit, want_ack, via_mqtt, role, reply_to_packet_id)
         VALUES ($1, $2, $3, $4, $5, $6, NULL, $7, $8, $9, $10, $11, $12, 'relayed', $13)`,
        [
          relayId,
          p.id ?? 0,
          deviceId,
          fromNodeId,
          toNodeId,
          p.channel ?? 0,
          rxTime,
          p.rxSnr || null,
          p.rxRssi || null,
          p.hopLimit || null,
          p.wantAck ?? false,
          p.viaMqtt ?? false,
          p.replyId ?? 0,
        ],
      );
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private async _handleNodeInfo(deviceId: string, nodeInfo: any) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const n = nodeInfo as any;
    const nodeId: number = n.num ?? 0;
    if (nodeId === 0) return;
    console.log(
      `[devices] nodeInfo ${formatNodeId(nodeId)} "${resolveNodeName(nodeId, n.user ?? {}, { fallback: "?" })}"`,
    );

    const macBytes: Uint8Array | undefined = n.user?.macaddr;
    const macAddress =
      macBytes && macBytes.length > 0
        ? Array.from(macBytes)
            .map((b: number) => b.toString(16).padStart(2, "0"))
            .join(":")
        : null;

    const pubKeyBytes: Uint8Array | undefined = n.user?.publicKey;
    const publicKey =
      pubKeyBytes && pubKeyBytes.length > 0 ? Buffer.from(pubKeyBytes).toString("hex") : null;

    const lastHeardSec: number = n.lastHeard ?? 0;
    const lastHeard = lastHeardSec > 0 ? new Date(lastHeardSec * 1000).toISOString() : null;

    await this.db.query(
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
        n.user?.longName ?? null,
        n.user?.shortName ?? null,
        macAddress,
        n.user?.hwModel ?? null,
        publicKey,
        lastHeard,
        n.snr || null,
        n.hopsAway ?? null,
      ],
    );

    // Read back current position so the emitted event reflects what's actually in DB
    const { rows: posRows } = await this.db.query<{
      latitude: number | null;
      longitude: number | null;
      altitude: number | null;
    }>(`SELECT latitude, longitude, altitude FROM nodes WHERE device_id = $1 AND node_id = $2`, [
      deviceId,
      nodeId,
    ]);
    const pos = posRows[0];

    const event: ServerEvent = {
      type: "node:update",
      payload: {
        nodeId,
        longName: n.user?.longName ?? null,
        shortName: n.user?.shortName ?? null,
        macAddress,
        hwModel: n.user?.hwModel ?? null,
        publicKey,
        lastHeard,
        snr: n.snr || null,
        hopsAway: n.hopsAway ?? null,
        latitude: pos?.latitude ?? null,
        longitude: pos?.longitude ?? null,
        altitude: pos?.altitude ?? null,
      },
    };
    this.emit("event", event);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private async _handlePosition(deviceId: string, pkt: any) {
    const fromNodeId: number = pkt.from ?? 0;
    if (fromNodeId === 0) return;

    const pos = pkt.data;
    if (!pos) return;

    const lat = pos.latitudeI != null ? pos.latitudeI / 1e7 : null;
    const lon = pos.longitudeI != null ? pos.longitudeI / 1e7 : null;
    if (lat === null || lon === null || (lat === 0 && lon === 0)) return;

    const alt = pos.altitude ?? null;
    const speed = pos.groundSpeed != null ? pos.groundSpeed / 100 : null; // cm/s → m/s
    const groundTrack = pos.groundTrack ?? null;
    const satsInView = pos.satsInView ?? null;
    const rxTime = pkt.rxTime instanceof Date ? pkt.rxTime.toISOString() : new Date().toISOString();

    await this.db.query(
      `UPDATE nodes SET latitude = $1, longitude = $2, altitude = $3, last_heard = GREATEST(last_heard, $4)
       WHERE device_id = $5 AND node_id = $6`,
      [lat, lon, alt, rxTime, deviceId, fromNodeId],
    );

    // Record every fix so we can show position trails in analytics
    await this.db.query(
      `INSERT INTO position_history(id, device_id, node_id, latitude, longitude, altitude,
         speed, ground_track, sats_in_view, recorded_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [randomUUID(), deviceId, fromNodeId, lat, lon, alt, speed, groundTrack, satsInView, rxTime],
    );

    // Emit update so frontend map refreshes immediately
    const { rows } = await this.db.query<{
      node_id: number;
      long_name: string | null;
      short_name: string | null;
      mac_address: string | null;
      hw_model: number | null;
      public_key: string | null;
      last_heard: string | null;
      snr: number | null;
      hops_away: number | null;
    }>(
      `SELECT node_id, long_name, short_name, mac_address, hw_model, public_key,
              last_heard, snr, hops_away FROM nodes WHERE device_id = $1 AND node_id = $2`,
      [deviceId, fromNodeId],
    );
    if (!rows[0]) return;
    const r = rows[0];
    const event: ServerEvent = {
      type: "node:update",
      payload: {
        nodeId: r.node_id,
        longName: r.long_name,
        shortName: r.short_name,
        macAddress: r.mac_address,
        hwModel: r.hw_model,
        publicKey: r.public_key,
        lastHeard: r.last_heard,
        snr: r.snr,
        hopsAway: r.hops_away,
        latitude: lat,
        longitude: lon,
        altitude: alt,
      },
    };
    this.emit("event", event);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private async _handleConfigPacket(deviceId: string, name: string, pkt: any) {
    // SDK dispatches the Config object directly; its sections live in payloadVariant
    const variant = pkt?.payloadVariant;
    if (!variant?.case || variant.value == null) return;
    const section: string = variant.case;
    const value = toPlainObject(variant.value);
    await this.db.query(
      `UPDATE devices
       SET radio_config = jsonb_set(COALESCE(radio_config, '{}'), ARRAY[$1], $2::jsonb)
       WHERE id = $3`,
      [section, JSON.stringify(value), deviceId],
    );
    console.log(`[devices] radio config ${name} section=${section}`);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private async _handleModuleConfigPacket(deviceId: string, name: string, pkt: any) {
    // SDK dispatches the ModuleConfig object directly; its sections live in payloadVariant
    const variant = pkt?.payloadVariant;
    if (!variant?.case || variant.value == null) return;
    const section: string = variant.case;
    const value = toPlainObject(variant.value);
    await this.db.query(
      `UPDATE devices
       SET module_config = jsonb_set(COALESCE(module_config, '{}'), ARRAY[$1], $2::jsonb)
       WHERE id = $3`,
      [section, JSON.stringify(value), deviceId],
    );
    console.log(`[devices] module config ${name} section=${section}`);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private async _handleChannelPacket(deviceId: string, name: string, pkt: any) {
    // SDK dispatches the Channel object directly (no .data wrapper)
    const ch = pkt;
    if (ch == null || ch.index == null) return;
    const idx: number = Number(ch.index);
    const chName: string | null = ch.settings?.name ?? null;
    const role: number = Number(ch.role ?? 0);
    const pskBytes: Uint8Array | null = ch.settings?.psk ?? null;
    const psk: string | null = pskBytes?.length ? Buffer.from(pskBytes).toString("base64") : null;
    await this.db.query(
      `INSERT INTO channels(device_id, idx, name, role, psk)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT(device_id, idx) DO UPDATE
         SET name = EXCLUDED.name, role = EXCLUDED.role, psk = EXCLUDED.psk`,
      [deviceId, idx, chName, role, psk],
    );
    console.log(`[devices] channel ${name} idx=${idx} name=${chName ?? "(none)"} role=${role}`);
  }

  async getDeviceConfig(deviceId: string): Promise<DeviceConfig | null> {
    const { rows } = await this.db.query<{
      radio_config: Record<string, unknown> | null;
      module_config: Record<string, unknown> | null;
    }>("SELECT radio_config, module_config FROM devices WHERE id = $1", [deviceId]);
    if (!rows[0]) return null;

    const { rows: chRows } = await this.db.query<{
      idx: number;
      name: string | null;
      role: number;
      psk: string | null;
    }>("SELECT idx, name, role, psk FROM channels WHERE device_id = $1 ORDER BY idx", [deviceId]);

    const channels: Channel[] = chRows.map((r) => ({
      index: r.idx,
      name: r.name,
      role: r.role,
      psk: r.psk,
    }));

    return {
      deviceId,
      radioConfig: rows[0].radio_config ?? {},
      moduleConfig: rows[0].module_config ?? {},
      channels,
    };
  }

  /**
   * Write a single config section to the device, persist to DB, re-emit snapshot.
   * namespace: "radio" → meshDevice.setConfig(); "module" → meshDevice.setModuleConfig()
   */
  async applyConfigSection(
    deviceId: string,
    namespace: "radio" | "module",
    section: string,
    value: Record<string, unknown>,
  ): Promise<void> {
    const device = this.devices.get(deviceId);
    if (!device) throw new Error(`Device ${deviceId} not connected`);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { create } = (await import("@bufbuild/protobuf")) as any;

    if (namespace === "radio") {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const ConfigSchema = (Protobuf.Config as any).ConfigSchema;
      const proto = create(ConfigSchema, {
        payloadVariant: { case: section, value },
      });
      await device.meshDevice.setConfig(proto);
    } else {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const ModuleConfigSchema = (Protobuf.ModuleConfig as any).ModuleConfigSchema;
      const proto = create(ModuleConfigSchema, {
        payloadVariant: { case: section, value },
      });
      await device.meshDevice.setModuleConfig(proto);
    }

    await device.meshDevice.commitEditSettings();

    // Persist the change to DB
    const col = namespace === "radio" ? "radio_config" : "module_config";
    await this.db.query(
      `UPDATE devices SET ${col} = jsonb_set(COALESCE(${col}, '{}'), ARRAY[$1], $2::jsonb) WHERE id = $3`,
      [section, JSON.stringify(value), deviceId],
    );

    console.log(`[devices] applied ${namespace} config section=${section} device=${deviceId}`);
    await this._emitDeviceConfig(deviceId);
  }

  private async _emitDeviceConfig(deviceId: string) {
    const config = await this.getDeviceConfig(deviceId);
    if (!config) return;
    const event: ServerEvent = { type: "device:config", payload: config };
    this.emit("event", event);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private async _handleMetadata(deviceId: string, meta: any) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const m = meta as any;
    const hwModel: string | null = m.hwModel != null ? String(m.hwModel) : null;
    const firmware: string | null = m.firmwareVersion ?? null;

    await this.db.query("UPDATE devices SET hw_model = $1, firmware = $2 WHERE id = $3", [
      hwModel,
      firmware,
      deviceId,
    ]);

    // Re-emit device status with updated hw/firmware info
    const device = this.devices.get(deviceId);
    if (device) {
      const event: ServerEvent = {
        type: "device:status",
        payload: {
          id: deviceId,
          name: device.name,
          port: device.port,
          status: "connected",
          connectedAt: device.connectedAt,
          lastSeenAt: null,
          hardwareModel: hwModel,
          firmwareVersion: firmware,
          batteryLevel: this.batteryLevels.get(deviceId) ?? null,
          hasGpsPosition: this.gpsAcquired.has(deviceId),
          gpsDetail: this.gpsDetails.get(deviceId) ?? null,
          ownNodeId: this.myNodeIds.get(deviceId) ?? null,
        },
      };
      this.emit("event", event);
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private async _handleTelemetry(deviceId: string, name: string, pkt: any) {
    const variant = pkt?.data?.variant;
    if (variant?.case !== "deviceMetrics") return;

    const metrics = variant.value;
    const batteryLevel: number | undefined = metrics?.batteryLevel;
    if (batteryLevel == null || batteryLevel === 0) return; // 0 typically means "plugged in, no reading"

    const fromNodeId: number = pkt.from ?? 0;
    const myNodeId = this.myNodeIds.get(deviceId);

    // Only update device battery when the telemetry originates from the device itself
    if (myNodeId === undefined || fromNodeId !== myNodeId) return;

    const prev = this.batteryLevels.get(deviceId);
    if (prev === batteryLevel) return; // no change, skip emit

    this.batteryLevels.set(deviceId, batteryLevel);
    console.log(`[devices] battery ${name} ${batteryLevel}%`);

    const device = this.devices.get(deviceId);
    if (!device) return;

    // Fetch current hw/firmware to include in the status event
    const { rows } = await this.db.query<{ hw_model: string | null; firmware: string | null }>(
      "SELECT hw_model, firmware FROM devices WHERE id = $1",
      [deviceId],
    );
    const row = rows[0];

    const event: ServerEvent = {
      type: "device:status",
      payload: {
        id: deviceId,
        name: device.name,
        port: device.port,
        status: "connected",
        connectedAt: device.connectedAt,
        lastSeenAt: null,
        hardwareModel: row?.hw_model ?? null,
        firmwareVersion: row?.firmware ?? null,
        batteryLevel,
        hasGpsPosition: this.gpsAcquired.has(deviceId),
        gpsDetail: this.gpsDetails.get(deviceId) ?? null,
        ownNodeId: this.myNodeIds.get(deviceId) ?? null,
      },
    };
    this.emit("event", event);
  }
}
