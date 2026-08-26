import { describe, expect, it } from "vitest";

import {
  clientCommandSchema,
  mqttToggleSchema,
  removeNodeSchema,
  requestDeviceConfigSchema,
  requestHistorySchema,
  requestMqttNodeListSchema,
  requestNodeListSchema,
  requestPositionSchema,
  requestTracerouteSchema,
  sendMessageSchema,
  setDeviceConfigSchema,
  subscribePacketsSchema,
  type ServerEvent,
} from "./ws-protocol.js";

const deviceId = "123e4567-e89b-12d3-a456-426614174000";

const commandCases = [
  {
    name: "sendMessageSchema",
    schema: sendMessageSchema,
    valid: {
      type: "message:send",
      payload: { deviceId, text: "hello", toNodeId: 42, channelIndex: 0, wantAck: true },
    },
    invalid: {
      type: "message:send",
      payload: { deviceId, text: "", toNodeId: 42, channelIndex: 0 },
    },
  },
  {
    name: "subscribePacketsSchema",
    schema: subscribePacketsSchema,
    valid: { type: "packets:subscribe", payload: { deviceId, enabled: true } },
    invalid: { type: "packets:subscribe", payload: { deviceId, enabled: "yes" } },
  },
  {
    name: "requestHistorySchema",
    schema: requestHistorySchema,
    valid: {
      type: "messages:request-history",
      payload: { deviceId, channelIndex: 1, limit: 50, before: "2026-08-24T12:00:00.000Z" },
    },
    invalid: { type: "messages:request-history", payload: { deviceId, limit: 501 } },
  },
  {
    name: "requestNodeListSchema",
    schema: requestNodeListSchema,
    valid: { type: "nodes:request-list", payload: { deviceId } },
    invalid: { type: "nodes:request-list", payload: {} },
  },
  {
    name: "requestMqttNodeListSchema",
    schema: requestMqttNodeListSchema,
    valid: { type: "mqtt_nodes:request-list", payload: {} },
    invalid: { type: "mqtt_nodes:request-list" },
  },
  {
    name: "requestPositionSchema",
    schema: requestPositionSchema,
    valid: { type: "node:request-position", payload: { deviceId, nodeId: 42 } },
    invalid: { type: "node:request-position", payload: { deviceId, nodeId: 1.5 } },
  },
  {
    name: "requestTracerouteSchema",
    schema: requestTracerouteSchema,
    valid: { type: "node:traceroute", payload: { deviceId, nodeId: 42 } },
    invalid: { type: "node:traceroute", payload: { deviceId, nodeId: "42" } },
  },
  {
    name: "removeNodeSchema",
    schema: removeNodeSchema,
    valid: { type: "node:remove", payload: { deviceId, nodeId: 42 } },
    invalid: { type: "node:remove", payload: { deviceId } },
  },
  {
    name: "mqttToggleSchema",
    schema: mqttToggleSchema,
    valid: { type: "mqtt:toggle", payload: { enabled: false } },
    invalid: { type: "mqtt:toggle", payload: { enabled: 0 } },
  },
  {
    name: "requestDeviceConfigSchema",
    schema: requestDeviceConfigSchema,
    valid: { type: "device:config-request", payload: { deviceId } },
    invalid: { type: "device:config-request", payload: { deviceId: "not-a-uuid" } },
  },
  {
    name: "setDeviceConfigSchema",
    schema: setDeviceConfigSchema,
    valid: {
      type: "device:set-config",
      payload: { deviceId, namespace: "module", section: "mqtt", value: { enabled: true } },
    },
    invalid: {
      type: "device:set-config",
      payload: { deviceId, namespace: "invalid", section: "mqtt", value: {} },
    },
  },
] as const;

describe("client command schemas", () => {
  for (const { name, schema, valid, invalid } of commandCases) {
    describe(name, () => {
      it("accepts a valid payload", () => {
        expect(schema.safeParse(valid).success).toBe(true);
      });

      it("rejects an invalid payload", () => {
        expect(schema.safeParse(invalid).success).toBe(false);
      });
    });
  }

  it("accepts every valid command through the discriminated union", () => {
    for (const { valid } of commandCases) {
      expect(clientCommandSchema.safeParse(valid).success).toBe(true);
    }
  });

  it("accepts an optional clientMsgId on message:send", () => {
    expect(
      sendMessageSchema.safeParse({
        type: "message:send",
        payload: {
          deviceId,
          text: "hello",
          toNodeId: 42,
          channelIndex: 0,
          clientMsgId: "local-123",
        },
      }).success,
    ).toBe(true);
  });

  it("rejects an unknown command type", () => {
    expect(clientCommandSchema.safeParse({ type: "message:unknown", payload: {} }).success).toBe(
      false,
    );
  });

  it("rejects a known command type with a malformed payload", () => {
    expect(
      clientCommandSchema.safeParse({ type: "mqtt:toggle", payload: { enabled: "yes" } }).success,
    ).toBe(false);
  });
});

const device = {
  id: deviceId,
  name: "Test Radio",
  port: "/dev/ttyUSB0",
  status: "connected" as const,
  connectedAt: "2026-08-24T12:00:00.000Z",
  lastSeenAt: "2026-08-24T12:01:00.000Z",
  hardwareModel: "TBEAM",
  firmwareVersion: "2.6.0",
  batteryLevel: 90,
  hasGpsPosition: true,
  gpsDetail: {
    latitude: 47.6,
    longitude: -122.3,
    altitude: 100,
    satsInView: 8,
    fixType: 3,
    fixQuality: 1,
    pdop: 120,
    hdop: 80,
    locationSource: 2,
    gpsTimestamp: "2026-08-24T12:00:00.000Z",
  },
  ownNodeId: 1,
};

const node = {
  nodeId: 42,
  longName: "Test Node",
  shortName: "TEST",
  macAddress: "001122334455",
  hwModel: 1,
  publicKey: null,
  lastHeard: "2026-08-24T12:00:00.000Z",
  snr: 4.5,
  hopsAway: 1,
  latitude: 47.6,
  longitude: -122.3,
  altitude: 100,
};

const message = {
  id: "message-1",
  packetId: 100,
  fromNodeId: 42,
  toNodeId: 1,
  channelIndex: 0,
  text: "hello",
  rxTime: "2026-08-24T12:00:00.000Z",
  rxSnr: 4.5,
  rxRssi: -90,
  hopLimit: 3,
  wantAck: true,
  viaMqtt: false,
  role: "received" as const,
  ackStatus: null,
  ackAt: null,
  ackError: null,
  replyToPacketId: 0,
};

const packet = {
  id: "packet-1",
  packetId: 100,
  fromNodeId: 42,
  toNodeId: 1,
  channel: 0,
  portnum: 1,
  portnumName: "TEXT_MESSAGE_APP",
  rxTime: "2026-08-24T12:00:00.000Z",
  rxSnr: 4.5,
  rxRssi: -90,
  hopLimit: 3,
  hopStart: 3,
  wantAck: true,
  viaMqtt: false,
  payloadRaw: "aGVsbG8=",
  decodedJson: null,
};

const channel = { index: 0, name: "LongFast", role: 1, psk: null };
const waypoint = {
  id: 1,
  name: "Trailhead",
  description: null,
  latitude: 47.6,
  longitude: -122.3,
  icon: null,
  lockedTo: null,
  expire: null,
};
const mqttNode = {
  ...node,
  macAddress: undefined,
  lastGateway: "gateway-1",
  regionPath: "US/2",
  channelName: "LongFast",
  distanceM: 1200,
};
const activity = {
  id: 1,
  ts: "2026-08-24T12:00:00.000Z",
  source: "mesh" as const,
  portnum: "POSITION_APP",
  fromHex: "!0000002a",
  region: null,
  gateway: null,
  viaMqtt: false,
};
const log = {
  id: 1,
  ts: "2026-08-24T12:00:00.000Z",
  level: "log" as const,
  tag: "ws",
  text: "connected",
};
const config = {
  deviceId,
  radioConfig: { lora: { region: 1 } },
  moduleConfig: { mqtt: { enabled: false } },
  channels: [channel],
};

const serverEventFixtures = {
  "device:status": { type: "device:status", payload: device },
  "device:list": { type: "device:list", payload: [device] },
  "node:update": { type: "node:update", payload: node },
  "node:list": { type: "node:list", payload: [node] },
  "message:received": { type: "message:received", payload: message },
  "message:sent": { type: "message:sent", payload: { ...message, role: "sent" } },
  "message:history": { type: "message:history", payload: [message] },
  "message:ack": {
    type: "message:ack",
    payload: {
      messageId: "message-1",
      packetId: 100,
      status: "acked",
      ackAt: "2026-08-24T12:00:01.000Z",
      ackError: null,
    },
  },
  "message:send-failed": {
    type: "message:send-failed",
    payload: { clientMsgId: "local-123", deviceId, message: "radio unavailable" },
  },
  "packet:raw": { type: "packet:raw", payload: packet },
  "channel:list": { type: "channel:list", payload: [channel] },
  "waypoint:update": { type: "waypoint:update", payload: waypoint },
  "waypoint:list": { type: "waypoint:list", payload: [waypoint] },
  "mqtt_node:update": { type: "mqtt_node:update", payload: mqttNode },
  "mqtt_node:list": { type: "mqtt_node:list", payload: [mqttNode] },
  "traceroute:result": {
    type: "traceroute:result",
    payload: { deviceId, nodeId: 42, route: [10, 20], routeBack: [20, 10] },
  },
  "node:removed": { type: "node:removed", payload: { nodeId: 42 } },
  "activity:entry": { type: "activity:entry", payload: activity },
  "activity:snapshot": { type: "activity:snapshot", payload: [activity] },
  "log:entry": { type: "log:entry", payload: log },
  "log:snapshot": { type: "log:snapshot", payload: [log] },
  "mqtt:status": { type: "mqtt:status", payload: { enabled: true } },
  "device:config": { type: "device:config", payload: config },
  error: { type: "error", payload: { code: "INVALID_COMMAND", message: "Invalid command" } },
} satisfies Record<ServerEvent["type"], ServerEvent>;

describe("server event fixtures", () => {
  it("covers every current server event variant", () => {
    expect(Object.keys(serverEventFixtures)).toHaveLength(24);
  });
});
