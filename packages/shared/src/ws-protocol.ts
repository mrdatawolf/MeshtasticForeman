import { z } from "zod";

import type {
  DeviceInfo,
  NodeInfo,
  MqttNode,
  Message,
  Packet,
  Channel,
  Waypoint,
  ActivityEntry,
  LogEntry,
  DeviceConfig,
} from "./types.js";

// ---------------------------------------------------------------------------
// Server → Client events
// ---------------------------------------------------------------------------

export type ServerEvent =
  | { type: "device:status"; payload: DeviceInfo }
  | { type: "device:list"; payload: DeviceInfo[] }
  | { type: "node:update"; payload: NodeInfo }
  | { type: "node:list"; payload: NodeInfo[] }
  | { type: "message:received"; payload: Message }
  | { type: "message:sent"; payload: Message }
  | { type: "message:history"; payload: Message[] }
  | {
      type: "message:ack";
      payload: {
        messageId: string;
        packetId: number;
        status: "acked" | "error";
        ackAt: string;
        ackError: string | null;
      };
    }
  | {
      type: "message:send-failed";
      payload: { clientMsgId: string | null; deviceId: string; message: string };
    }
  | { type: "packet:raw"; payload: Packet }
  | { type: "channel:list"; payload: Channel[] }
  | { type: "waypoint:update"; payload: Waypoint }
  | { type: "waypoint:list"; payload: Waypoint[] }
  | { type: "mqtt_node:update"; payload: MqttNode }
  | { type: "mqtt_node:list"; payload: MqttNode[] }
  | {
      type: "traceroute:result";
      payload: { deviceId: string; nodeId: number; route: number[]; routeBack: number[] };
    }
  | { type: "node:removed"; payload: { nodeId: number } }
  | { type: "activity:entry"; payload: ActivityEntry }
  | { type: "activity:snapshot"; payload: ActivityEntry[] }
  | { type: "log:entry"; payload: LogEntry }
  | { type: "log:snapshot"; payload: LogEntry[] }
  | { type: "mqtt:status"; payload: { enabled: boolean } }
  | { type: "device:config"; payload: DeviceConfig }
  | { type: "error"; payload: { code: string; message: string } };

// ---------------------------------------------------------------------------
// Client → Server commands
// ---------------------------------------------------------------------------

export const sendMessageSchema = z.object({
  type: z.literal("message:send"),
  payload: z.object({
    deviceId: z.string().uuid(),
    text: z.string().min(1).max(228),
    toNodeId: z.number().int(),
    channelIndex: z.number().int().min(0).max(7),
    wantAck: z.boolean().default(true),
    clientMsgId: z.string().min(1).optional(),
  }),
});

export const subscribePacketsSchema = z.object({
  type: z.literal("packets:subscribe"),
  payload: z.object({
    deviceId: z.string().uuid(),
    enabled: z.boolean(),
  }),
});

export const requestHistorySchema = z.object({
  type: z.literal("messages:request-history"),
  payload: z.object({
    deviceId: z.string().uuid(),
    channelIndex: z.number().int().optional(),
    toNodeId: z.number().int().optional(),
    limit: z.number().int().min(1).max(500).default(100),
    before: z.string().datetime().optional(),
  }),
});

export const requestNodeListSchema = z.object({
  type: z.literal("nodes:request-list"),
  payload: z.object({
    deviceId: z.string().uuid(),
  }),
});

export const requestMqttNodeListSchema = z.object({
  type: z.literal("mqtt_nodes:request-list"),
  payload: z.object({}),
});

export const requestPositionSchema = z.object({
  type: z.literal("node:request-position"),
  payload: z.object({
    deviceId: z.string().uuid(),
    nodeId: z.number().int(),
  }),
});

export const requestTracerouteSchema = z.object({
  type: z.literal("node:traceroute"),
  payload: z.object({
    deviceId: z.string().uuid(),
    nodeId: z.number().int(),
  }),
});

export const removeNodeSchema = z.object({
  type: z.literal("node:remove"),
  payload: z.object({
    deviceId: z.string().uuid(),
    nodeId: z.number().int(),
  }),
});

export const mqttToggleSchema = z.object({
  type: z.literal("mqtt:toggle"),
  payload: z.object({ enabled: z.boolean() }),
});

export const requestDeviceConfigSchema = z.object({
  type: z.literal("device:config-request"),
  payload: z.object({ deviceId: z.string().uuid() }),
});

export const setDeviceConfigSchema = z.object({
  type: z.literal("device:set-config"),
  payload: z.object({
    deviceId: z.string().uuid(),
    /** "radio" | "module" */
    namespace: z.enum(["radio", "module"]),
    /** section key, e.g. "mqtt", "lora", "device" */
    section: z.string().min(1),
    /** plain-object fields to merge into the section */
    value: z.record(z.unknown()),
  }),
});

export const clientCommandSchema = z.discriminatedUnion("type", [
  sendMessageSchema,
  subscribePacketsSchema,
  requestHistorySchema,
  requestNodeListSchema,
  requestMqttNodeListSchema,
  requestPositionSchema,
  requestTracerouteSchema,
  removeNodeSchema,
  mqttToggleSchema,
  requestDeviceConfigSchema,
  setDeviceConfigSchema,
]);

export type ClientCommand = z.infer<typeof clientCommandSchema>;
