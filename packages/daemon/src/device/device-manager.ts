import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";

import { formatNodeId } from "@foreman/shared";
import { MeshDevice, Types } from "@meshtastic/core";
import { TransportNodeSerial } from "@meshtastic/transport-node-serial";

import { mapDeviceRow, type DeviceRow } from "../db/repositories/devices.js";
import { mapMessageRow, type MessageRow } from "../db/repositories/messages.js";
import { mapNodeRow, type NodeRow } from "../db/repositories/nodes.js";
import { createLogger } from "../logger.js";

import {
  applyConfigSection as applyConfigurationSection,
  emitDeviceConfig,
  getDeviceConfig as readDeviceConfig,
  handleChannelPacket,
  handleConfigPacket,
  handleModuleConfigPacket,
} from "./configuration-handler.js";
import { adaptNodeInfo, adaptPosition, adaptTelemetry } from "./meshtastic-adapter.js";
import { handleMessage } from "./message-handler.js";
import { handleNodeInfo, handlePosition } from "./node-update-handler.js";
import { runRawProbe } from "./raw-probe.js";
import { handleRawPacket } from "./raw-packet-handler.js";
import { handleTelemetry } from "./telemetry-handler.js";
import { handleTraceroutePacket } from "./traceroute-handler.js";

import type { DaemonConfig } from "../config.js";
import type { MqttGateway } from "../mqtt/gateway.js";
import type { PGlite } from "@electric-sql/pglite";
import type {
  ServerEvent,
  Message,
  NodeInfo,
  DeviceConfig,
  GpsDetail,
  RawProbeResult,
} from "@foreman/shared";

export interface ConnectedDevice {
  id: string;
  port: string;
  name: string;
  connectedAt: string;
  meshDevice: MeshDevice;
  transport: TransportNodeSerial;
}

/** What the daemon knows about a device's latest connection (CONTRACT-013). */
export interface ConnectionFacts {
  portHeld: boolean;
  phase: "held" | "connecting" | "backoff" | "released";
  lastFrameAt: string | null;
  framesThisConnection: number;
  lastConfigRequestAt: string | null;
  configured: boolean;
}

/** Per-connection counters. A new connection gets a new object, so late frames cannot touch it. */
interface ConnectionStats {
  lastFrameMs: number | null;
  frames: number;
  lastConfigRequestMs: number | null;
  configured: boolean;
}

/** One running connect(). Cancelling it stops it acting on the device or keeping the port. */
interface ConnectAttempt {
  /** Undefined until connect() has resolved the saved row for this port. */
  id: string | undefined;
  port: string;
  name: string;
  cancelled: boolean;
  cancel: () => void;
  whenCancelled: Promise<void>;
  /** Settles once the port is open, or closed again because the attempt was cancelled. */
  opening: Promise<unknown> | null;
}

interface ReconnectTarget {
  port: string;
  name: string;
  /** Set while a dropped connection's serial handle is still closing. */
  releasing?: Promise<void>;
}

interface ActiveProbe {
  abort: AbortController;
  restore: boolean;
  done: Promise<void>;
}

/** Thrown by connect() when a disconnect, or the connection dropping, overtook it. */
export class ConnectCancelledError extends Error {
  constructor() {
    super("Connection was cancelled before it finished");
    this.name = "ConnectCancelledError";
  }
}

/** Thrown by rawProbe() when a disconnect or daemon shutdown ended it early. */
export class ProbeInterruptedError extends Error {
  constructor() {
    super("Probe was interrupted before it finished");
    this.name = "ProbeInterruptedError";
  }
}

const SERIAL_DISCONNECT_CODES = new Set(["ABORT_ERR", "ERR_STREAM_PREMATURE_CLOSE"]);
const PORT_RELEASE_TIMEOUT_MS = 3_000;
const log = createLogger("devices");

/**
 * Closes a transport and waits for the OS to release the port. The transport's
 * disconnect() starts the close without waiting for it, so reopening straight
 * afterwards can fail on the port lock. The handle is private to the transport,
 * but it is the only way to observe the close.
 */
async function releaseTransport(transport: TransportNodeSerial): Promise<void> {
  const serial = (
    transport as unknown as {
      port?: { isOpen: boolean; closing: boolean; once(event: "close", fn: () => void): void };
    }
  ).port;
  let timeout: NodeJS.Timeout | undefined;
  const closed =
    serial && (serial.isOpen || serial.closing)
      ? new Promise<void>((resolve) => {
          serial.once("close", resolve);
          timeout = setTimeout(() => {
            log.warn({ operation: "release-port" }, "serial port did not confirm close");
            resolve();
          }, PORT_RELEASE_TIMEOUT_MS);
        })
      : Promise.resolve();
  await transport.disconnect().catch(() => {});
  await closed;
  if (timeout) clearTimeout(timeout);
}

function isRecoverableSerialDisconnect(reason: unknown): boolean {
  if (!(reason instanceof Error)) return false;
  const code = (reason as NodeJS.ErrnoException).code ?? "";
  return (
    reason.name === "AbortError" ||
    SERIAL_DISCONNECT_CODES.has(code) ||
    reason.message === "Port is not open"
  );
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
  /** Devices in reconnect backoff, so a disconnect can find them without a live connection. */
  private reconnectTargets = new Map<string, ReconnectTarget>();
  /** Every connect() still running. */
  private connectAttempts = new Set<ConnectAttempt>();
  /** Stats for each device's latest connection. Kept after it ends, for diagnostics. */
  private connectionStats = new Map<string, ConnectionStats>();
  /** Raw probes in progress, by device. */
  private activeProbes = new Map<string, ActiveProbe>();
  private mqttGateway: MqttGateway | null = null;
  /** Last time each device received any mesh packet (for watchdog) */
  private lastPacketMs = new Map<string, number>();
  /** Active watchdog timers */
  private watchdogTimers = new Map<string, NodeJS.Timeout>();
  private shuttingDown = false;
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
        log.warn(
          { operation: "reconnect-saved", port: row.port, err },
          "failed to reconnect device",
        );
      });
    }
  }

  async listDevices() {
    const { rows } = await this.db.query<DeviceRow>(
      "SELECT id, name, port, hw_model, firmware, last_seen FROM devices ORDER BY created_at",
    );
    return rows.map(mapDeviceRow);
  }

  async connect(port: string, name: string, existingId?: string): Promise<ConnectedDevice> {
    // Check for existing live connection on this port
    for (const [, dev] of this.devices) {
      if (dev.port === port) return dev;
    }

    let markCancelled = () => {};
    const whenCancelled = new Promise<void>((resolve) => {
      markCancelled = resolve;
    });
    const attempt: ConnectAttempt = {
      id: existingId,
      port,
      name,
      cancelled: false,
      cancel() {
        this.cancelled = true;
        markCancelled();
      },
      whenCancelled,
      opening: null,
    };
    this.connectAttempts.add(attempt);
    try {
      return await this._runConnect(attempt);
    } finally {
      this.connectAttempts.delete(attempt);
    }
  }

  private async _runConnect(attempt: ConnectAttempt): Promise<ConnectedDevice> {
    const { port, name } = attempt;
    const stopIfCancelled = () => {
      if (attempt.cancelled) throw new ConnectCancelledError();
    };

    // Reuse existing DB row for this port if one exists, to avoid accumulating duplicates
    let id = attempt.id;
    if (!id) {
      const { rows } = await this.db.query<{ id: string }>(
        "SELECT id FROM devices WHERE port = $1 ORDER BY created_at LIMIT 1",
        [port],
      );
      id = rows[0]?.id ?? randomUUID();
      attempt.id = id;
    }
    stopIfCancelled();

    // Delete any duplicate rows for this port that aren't the canonical id
    await this.db.query("DELETE FROM devices WHERE port = $1 AND id != $2", [port, id]);

    // Upsert canonical row
    await this.db.query(
      `INSERT INTO devices(id, name, port)
       VALUES ($1, $2, $3)
       ON CONFLICT(id) DO UPDATE SET name = EXCLUDED.name, port = EXCLUDED.port`,
      [id, name, port],
    );

    stopIfCancelled();

    this._emitStatus(id, name, port, "connecting");

    // Open serial port and create transport. A disconnect waits on `opening`, so
    // the close of a cancelled open has to happen inside that promise.
    const opening = TransportNodeSerial.create(port, 115200).then(async (opened) => {
      if (!attempt.cancelled) return opened;
      await releaseTransport(opened);
      return null;
    });
    attempt.opening = opening;

    let transport: TransportNodeSerial | null;
    try {
      transport = await opening;
    } catch (err) {
      stopIfCancelled();
      // A failed open must replace the earlier "connecting" event; otherwise
      // the UI remains stuck even though no connection attempt is active.
      this._emitStatus(id, name, port, "error");
      throw err;
    }
    if (!transport) throw new ConnectCancelledError();
    const openedTransport = transport;

    // @meshtastic/core starts this pipe without awaiting its promise. Intercept
    // that specific stream instance so disconnect failures are handled at the
    // serial boundary rather than becoming process-level unhandled rejections.
    const originalPipeTo = openedTransport.fromDevice.pipeTo.bind(openedTransport.fromDevice);
    openedTransport.fromDevice.pipeTo = ((destination, options) =>
      originalPipeTo(destination, options).catch((err: unknown) => {
        if (isRecoverableSerialDisconnect(err)) {
          log.warn({ deviceId: id, operation: "serial-read", err }, "serial read stopped");
          return;
        }
        this.emit("transport:error", err);
      })) as typeof openedTransport.fromDevice.pipeTo;

    // MeshDevice constructor starts piping the fromDevice stream immediately
    const meshDevice = new MeshDevice(openedTransport);

    const connectedAt = new Date().toISOString();
    const device: ConnectedDevice = {
      id,
      port,
      name,
      connectedAt,
      meshDevice,
      transport: openedTransport,
    };
    this.devices.set(id, device);
    const stats: ConnectionStats = {
      lastFrameMs: null,
      frames: 0,
      lastConfigRequestMs: null,
      configured: false,
    };
    this.connectionStats.set(id, stats);
    await this.db.query("UPDATE devices SET last_seen = $1 WHERE id = $2", [connectedAt, id]);
    stopIfCancelled();

    // Subscribe to all relevant events
    meshDevice.events.onMessagePacket.subscribe((pkt: Types.PacketMetadata<string>) => {
      handleMessage(
        {
          db: this.db,
          emit: (event) => this.emit("event", event),
          botEnabled: this.config.bot.enabled,
          pendingReplyIds: this.pendingReplyIds,
          getMeshDevice: (deviceId) => this.devices.get(deviceId)?.meshDevice,
          getMyNodeId: (deviceId) => this.myNodeIds.get(deviceId),
        },
        id,
        pkt,
      ).catch((err) =>
        log.error(
          { deviceId: id, packetId: pkt.id, operation: "handle-message", err },
          "message handling failed",
        ),
      );
    });

    // Protobuf types come from @meshtastic/protobufs which is bundled into core;
    // using `any` here since the package isn't separately resolvable by TypeScript.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    meshDevice.events.onMeshPacket.subscribe((pkt: any) => {
      handleRawPacket(
        {
          db: this.db,
          emit: (event) => this.emit("event", event),
          pendingReplyIds: this.pendingReplyIds,
          getMyNodeId: (deviceId) => this.myNodeIds.get(deviceId),
          setLastPacketMs: (deviceId, value) => this.lastPacketMs.set(deviceId, value),
        },
        id,
        pkt,
      ).catch((err) =>
        log.error(
          { deviceId: id, packetId: pkt.id, operation: "handle-raw-packet", err },
          "raw packet handling failed",
        ),
      );
    });

    meshDevice.events.onNodeInfoPacket.subscribe((rawNodeInfo: unknown) => {
      const nodeInfo = adaptNodeInfo(rawNodeInfo);
      if (nodeInfo === null) {
        log.warn(
          { deviceId: id, operation: "validate-node-info" },
          "rejected malformed nodeInfo packet",
        );
        return;
      }
      handleNodeInfo(
        { db: this.db, emit: (event) => this.emit("event", event) },
        id,
        nodeInfo,
      ).catch((err) =>
        log.error(
          { deviceId: id, operation: "handle-node-info", err },
          "node info handling failed",
        ),
      );
    });

    meshDevice.events.onPositionPacket.subscribe((rawPacket: unknown) => {
      const pkt = adaptPosition(rawPacket);
      if (pkt === null) {
        log.warn(
          { deviceId: id, operation: "validate-position" },
          "rejected malformed position packet",
        );
        return;
      }
      handlePosition({ db: this.db, emit: (event) => this.emit("event", event) }, id, pkt).catch(
        (err) =>
          log.error(
            { deviceId: id, operation: "handle-position", err },
            "position handling failed",
          ),
      );
    });

    meshDevice.events.onDeviceStatus.subscribe((status: Types.DeviceStatusEnum) => {
      log.info(
        {
          deviceId: id,
          operation: "device-status",
          status: Types.DeviceStatusEnum[status] ?? status,
        },
        "device status changed",
      );
      // core also re-requests config by itself when the radio reports a reboot,
      // and this event is the only sign of that request.
      if (status === Types.DeviceStatusEnum.DeviceConfiguring) this._markConfigRequested(stats);
      if (status === Types.DeviceStatusEnum.DeviceConfigured) stats.configured = true;
      void this._handleDeviceStatus(id, name, port, openedTransport, status).catch((err) =>
        log.warn(
          { deviceId: id, operation: "disconnect-cleanup", err },
          "disconnect cleanup failed",
        ),
      );
    });

    // Diagnostic: log every FromRadio frame so we know if the stream is alive
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    meshDevice.events.onFromRadio.subscribe((msg: any) => {
      stats.lastFrameMs = Date.now();
      stats.frames += 1;
      const variant = msg?.payloadVariant?.case ?? "unknown";
      if (variant === "packet") return; // already handled by onMeshPacket
      if (variant === "fileInfo") {
        // Device is advertising a file on its local filesystem (map tiles,
        // ringtones, UI assets, etc.).  Informational only — log and move on.
        const f = msg.payloadVariant.value;
        log.info(
          { deviceId: id, operation: "file-info", fileName: f?.fileName, sizeBytes: f?.sizeBytes },
          "device file advertised",
        );
        return;
      }
      log.info({ deviceId: id, operation: "from-radio", variant }, "radio frame received");
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    meshDevice.events.onQueueStatus.subscribe((status: any) => {
      log.info(
        {
          deviceId: id,
          packetId: status.meshPacketId,
          operation: "queue-status",
          result: status.res,
          free: status.free,
          maxLength: status.maxlen,
        },
        "queue status received",
      );
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    meshDevice.events.onTraceRoutePacket.subscribe((pkt: any) => {
      handleTraceroutePacket(
        {
          db: this.db,
          emit: (event) => this.emit("event", event),
          getMyNodeId: (deviceId) => this.myNodeIds.get(deviceId),
        },
        id,
        pkt,
      ).catch((err) =>
        log.error(
          { deviceId: id, packetId: pkt.id, operation: "save-traceroute", err },
          "traceroute save failed",
        ),
      );
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    meshDevice.events.onDeviceMetadataPacket.subscribe(({ data }: any) => {
      this._handleMetadata(id, data).catch((err) =>
        log.error({ deviceId: id, operation: "handle-metadata", err }, "metadata handling failed"),
      );
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    meshDevice.events.onConfigPacket.subscribe((pkt: any) => {
      handleConfigPacket(this._configurationDeps(), id, name, pkt).catch((err) =>
        log.error(
          { deviceId: id, operation: "handle-config-packet", err },
          "config packet handling failed",
        ),
      );
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    meshDevice.events.onModuleConfigPacket.subscribe((pkt: any) => {
      handleModuleConfigPacket(this._configurationDeps(), id, name, pkt).catch((err) =>
        log.error(
          { deviceId: id, operation: "handle-module-config-packet", err },
          "module config packet handling failed",
        ),
      );
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    meshDevice.events.onChannelPacket.subscribe((pkt: any) => {
      handleChannelPacket(this._configurationDeps(), id, name, pkt).catch((err) =>
        log.error(
          { deviceId: id, operation: "handle-channel-packet", err },
          "channel packet handling failed",
        ),
      );
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    meshDevice.events.onMyNodeInfo.subscribe((info: any) => {
      const nodeNum: number = info?.myNodeNum ?? 0;
      if (nodeNum !== 0) {
        this.myNodeIds.set(id, nodeNum);
        log.info(
          { deviceId: id, operation: "own-node-info", nodeId: formatNodeId(nodeNum) },
          "own node info received",
        );
      }
    });

    meshDevice.events.onTelemetryPacket.subscribe((rawPacket: unknown) => {
      const pkt = adaptTelemetry(rawPacket);
      if (pkt === null) {
        log.warn(
          { deviceId: id, operation: "validate-telemetry" },
          "rejected malformed telemetry packet",
        );
        return;
      }
      handleTelemetry(
        {
          db: this.db,
          emit: (event) => this.emit("event", event),
          getDevice: (deviceId) => this.devices.get(deviceId),
          getMyNodeId: (deviceId) => this.myNodeIds.get(deviceId),
          getBatteryLevel: (deviceId) => this.batteryLevels.get(deviceId),
          setBatteryLevel: (deviceId, level) => this.batteryLevels.set(deviceId, level),
          hasGpsPosition: (deviceId) => this.gpsAcquired.has(deviceId),
          getGpsDetail: (deviceId) => this.gpsDetails.get(deviceId),
        },
        id,
        name,
        pkt,
      ).catch((err) =>
        log.error(
          { deviceId: id, operation: "handle-telemetry", err },
          "telemetry handling failed",
        ),
      );
    });

    // Attach to MQTT gateway BEFORE configure so it catches onMyNodeInfo/onChannelPacket
    this.mqttGateway?.attachDevice(id, meshDevice);

    // Send configure request — device will begin streaming its config back
    log.info({ deviceId: id, operation: "configure" }, "device configuration started");
    // core may never settle this promise once the port closes, so the race lets
    // a cancelled attempt finish straight away.
    await Promise.race([this._requestConfig(id, meshDevice), attempt.whenCancelled]).catch(
      (err: unknown) => {
        stopIfCancelled();
        throw err;
      },
    );
    stopIfCancelled();
    log.info({ deviceId: id, operation: "configure" }, "device configuration completed");

    // Request the device's own position immediately after configure.
    // This ensures GPS data arrives even if the device hasn't broadcast a position yet.
    const ownNodeId = this.myNodeIds.get(id);
    if (ownNodeId) {
      meshDevice
        .requestPosition(ownNodeId)
        .catch((err: unknown) =>
          log.warn({ deviceId: id, operation: "request-position", err }, "position request failed"),
        );
    }

    // Send periodic heartbeats so the serial link stays alive indefinitely.
    // Without this the Meshtastic firmware stops forwarding packets to the host.
    meshDevice.setHeartbeatInterval(30_000);

    this._emitStatus(id, name, port, "connected", connectedAt);
    log.info({ deviceId: id, operation: "connect", name, port }, "device connected");

    // Emit config snapshot now that all onConfigPacket/onModuleConfigPacket/onChannelPacket
    // handlers have fired and their DB writes are queued ahead of this read.
    await emitDeviceConfig(this._configurationDeps(), id);
    stopIfCancelled();

    // Watchdog: if we receive zero mesh packets for 90 s after configure, re-run
    // configure().  This recovers from the rare case where the device's serial
    // stream silently stops delivering packets after the initial handshake.
    this._startPacketWatchdog(id, name, meshDevice);

    return device;
  }

  /**
   * Releases the port and stops all reconnecting, whatever state the device is
   * in. It stays down until a reconnect or connect is asked for, or the daemon
   * restarts. See CONTRACT-013.
   */
  async disconnect(deviceId: string) {
    const probe = this.activeProbes.get(deviceId);
    if (probe) {
      probe.restore = false;
      probe.abort.abort();
      await probe.done;
    }
    await this._releaseDevice(deviceId);
  }

  private async _releaseDevice(deviceId: string): Promise<void> {
    const device = this.devices.get(deviceId);
    const backoff = this.reconnectTargets.get(deviceId);
    const attempts = this._activeAttempts(deviceId);
    for (const attempt of attempts) attempt.cancel();

    const port = device?.port ?? backoff?.port ?? attempts[0]?.port;
    if (port) this._clearReconnect(deviceId, port);

    const watchdog = this.watchdogTimers.get(deviceId);
    if (watchdog) clearInterval(watchdog);
    this.watchdogTimers.delete(deviceId);

    if (device) {
      this.devices.delete(deviceId);
      this.myNodeIds.delete(deviceId);
      this.batteryLevels.delete(deviceId);
      this.gpsAcquired.delete(deviceId);
      this.gpsDetails.delete(deviceId);
      this.mqttGateway?.detachDevice(deviceId);
      await releaseTransport(device.transport);
    }

    // A connect that has not resolved its row yet can only be matched by port.
    const unresolved = [...this.connectAttempts].filter((a) => a.id === undefined && !a.cancelled);
    if (unresolved.length > 0) {
      const { rows } = await this.db.query<{ port: string }>(
        "SELECT port FROM devices WHERE id = $1",
        [deviceId],
      );
      for (const attempt of unresolved) {
        if (attempt.port !== rows[0]?.port) continue;
        attempt.cancel();
        attempts.push(attempt);
      }
    }

    await backoff?.releasing;
    await Promise.all(attempts.map((attempt) => attempt.opening?.catch(() => {})));

    const known = device ?? backoff ?? attempts[0];
    if (!known) return;
    this._emitStatus(deviceId, known.name, known.port, "disconnected");
    log.info({ deviceId, operation: "disconnect" }, "device disconnected");
  }

  private _activeAttempts(deviceId: string): ConnectAttempt[] {
    return [...this.connectAttempts].filter((a) => a.id === deviceId && !a.cancelled);
  }

  private _clearReconnect(deviceId: string, port: string): void {
    const timer = this.reconnectTimers.get(port);
    if (timer) clearTimeout(timer);
    this.reconnectTimers.delete(port);
    this.reconnectingPorts.delete(port);
    this.reconnectAttempts.delete(port);
    this.reconnectTargets.delete(deviceId);
  }

  /**
   * Starts the connect path for a device with no live connection and returns at
   * once. A failure falls back to normal reconnect backoff.
   */
  reconnect(deviceId: string, port: string, name: string): void {
    this._clearReconnect(deviceId, port);
    if (this._activeAttempts(deviceId).length > 0) return;
    void this._attemptReconnect(deviceId, port, name, 1);
  }

  private async _attemptReconnect(
    deviceId: string,
    port: string,
    name: string,
    attempt: number,
  ): Promise<void> {
    log.info({ deviceId, operation: "reconnect", attempt, port }, "attempting reconnect");
    try {
      await this.connect(port, name, deviceId);
      this.reconnectAttempts.delete(port); // success — reset backoff
    } catch (err: unknown) {
      if (err instanceof ConnectCancelledError) {
        log.info({ deviceId, operation: "reconnect", attempt, port }, "reconnect cancelled");
        return;
      }
      log.warn({ deviceId, operation: "reconnect", attempt, port, err }, "reconnect failed");
      this._emitStatus(deviceId, name, port, "disconnected");
      // Schedule another attempt — keeps retrying until the device comes back
      this._scheduleReconnect(deviceId, port, name);
    }
  }

  /** Sends a config request and returns at once. False when the port is not held. */
  requestConfig(deviceId: string): boolean {
    const device = this.devices.get(deviceId);
    if (!device) return false;
    this._requestConfig(deviceId, device.meshDevice).catch((err: unknown) =>
      log.warn({ deviceId, operation: "request-config", err }, "config request failed"),
    );
    return true;
  }

  /**
   * Runs the raw serial probe from CONTRACT-013 on the given saved port: releases
   * the port, probes it, then starts a reconnect if the device was held or trying
   * to reconnect beforehand.
   */
  async rawProbe(deviceId: string, port: string, name: string): Promise<RawProbeResult> {
    let finished = () => {};
    const probe: ActiveProbe = {
      abort: new AbortController(),
      restore:
        this.devices.has(deviceId) ||
        this.reconnectTargets.has(deviceId) ||
        this._activeAttempts(deviceId).length > 0,
      done: new Promise((resolve) => {
        finished = resolve;
      }),
    };
    this.activeProbes.set(deviceId, probe);

    try {
      await this._releaseDevice(deviceId);
      if (probe.abort.signal.aborted) throw new ProbeInterruptedError();
      const reading = await runRawProbe(port, probe.abort.signal);
      if (probe.abort.signal.aborted) throw new ProbeInterruptedError();
      if (probe.restore) this.reconnect(deviceId, port, name);
      return { ...reading, reconnecting: probe.restore };
    } finally {
      this.activeProbes.delete(deviceId);
      finished();
    }
  }

  getConnectionFacts(deviceId: string): ConnectionFacts {
    const stats = this.connectionStats.get(deviceId);
    const portHeld = this.devices.has(deviceId);
    let phase: ConnectionFacts["phase"] = "released";
    if (portHeld) phase = "held";
    else if (this._activeAttempts(deviceId).length > 0) phase = "connecting";
    else if (this.reconnectTargets.has(deviceId)) phase = "backoff";

    const toIso = (ms: number | null | undefined) =>
      ms == null ? null : new Date(ms).toISOString();
    return {
      portHeld,
      phase,
      lastFrameAt: toIso(stats?.lastFrameMs),
      framesThisConnection: stats?.frames ?? 0,
      lastConfigRequestAt: toIso(stats?.lastConfigRequestMs),
      configured: stats?.configured ?? false,
    };
  }

  /**
   * Process-shutdown hook. Stops future reconnect scheduling, clears timer
   * state that may not belong to a currently-connected device, and disconnects
   * all current devices without allowing one failure to block another.
   */
  async shutdown(): Promise<void> {
    this.shuttingDown = true;

    for (const timer of this.watchdogTimers.values()) clearInterval(timer);
    this.watchdogTimers.clear();
    for (const timer of this.reconnectTimers.values()) clearTimeout(timer);
    this.reconnectTimers.clear();
    this.reconnectingPorts.clear();
    this.reconnectTargets.clear();

    for (const attempt of this.connectAttempts) attempt.cancel();
    const openings = [...this.connectAttempts].map((attempt) => attempt.opening?.catch(() => {}));

    const results = await Promise.allSettled([
      ...openings,
      ...Array.from(this.activeProbes.keys(), (deviceId) => this.disconnect(deviceId)),
      ...Array.from(this.devices.keys(), (deviceId) => this.disconnect(deviceId)),
    ]);
    for (const result of results) {
      if (result.status === "rejected") {
        log.error(
          { operation: "shutdown-disconnect", err: result.reason },
          "shutdown disconnect failed",
        );
      }
    }
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
    const { rows } = await this.db.query<NodeRow>(
      `SELECT node_id, long_name, short_name, mac_address, hw_model, public_key,
              last_heard, snr, hops_away, latitude, longitude, altitude
       FROM nodes WHERE device_id = $1 ORDER BY last_heard DESC NULLS LAST`,
      [deviceId],
    );
    return rows.map(mapNodeRow);
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

    const { rows } = await this.db.query<MessageRow>(query, params);

    return rows.map(mapMessageRow);
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

  private _markConfigRequested(stats: ConnectionStats): void {
    stats.lastConfigRequestMs = Date.now();
    stats.configured = false;
  }

  /**
   * Every config request the daemon makes goes through here. core only reports
   * "configuring" on a status change, so repeat requests would otherwise go
   * unrecorded. The returned promise proves nothing about the radio: it settles
   * after a 60 second timeout whether or not the radio answered. Use
   * `DeviceConfigured` for that.
   */
  private _requestConfig(deviceId: string, meshDevice: MeshDevice): Promise<number> {
    const stats = this.connectionStats.get(deviceId);
    if (stats) this._markConfigRequested(stats);
    return meshDevice.configure();
  }

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
        log.info(
          { deviceId, operation: "watchdog-configure", silentMs },
          "device silent; re-running configuration",
        );
        this.lastPacketMs.set(deviceId, Date.now()); // prevent hammering
        try {
          await this._requestConfig(deviceId, meshDevice);
          log.info(
            { deviceId, operation: "watchdog-configure" },
            "watchdog configuration completed",
          );
        } catch (err: unknown) {
          log.warn(
            { deviceId, operation: "watchdog-configure", err },
            "watchdog configuration failed",
          );
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
      // A connect still waiting on this transport must not report it as connected.
      for (const attempt of this._activeAttempts(deviceId)) attempt.cancel();

      // Releasing the old SerialPort handle is essential on Windows. Without
      // this, an automatic reopen can race the stale handle and COMx remains
      // unavailable even though the manager considers it disconnected.
      const releasing = releaseTransport(device.transport);
      // Recorded now so a disconnect arriving during the close can stop the
      // reconnect scheduled below, and wait for the port too.
      this.reconnectTargets.set(deviceId, { port, name, releasing });
      await releasing;
      if (this.reconnectTargets.get(deviceId)?.releasing !== releasing) return;
      this._emitStatus(deviceId, name, port, "disconnected");
      log.info(
        { deviceId, operation: "schedule-reconnect", delayMs: 5000 },
        "device disconnected; scheduling reconnect",
      );
      this._scheduleReconnect(deviceId, port, name);
    }
  }

  private _scheduleReconnect(deviceId: string, port: string, name: string) {
    if (this.shuttingDown) return;
    if (this.reconnectingPorts.has(port)) return;
    this.reconnectingPorts.add(port);
    this.reconnectTargets.set(deviceId, { port, name });

    const attempt = (this.reconnectAttempts.get(port) ?? 0) + 1;
    this.reconnectAttempts.set(port, attempt);

    // Exponential backoff: 5s, 10s, 20s, 40s, capped at 60s
    const delayMs = Math.min(5000 * Math.pow(2, attempt - 1), 60_000);
    log.info(
      { deviceId, operation: "schedule-reconnect", attempt, delayMs },
      "reconnect scheduled",
    );

    const timer = setTimeout(async () => {
      this.reconnectTimers.delete(port);
      this.reconnectingPorts.delete(port);
      this.reconnectTargets.delete(deviceId);
      if (this.devices.has(deviceId)) {
        this.reconnectAttempts.delete(port);
        return; // already reconnected by another path
      }
      await this._attemptReconnect(deviceId, port, name, attempt);
    }, delayMs);
    this.reconnectTimers.set(port, timer);
  }

  async getDeviceConfig(deviceId: string): Promise<DeviceConfig | null> {
    return readDeviceConfig(this.db, deviceId);
  }

  async applyConfigSection(
    deviceId: string,
    namespace: "radio" | "module",
    section: string,
    value: Record<string, unknown>,
  ): Promise<void> {
    return applyConfigurationSection(
      this._configurationDeps(),
      deviceId,
      namespace,
      section,
      value,
    );
  }

  private _configurationDeps() {
    return {
      db: this.db,
      emit: (event: ServerEvent) => this.emit("event", event),
      getMeshDevice: (deviceId: string) => this.devices.get(deviceId)?.meshDevice,
    };
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
}
