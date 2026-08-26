import type {
  ActivityEntry,
  DeviceConfig,
  DeviceInfo,
  LogEntry,
  MqttNode,
  NodeInfo,
  ServerEvent,
} from "@foreman/shared";

export interface AppState {
  devices: DeviceInfo[];
  nodes: NodeInfo[];
  mqttNodes: MqttNode[];
  activity: ActivityEntry[];
  logs: LogEntry[];
  mqttEnabled: boolean;
  deviceConfigs: Map<string, DeviceConfig>;
}

export const initialAppState: AppState = {
  devices: [],
  nodes: [],
  mqttNodes: [],
  activity: [],
  logs: [],
  mqttEnabled: false,
  deviceConfigs: new Map(),
};

export function appStateReducer(state: AppState, event: ServerEvent): AppState {
  switch (event.type) {
    case "device:list":
      return { ...state, devices: event.payload };
    case "device:status": {
      const exists = state.devices.some((device) => device.id === event.payload.id);
      const devices = exists
        ? state.devices.map((device) => (device.id === event.payload.id ? event.payload : device))
        : [...state.devices, event.payload];
      return { ...state, devices };
    }
    case "node:list":
      return { ...state, nodes: sortNodes(event.payload) };
    case "node:update": {
      const exists = state.nodes.some((node) => node.nodeId === event.payload.nodeId);
      const nodes = exists
        ? state.nodes.map((node) => (node.nodeId === event.payload.nodeId ? event.payload : node))
        : [...state.nodes, event.payload];
      return { ...state, nodes: sortNodes(nodes) };
    }
    case "mqtt_node:list":
      return { ...state, mqttNodes: sortMqttNodes(event.payload) };
    case "mqtt_node:update": {
      const exists = state.mqttNodes.some((node) => node.nodeId === event.payload.nodeId);
      const mqttNodes = exists
        ? state.mqttNodes.map((node) =>
            node.nodeId === event.payload.nodeId ? event.payload : node,
          )
        : [...state.mqttNodes, event.payload];
      return { ...state, mqttNodes: sortMqttNodes(mqttNodes) };
    }
    case "activity:snapshot":
      return { ...state, activity: event.payload };
    case "activity:entry": {
      const activity = [...state.activity, event.payload];
      return {
        ...state,
        activity: activity.length > 500 ? activity.slice(activity.length - 500) : activity,
      };
    }
    case "log:snapshot":
      return { ...state, logs: event.payload };
    case "log:entry": {
      const logs = [...state.logs, event.payload];
      return { ...state, logs: logs.length > 500 ? logs.slice(logs.length - 500) : logs };
    }
    case "mqtt:status":
      return { ...state, mqttEnabled: event.payload.enabled };
    case "device:config":
      return {
        ...state,
        deviceConfigs: new Map(state.deviceConfigs).set(event.payload.deviceId, event.payload),
      };
    case "error":
      console.error(`[ws] server error ${event.payload.code}: ${event.payload.message}`);
      return state;

    // These events are consumed by feature-specific stores/components or intentionally ignored here.
    case "message:received":
    case "message:sent":
    case "message:history":
    case "message:ack":
    case "message:send-failed":
    case "packet:raw":
    case "channel:list":
    case "waypoint:update":
    case "waypoint:list":
    case "traceroute:result":
    case "node:removed":
      return state;
    default:
      event satisfies never;
      return state;
  }
}

function sortMqttNodes(nodes: MqttNode[]): MqttNode[] {
  return [...nodes].sort((a, b) => {
    if (!a.lastHeard) return 1;
    if (!b.lastHeard) return -1;
    return new Date(b.lastHeard).getTime() - new Date(a.lastHeard).getTime();
  });
}

function sortNodes(nodes: NodeInfo[]): NodeInfo[] {
  return [...nodes].sort((a, b) => {
    if (!a.lastHeard) return 1;
    if (!b.lastHeard) return -1;
    return new Date(b.lastHeard).getTime() - new Date(a.lastHeard).getTime();
  });
}
