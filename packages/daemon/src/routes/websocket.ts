import { randomUUID } from "node:crypto";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

import { clientCommandSchema, formatNodeId } from "@foreman/shared";
import { Types } from "@meshtastic/core";

import { consoleLog } from "../activity/console-log.js";
import { activityLog } from "../activity/log.js";
import { createLogger } from "../logger.js";

import type { DeviceManager } from "../device/device-manager.js";
import type { MqttGateway } from "../mqtt/gateway.js";
import type { PGlite } from "@electric-sql/pglite";
import type {
  ServerEvent,
  ClientCommand,
  Message,
  MqttNode,
  ActivityEntry,
  LogEntry,
} from "@foreman/shared";
import type { FastifyInstance } from "fastify";
import type { WebSocket, RawData } from "ws";

const log = createLogger("ws");

export interface WsRouteHandle {
  /** Closes every currently-connected WebSocket client. */
  closeAll(code: number, reason: string): void;
}

/**
 * Updates a key=value pair in the root .env file.
 * If the key exists, its value is replaced in-place; if not, it is appended.
 */
function persistEnvVar(key: string, value: string): void {
  // The daemon runs from packages/daemon; the .env file is two levels up at the repo root.
  const envPath = resolve(process.cwd(), "../../.env");
  if (!existsSync(envPath)) return;
  const content = readFileSync(envPath, "utf-8");
  const regex = new RegExp(`^${key}=.*$`, "m");
  const updated = regex.test(content)
    ? content.replace(regex, `${key}=${value}`)
    : `${content}\n${key}=${value}`;
  writeFileSync(envPath, updated, "utf-8");
}

/**
 * Single WebSocket endpoint at /ws
 * - On connect: sends current device list and node snapshot
 * - Forwards all DeviceManager events to connected clients
 * - Receives ClientCommands from the frontend
 */
export async function registerWsRoute(
  app: FastifyInstance,
  deviceManager: DeviceManager,
  mqttGateway?: MqttGateway | null,
  db?: PGlite,
): Promise<WsRouteHandle> {
  const clients = new Set<WebSocket>();
  /** Sockets that have opted in to raw packet streaming */
  const packetSubscriptions = new Set<WebSocket>();

  const broadcast = (event: ServerEvent) => {
    // packet:raw only goes to subscribed clients
    const targets = event.type === "packet:raw" ? packetSubscriptions : clients;
    const json = JSON.stringify(event);
    for (const client of targets) {
      if (client.readyState === 1 /* OPEN */) {
        client.send(json);
      }
    }
  };

  deviceManager.on("event", broadcast);

  // Forward mqtt_node:update events from the gateway to all WS clients
  mqttGateway?.on("mqtt_node:update", (node: MqttNode) => {
    const event: ServerEvent = { type: "mqtt_node:update", payload: node };
    broadcast(event);
  });

  // Stream new activity entries to all clients as they arrive
  activityLog.on("entry", (entry: ActivityEntry) => {
    const event: ServerEvent = { type: "activity:entry", payload: entry };
    broadcast(event);
  });

  // Stream console log lines to all clients
  consoleLog.on("entry", (entry: LogEntry) => {
    const event: ServerEvent = { type: "log:entry", payload: entry };
    broadcast(event);
  });

  app.get("/ws", { websocket: true }, (socket) => {
    clients.add(socket);
    log.info({ operation: "client-connect", clientCount: clients.size }, "client connected");

    // Send current state snapshot on connect
    deviceManager.listDevices().then(async (devices) => {
      const deviceListEvent: ServerEvent = {
        type: "device:list",
        payload: devices.map((d) => {
          const live = deviceManager.getDevice(d.id);
          return {
            id: d.id,
            name: d.name,
            port: d.port,
            status: live ? ("connected" as const) : ("disconnected" as const),
            connectedAt: live?.connectedAt ?? null,
            lastSeenAt: live?.connectedAt ?? d.last_seen ?? null,
            hardwareModel: d.hw_model ?? null,
            firmwareVersion: d.firmware ?? null,
            batteryLevel: deviceManager.getBatteryLevel(d.id),
            hasGpsPosition: deviceManager.hasGpsPosition(d.id),
            gpsDetail: deviceManager.getGpsDetail(d.id),
            ownNodeId: deviceManager.getMyNodeId(d.id) ?? null,
          };
        }),
      };
      socket.send(JSON.stringify(deviceListEvent));

      // Send all known nodes and config for each device
      for (const d of devices) {
        const nodes = await deviceManager.listNodes(d.id);
        if (nodes.length > 0) {
          socket.send(JSON.stringify({ type: "node:list", payload: nodes } satisfies ServerEvent));
        }
        const config = await deviceManager.getDeviceConfig(d.id);
        if (config) {
          socket.send(
            JSON.stringify({ type: "device:config", payload: config } satisfies ServerEvent),
          );
        }
      }

      // Send known MQTT-sourced nodes
      if (mqttGateway) {
        const mqttNodes = await mqttGateway.listMqttNodes();
        if (mqttNodes.length > 0) {
          const mqttListEvent: ServerEvent = { type: "mqtt_node:list", payload: mqttNodes };
          socket.send(JSON.stringify(mqttListEvent));
        }
      }

      // Send recent activity log snapshot
      const snapshot = activityLog.snapshot();
      if (snapshot.length > 0) {
        socket.send(
          JSON.stringify({ type: "activity:snapshot", payload: snapshot } satisfies ServerEvent),
        );
      }

      // Send console log snapshot
      const logSnapshot = consoleLog.snapshot();
      if (logSnapshot.length > 0) {
        socket.send(
          JSON.stringify({ type: "log:snapshot", payload: logSnapshot } satisfies ServerEvent),
        );
      }

      // Send current MQTT status
      socket.send(
        JSON.stringify({
          type: "mqtt:status",
          payload: { enabled: mqttGateway?.isRunning ?? false },
        } satisfies ServerEvent),
      );
    });

    socket.on("message", (raw: RawData) => {
      let parsed: ClientCommand;
      try {
        parsed = clientCommandSchema.parse(JSON.parse(raw.toString()));
      } catch {
        socket.send(
          JSON.stringify({
            type: "error",
            payload: { code: "INVALID_COMMAND", message: "Unrecognized command" },
          }),
        );
        return;
      }

      handleClientCommand(
        parsed,
        socket,
        deviceManager,
        packetSubscriptions,
        mqttGateway,
        db,
        broadcast,
      ).catch((err) => {
        log.error(
          { operation: "handle-command", command: parsed.type, err },
          "command handling failed",
        );
        socket.send(
          JSON.stringify({
            type: "error",
            payload: { code: "COMMAND_ERROR", message: String(err.message) },
          }),
        );
      });
    });

    socket.on("close", () => {
      clients.delete(socket);
      packetSubscriptions.delete(socket);
      log.info(
        { operation: "client-disconnect", clientCount: clients.size },
        "client disconnected",
      );
    });
  });

  return {
    closeAll(code: number, reason: string): void {
      for (const client of Array.from(clients)) {
        if (client.readyState === 1 /* OPEN */) client.close(code, reason);
      }
    },
  };
}

async function handleClientCommand(
  command: ClientCommand,
  socket: WebSocket,
  deviceManager: DeviceManager,
  packetSubscriptions: Set<WebSocket>,
  mqttGateway?: MqttGateway | null,
  db?: PGlite,
  broadcast?: (event: ServerEvent) => void,
) {
  switch (command.type) {
    case "message:send": {
      const { deviceId, text, toNodeId, channelIndex, wantAck } = command.payload;
      const device = deviceManager.getDevice(deviceId);
      if (!device) {
        socket.send(
          JSON.stringify({
            type: "error",
            payload: { code: "DEVICE_NOT_FOUND", message: `No device with id ${deviceId}` },
          }),
        );
        return;
      }
      let packetId: number;
      try {
        packetId = await device.meshDevice.sendText(
          text,
          toNodeId,
          wantAck,
          channelIndex as Types.ChannelNumber,
        );
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        log.warn({ deviceId, operation: "send-message", toNodeId, err }, "message send failed");
        socket.send(
          JSON.stringify({
            type: "message:send-failed",
            payload: {
              clientMsgId: command.payload.clientMsgId ?? null,
              deviceId,
              message,
            },
          } satisfies ServerEvent),
        );
        return;
      }
      const txTime = new Date().toISOString();
      const msgId = randomUUID();
      const myNodeId = deviceManager.getMyNodeId(deviceId) ?? 0;
      const ackStatus = wantAck ? "pending" : null;
      if (db) {
        await db.query(
          `INSERT INTO messages(id, packet_id, device_id, from_node_id, to_node_id, channel_index,
             text, rx_time, want_ack, role, ack_status, reply_to_packet_id)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'sent', $10, 0)`,
          [
            msgId,
            packetId,
            deviceId,
            myNodeId,
            toNodeId,
            channelIndex,
            text,
            txTime,
            wantAck,
            ackStatus,
          ],
        );
      }
      const sentMsg: Message = {
        id: msgId,
        packetId,
        fromNodeId: myNodeId,
        toNodeId,
        channelIndex,
        text,
        rxTime: txTime,
        rxSnr: null,
        rxRssi: null,
        hopLimit: null,
        wantAck,
        viaMqtt: false,
        role: "sent",
        ackStatus,
        ackAt: null,
        ackError: null,
        replyToPacketId: 0,
      };
      if (broadcast) broadcast({ type: "message:sent", payload: sentMsg });
      log.info({ deviceId, packetId, operation: "send-message", toNodeId }, "message sent");
      break;
    }

    case "packets:subscribe": {
      const device = deviceManager.getDevice(command.payload.deviceId);
      if (!device) {
        socket.send(
          JSON.stringify({
            type: "error",
            payload: {
              code: "DEVICE_NOT_FOUND",
              message: `No device with id ${command.payload.deviceId}`,
            },
          }),
        );
        return;
      }
      if (command.payload.enabled) {
        packetSubscriptions.add(socket);
      } else {
        packetSubscriptions.delete(socket);
      }
      log.info(
        {
          deviceId: command.payload.deviceId,
          operation: "packet-subscription",
          enabled: command.payload.enabled,
        },
        "packet subscription updated",
      );
      break;
    }

    case "nodes:request-list": {
      const { deviceId } = command.payload;
      const device = deviceManager.getDevice(deviceId);
      if (!device) {
        socket.send(
          JSON.stringify({
            type: "error",
            payload: { code: "DEVICE_NOT_FOUND", message: `No device with id ${deviceId}` },
          }),
        );
        return;
      }
      const nodes = await deviceManager.listNodes(deviceId);
      const event: ServerEvent = { type: "node:list", payload: nodes };
      socket.send(JSON.stringify(event));
      log.info(
        { deviceId, operation: "list-nodes", nodeCount: nodes.length },
        "node list returned",
      );
      break;
    }

    case "mqtt_nodes:request-list": {
      const nodes = mqttGateway ? await mqttGateway.listMqttNodes() : [];
      const event: ServerEvent = { type: "mqtt_node:list", payload: nodes };
      socket.send(JSON.stringify(event));
      log.info(
        { operation: "list-mqtt-nodes", nodeCount: nodes.length },
        "MQTT node list returned",
      );
      break;
    }

    case "node:request-position": {
      const { deviceId, nodeId } = command.payload;
      const device = deviceManager.getDevice(deviceId);
      if (!device) {
        socket.send(
          JSON.stringify({
            type: "error",
            payload: { code: "DEVICE_NOT_FOUND", message: `No device with id ${deviceId}` },
          }),
        );
        return;
      }
      // Re-emit cached GPS immediately so the frontend spinner clears with current data.
      // The requestPosition call below may or may not yield fresher data afterward.
      deviceManager.refreshGpsPosition(deviceId);
      // Fire-and-forget: ask the hardware for a fresh position in the background.
      device.meshDevice
        .requestPosition(nodeId)
        .then(() => {
          log.info(
            { deviceId, operation: "request-position", nodeId: formatNodeId(nodeId) },
            "node position requested",
          );
        })
        .catch((err: unknown) => {
          log.warn(
            { deviceId, operation: "request-position", nodeId: formatNodeId(nodeId), err },
            "node position request failed",
          );
        });
      break;
    }

    case "node:traceroute": {
      const { deviceId, nodeId } = command.payload;
      const device = deviceManager.getDevice(deviceId);
      if (!device) {
        socket.send(
          JSON.stringify({
            type: "error",
            payload: { code: "DEVICE_NOT_FOUND", message: `No device with id ${deviceId}` },
          }),
        );
        return;
      }
      try {
        await device.meshDevice.traceRoute(nodeId);
        log.info(
          { deviceId, operation: "traceroute", nodeId: formatNodeId(nodeId) },
          "node traceroute requested",
        );
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        log.warn(
          { deviceId, operation: "traceroute", nodeId: formatNodeId(nodeId), err },
          "node traceroute failed",
        );
        socket.send(
          JSON.stringify({
            type: "error",
            payload: { code: "NODE_UNREACHABLE", message: `Traceroute failed (${msg})`, nodeId },
          }),
        );
      }
      break;
    }

    case "node:remove": {
      const { deviceId, nodeId } = command.payload;
      const device = deviceManager.getDevice(deviceId);
      if (!device) {
        socket.send(
          JSON.stringify({
            type: "error",
            payload: { code: "DEVICE_NOT_FOUND", message: `No device with id ${deviceId}` },
          }),
        );
        return;
      }
      try {
        // Tell the radio to wipe this node from its nodeDB via AdminMessage over serial
        await device.meshDevice.removeNodeByNum(nodeId);
        log.info(
          { deviceId, operation: "remove-node-device", nodeId: formatNodeId(nodeId) },
          "node removed from device database",
        );
      } catch (err: unknown) {
        log.warn(
          { deviceId, operation: "remove-node-device", nodeId: formatNodeId(nodeId), err },
          "serial node removal failed",
        );
        // Don't abort — still clear our local cache below so the UI refreshes
      }
      // Always clear from daemon's local DB so stale data doesn't linger
      if (db) {
        await db.query("DELETE FROM nodes WHERE device_id = $1 AND node_id = $2", [
          deviceId,
          nodeId,
        ]);
        log.info(
          { deviceId, operation: "remove-node-local", nodeId: formatNodeId(nodeId) },
          "node removed from local database",
        );
      }
      socket.send(
        JSON.stringify({
          type: "node:removed",
          payload: { nodeId },
        } satisfies ServerEvent),
      );
      break;
    }

    case "device:config-request": {
      const { deviceId } = command.payload;
      const config = await deviceManager.getDeviceConfig(deviceId);
      if (!config) {
        socket.send(
          JSON.stringify({
            type: "error",
            payload: { code: "DEVICE_NOT_FOUND", message: `No config for device ${deviceId}` },
          }),
        );
        return;
      }
      socket.send(JSON.stringify({ type: "device:config", payload: config } satisfies ServerEvent));
      log.info({ deviceId, operation: "get-config" }, "device configuration returned");
      break;
    }

    case "device:set-config": {
      const { deviceId, namespace, section, value } = command.payload;
      try {
        await deviceManager.applyConfigSection(
          deviceId,
          namespace,
          section,
          value as Record<string, unknown>,
        );
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        socket.send(
          JSON.stringify({
            type: "error",
            payload: { code: "SET_CONFIG_FAILED", message: msg },
          } satisfies ServerEvent),
        );
      }
      break;
    }

    case "mqtt:toggle": {
      const { enabled } = command.payload;
      if (!mqttGateway) {
        socket.send(
          JSON.stringify({
            type: "error",
            payload: { code: "NO_MQTT", message: "MQTT gateway not configured" },
          } satisfies ServerEvent),
        );
        return;
      }
      if (enabled && !mqttGateway.isRunning) {
        mqttGateway.start();
        log.info({ operation: "toggle-mqtt", enabled: true }, "MQTT gateway started");
      } else if (!enabled && mqttGateway.isRunning) {
        mqttGateway.stop();
        log.info({ operation: "toggle-mqtt", enabled: false }, "MQTT gateway stopped");
      }
      // Persist the new state so the next restart honours the user's choice
      persistEnvVar("ENABLE_MQTT", enabled ? "true" : "false");
      // Broadcast new status to all clients
      broadcast?.({ type: "mqtt:status", payload: { enabled: mqttGateway.isRunning } });
      break;
    }

    case "messages:request-history": {
      const { deviceId, channelIndex, toNodeId, limit, before } = command.payload;
      const device = deviceManager.getDevice(deviceId);
      if (!device) {
        socket.send(
          JSON.stringify({
            type: "error",
            payload: { code: "DEVICE_NOT_FOUND", message: `No device with id ${deviceId}` },
          }),
        );
        return;
      }
      const messages = await deviceManager.getMessageHistory(deviceId, {
        channelIndex,
        toNodeId,
        limit,
        before,
      });
      const event: ServerEvent = { type: "message:history", payload: messages };
      socket.send(JSON.stringify(event));
      log.info(
        { deviceId, operation: "message-history", messageCount: messages.length },
        "message history returned",
      );
      break;
    }
  }
}
