# MeshtasticForeman API Promises

> **What is this document?**
> An API promise is a contract: given valid input, the server commits to a specific output.
> This document covers every REST endpoint and WebSocket command in the daemon.
> It is the authoritative reference for frontend developers and contributors.
> *Note* - This is still alpha... these are not so much promises as intents at this point.

**Base URL (REST):** `http://localhost:<PORT>/api`  
**WebSocket:** `ws://localhost:<PORT>/ws`  
**Default Port:** `3750` (configurable via `.env`)  
**Auth:** None — all endpoints are currently public.

---

## Table of Contents

### REST — Device Management
- [GET /api/devices](#get-apidevices)
- [POST /api/devices/connect](#post-apidevicesconnect)
- [GET /api/devices/:id](#get-apidevicesid)
- [GET /api/devices/:id/nodes](#get-apidevicesidnodes)
- [GET /api/devices/:id/config](#get-apidevicesidconfig)
- [DELETE /api/devices/:id](#delete-apidevicesid)

### REST — Node Overrides
- [GET /api/node-overrides](#get-apinode-overrides)
- [PUT /api/node-overrides/:nodeId](#put-apinode-overridesnodeid)
- [DELETE /api/node-overrides/:nodeId](#delete-apinode-overridesnodeid)

### REST — MQTT Nodes
- [GET /api/mqtt-nodes](#get-apimqtt-nodes)

### REST — Hardware Models
- [GET /api/hw-models](#get-apihw-models)

### REST — Traceroutes
- [GET /api/traceroutes](#get-apitraceroutes)

### REST — Analytics
- [GET /api/analytics/snr-history](#get-apianalyticssnr-history)
- [GET /api/analytics/message-volume](#get-apianalyticsmessage-volume)
- [GET /api/analytics/message-delivery](#get-apianalyticsmessage-delivery)
- [GET /api/analytics/busiest-nodes](#get-apianalyticsbusiest-nodes)
- [GET /api/analytics/portnum-breakdown](#get-apianalyticsportnum-breakdown)
- [GET /api/analytics/packet-timeline](#get-apianalyticspacket-timeline)
- [GET /api/analytics/hop-distribution](#get-apianalyticshop-distribution)
- [GET /api/analytics/hardware-breakdown](#get-apianalyticshardware-breakdown)
- [GET /api/analytics/channel-utilization](#get-apianalyticschannel-utilization)
- [GET /api/analytics/message-latency](#get-apianalyticsmessage-latency)
- [GET /api/analytics/telemetry-history](#get-apianalyticstelemetry-history)
- [GET /api/analytics/link-quality](#get-apianalyticslink-quality)
- [GET /api/analytics/node-activity](#get-apianalyticsnode-activity)
- [GET /api/analytics/neighbor-graph](#get-apianalyticsneighbor-graph)
- [GET /api/analytics/position-history](#get-apianalyticsposition-history)

### WebSocket
- [Connection & Lifecycle](#websocket-connection--lifecycle)
- [Client → Server Commands](#client--server-commands)
  - [message:send](#messagesend)
  - [messages:request-history](#messagesrequest-history)
  - [packets:subscribe](#packetssubscribe)
  - [nodes:request-list](#nodesrequest-list)
  - [mqtt_nodes:request-list](#mqtt_nodesrequest-list)
  - [node:request-position](#noderequest-position)
  - [node:traceroute](#nodetraceroute)
  - [node:remove](#noderemove)
  - [mqtt:toggle](#mqtttoggle)
  - [device:config-request](#deviceconfig-request)
  - [device:set-config](#deviceset-config)
- [Server → Client Events](#server--client-events)

### Reference
- [Shared Types](#shared-types)
- [The `since` Query Parameter](#the-since-query-parameter)
- [Error Responses](#error-responses)
- [HTTP Status Codes](#http-status-codes)

---

## REST — Device Management

### GET /api/devices

Returns all currently connected devices.

**Parameters:** None

**Returns:** `200 OK`
```ts
DeviceInfo[]
```
```json
[
  {
    "id": "uuid",
    "name": "My Node",
    "port": "/dev/ttyUSB0",
    "status": "connected"
  }
]
```

**Errors:** None expected.

**Source:** [routes/devices.ts](packages/daemon/src/routes/devices.ts)

---

### POST /api/devices/connect

Connect to a Meshtastic device on a serial port.

**Request Body:** `application/json` — Zod validated
```ts
{
  port: string   // Serial port path, e.g. "/dev/ttyUSB0" or "COM3"
  name: string   // Human-readable label for this device
}
```

**Returns:** `200 OK`
```ts
DeviceInfo
```
```json
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "name": "Base Station",
  "port": "/dev/ttyUSB0",
  "status": "connected"
}
```

**Errors:**
| Status | Condition |
|--------|-----------|
| `400` | Missing or invalid `port` / `name` |
| `503` | Port already in use or device unreachable |

**Source:** [routes/devices.ts](packages/daemon/src/routes/devices.ts)

---

### GET /api/devices/:id

Returns a single connected device by its UUID.

**Path Parameters:**
| Param | Type | Description |
|-------|------|-------------|
| `id`  | UUID | Device identifier returned from connect |

**Returns:** `200 OK`
```ts
DeviceInfo
```

**Errors:**
| Status | Condition |
|--------|-----------|
| `404` | No device with that ID |

**Source:** [routes/devices.ts](packages/daemon/src/routes/devices.ts)

---

### GET /api/devices/:id/nodes

Returns all nodes seen by a specific device.

**Path Parameters:**
| Param | Type | Description |
|-------|------|-------------|
| `id`  | UUID | Device identifier |

**Returns:** `200 OK`
```ts
NodeInfo[]
```
```json
[
  {
    "nodeId": 123456789,
    "longName": "Alice",
    "shortName": "ALCE",
    "hwModel": 43,
    "snr": 8.25,
    "rssi": -82,
    "hopsAway": 1,
    "lastHeard": "2025-04-13T10:00:00Z",
    "latitude": 47.6062,
    "longitude": -122.3321,
    "altitude": 52
  }
]
```

**Errors:**
| Status | Condition |
|--------|-----------|
| `404` | No device with that ID |

**Source:** [routes/devices.ts](packages/daemon/src/routes/devices.ts)

---

### GET /api/devices/:id/config

Returns the full configuration snapshot for a device.

**Path Parameters:**
| Param | Type | Description |
|-------|------|-------------|
| `id`  | UUID | Device identifier |

**Returns:** `200 OK`
```ts
DeviceConfig
```
```json
{
  "radio": { ... },
  "module": { ... }
}
```

**Errors:**
| Status | Condition |
|--------|-----------|
| `404` | No device with that ID |

**Source:** [routes/devices.ts](packages/daemon/src/routes/devices.ts)

---

### DELETE /api/devices/:id

Disconnect and remove a device.

**Path Parameters:**
| Param | Type | Description |
|-------|------|-------------|
| `id`  | UUID | Device identifier |

**Returns:** `204 No Content`

**Errors:**
| Status | Condition |
|--------|-----------|
| `404` | No device with that ID |

**Source:** [routes/devices.ts](packages/daemon/src/routes/devices.ts)

---

## REST — Node Overrides

Node overrides are user-assigned metadata that supplement or override what a node broadcasts.

### GET /api/node-overrides

Returns all stored node overrides across all devices.

**Parameters:** None

**Returns:** `200 OK`
```ts
NodeOverride[]
```
```json
[
  {
    "nodeId": 123456789,
    "aliasName": "Hilltop Relay",
    "latitude": 47.6062,
    "longitude": -122.3321,
    "altitude": 120,
    "notes": "Installed 2025-03-10"
  }
]
```

**Source:** [routes/devices.ts](packages/daemon/src/routes/devices.ts)

---

### PUT /api/node-overrides/:nodeId

Create or update the override for a specific node. All body fields are optional — only supplied fields are updated (patch semantics).

**Path Parameters:**
| Param    | Type   | Description |
|----------|--------|-------------|
| `nodeId` | number | Meshtastic node number |

**Request Body:** `application/json` — all fields optional, Zod validated
```ts
{
  aliasName?: string   // Display name to show instead of broadcast name
  latitude?:  number   // Override GPS latitude (decimal degrees)
  longitude?: number   // Override GPS longitude (decimal degrees)
  altitude?:  number   // Override altitude (meters)
  notes?:     string   // Free-text notes about this node
}
```

**Returns:** `200 OK`
```ts
NodeOverride   // The full override record after update
```

**Errors:**
| Status | Condition |
|--------|-----------|
| `400` | Invalid body shape |

**Source:** [routes/devices.ts](packages/daemon/src/routes/devices.ts)

---

### DELETE /api/node-overrides/:nodeId

Remove an override, reverting to broadcast values.

**Path Parameters:**
| Param    | Type   | Description |
|----------|--------|-------------|
| `nodeId` | number | Meshtastic node number |

**Returns:** `204 No Content`

**Errors:**
| Status | Condition |
|--------|-----------|
| `404` | No override exists for that node |

**Source:** [routes/devices.ts](packages/daemon/src/routes/devices.ts)

---

## REST — MQTT Nodes

### GET /api/mqtt-nodes

Returns nodes received via the MQTT gateway (rather than direct serial connection).

**Parameters:** None

**Returns:** `200 OK`
```ts
MqttNode[]
```

**Source:** [routes/devices.ts](packages/daemon/src/routes/devices.ts)

---

## REST — Hardware Models

### GET /api/hw-models

Returns the list of known Meshtastic hardware model numbers and their human-readable names.

**Parameters:** None

**Returns:** `200 OK`
```ts
{ model_num: number; name: string }[]
```
```json
[
  { "model_num": 43, "name": "TLORA_V2_1_1P6" },
  { "model_num": 6,  "name": "TBEAM" }
]
```

**Source:** [routes/devices.ts](packages/daemon/src/routes/devices.ts)

---

## REST — Traceroutes

### GET /api/traceroutes

Returns recorded traceroute results, optionally filtered.

**Query Parameters:**
| Param      | Type   | Required | Description |
|------------|--------|----------|-------------|
| `since`    | string | No       | Time filter — see [The `since` parameter](#the-since-query-parameter) |
| `deviceId` | UUID   | No       | Filter to a single device |

**Returns:** `200 OK`
```ts
{
  id:          string
  deviceId:    string
  fromNodeId:  number
  toNodeId:    number
  route:       number[]   // Node IDs in forward path
  routeBack:   number[]   // Node IDs in return path
  recordedAt:  string     // ISO 8601
}[]
```

**Source:** [routes/devices.ts](packages/daemon/src/routes/devices.ts)

---

## REST — Analytics

All analytics endpoints share these conventions:
- **Method:** `GET`
- **Auth:** None
- **`since` param:** Accepts shorthand (`1h`, `6h`, `24h`, `7d`, `30d`, `all`) or ISO 8601 — see [The `since` parameter](#the-since-query-parameter)
- **`deviceId` param:** UUID — filter to a single device; omit for all devices

**Source file:** [routes/analytics.ts](packages/daemon/src/routes/analytics.ts)

---

### GET /api/analytics/snr-history

Signal quality over time, bucketed into 5-minute averages per node.

**Query Parameters:**
| Param      | Type   | Required | Description |
|------------|--------|----------|-------------|
| `since`    | string | No       | Time window |
| `nodeId`   | number | No       | Filter to one node |
| `deviceId` | UUID   | No       | Filter to one device |

**Returns:** `200 OK`
```ts
{
  ts:     string   // Bucket start (ISO 8601)
  nodeId: number
  snr:    number   // Average SNR (dB)
  rssi:   number   // Average RSSI (dBm)
  count:  number   // Packets in this bucket
}[]
```

---

### GET /api/analytics/message-volume

Message counts grouped by time bucket and direction (received / sent / relayed).

**Query Parameters:**
| Param      | Type             | Required | Description |
|------------|------------------|----------|-------------|
| `since`    | string           | No       | Time window |
| `bucket`   | `"hour"` \| `"day"` | No    | Aggregation granularity (default: `"hour"`) |
| `deviceId` | UUID             | No       | Filter to one device |

**Returns:** `200 OK`
```ts
{
  ts:      string   // Bucket start (ISO 8601)
  received: number
  sent:     number
  relayed:  number
  total:    number
}[]
```

---

### GET /api/analytics/message-delivery

Delivery success breakdown for messages that requested an ACK.

**Query Parameters:**
| Param      | Type   | Required | Description |
|------------|--------|----------|-------------|
| `since`    | string | No       | Time window |
| `deviceId` | UUID   | No       | Filter to one device |

**Returns:** `200 OK`
```ts
{
  acked:      number
  pending:    number
  error:      number
  total:      number
  errorTypes: { [errorCode: string]: number }
}
```

---

### GET /api/analytics/busiest-nodes

Top nodes by total message activity.

**Query Parameters:**
| Param      | Type   | Required | Description |
|------------|--------|----------|-------------|
| `since`    | string | No       | Time window |
| `limit`    | number | No       | Max nodes to return (1–100, default `20`) |
| `deviceId` | UUID   | No       | Filter to one device |

**Returns:** `200 OK`
```ts
{
  nodeId:   number
  received: number
  sent:     number
  relayed:  number
  total:    number
}[]
```

---

### GET /api/analytics/portnum-breakdown

Packet counts by Meshtastic application layer (PortNum).

**Query Parameters:**
| Param      | Type   | Required | Description |
|------------|--------|----------|-------------|
| `since`    | string | No       | Time window |
| `deviceId` | UUID   | No       | Filter to one device |

**Returns:** `200 OK`
```ts
{
  portnumName: string   // e.g. "TEXT_MESSAGE_APP", "TELEMETRY_APP"
  count:       number
}[]
```

---

### GET /api/analytics/packet-timeline

Stacked packet counts over time, broken down by PortNum.

**Query Parameters:**
| Param      | Type                   | Required | Description |
|------------|------------------------|----------|-------------|
| `since`    | string                 | No       | Time window |
| `bucket`   | `"minute"` \| `"hour"` | No       | Granularity (default: `"minute"`) |
| `deviceId` | UUID                   | No       | Filter to one device |

**Returns:** `200 OK`
```ts
{
  ts:     string                    // Bucket start (ISO 8601)
  counts: { [portnumName: string]: number }
  total:  number
}[]
```

---

### GET /api/analytics/hop-distribution

How many nodes are at each hop distance from the device.

**Query Parameters:**
| Param      | Type | Required | Description |
|------------|------|----------|-------------|
| `deviceId` | UUID | No       | Filter to one device |

**Returns:** `200 OK`
```ts
{
  hopsAway: number
  count:    number
}[]
```

---

### GET /api/analytics/hardware-breakdown

Nodes grouped by hardware model.

**Query Parameters:**
| Param      | Type | Required | Description |
|------------|------|----------|-------------|
| `deviceId` | UUID | No       | Filter to one device |

**Returns:** `200 OK`
```ts
{
  hwModel:     number
  hwModelName: string
  count:       number
}[]
```

---

### GET /api/analytics/channel-utilization

Message counts broken down by channel.

**Query Parameters:**
| Param      | Type   | Required | Description |
|------------|--------|----------|-------------|
| `since`    | string | No       | Time window |
| `deviceId` | UUID   | No       | Filter to one device |

**Returns:** `200 OK`
```ts
{
  channelIndex: number   // 0–7
  channelName:  string
  received:     number
  sent:         number
  relayed:      number
  total:        number
}[]
```

---

### GET /api/analytics/message-latency

ACK round-trip latency distribution for messages that requested acknowledgement.

**Query Parameters:**
| Param      | Type   | Required | Description |
|------------|--------|----------|-------------|
| `since`    | string | No       | Time window |
| `deviceId` | UUID   | No       | Filter to one device |

**Returns:** `200 OK`
```ts
{
  buckets: {
    label: string   // e.g. "< 1s", "1–5s", "> 30s"
    maxMs: number
    count: number
  }[]
  medianMs:     number
  p95Ms:        number
  totalSamples: number
}
```

---

### GET /api/analytics/telemetry-history

Device and environment telemetry, bucketed into 5-minute averages per node.

**Query Parameters:**
| Param      | Type   | Required | Description |
|------------|--------|----------|-------------|
| `since`    | string | No       | Time window |
| `nodeId`   | number | No       | Filter to one node |
| `deviceId` | UUID   | No       | Filter to one device |

**Returns:** `200 OK`
```ts
{
  ts:                   string   // Bucket start (ISO 8601)
  nodeId:               number
  variantCase:          string   // "deviceMetrics" | "environmentMetrics"
  batteryLevel:         number | null   // 0–100 %
  voltage:              number | null   // Volts
  channelUtilization:   number | null   // %
  airUtilTx:            number | null   // %
  uptimeSeconds:        number | null
  temperature:          number | null   // °C
  relativeHumidity:     number | null   // %
  barometricPressure:   number | null   // hPa
}[]
```

---

### GET /api/analytics/link-quality

Per-pair SNR matrix — useful for rendering a link quality heatmap.

**Query Parameters:**
| Param      | Type   | Required | Description |
|------------|--------|----------|-------------|
| `since`    | string | No       | Time window |
| `deviceId` | UUID   | No       | Filter to one device |

**Returns:** `200 OK`
```ts
{
  fromNodeId:   number
  toNodeId:     number
  avgSnr:       number   // dB
  messageCount: number
}[]
```

---

### GET /api/analytics/node-activity

Per-node message counts over time — suitable for a Gantt-style activity chart.

**Query Parameters:**
| Param      | Type             | Required | Description |
|------------|------------------|----------|-------------|
| `since`    | string           | No       | Time window |
| `bucket`   | `"hour"` \| `"day"` | No    | Granularity |
| `deviceId` | UUID             | No       | Filter to one device |

**Returns:** `200 OK`
```ts
{
  ts:     string   // Bucket start (ISO 8601)
  nodeId: number
  count:  number
}[]
```

---

### GET /api/analytics/neighbor-graph

Most recent heard-neighbor relationships between nodes (for graph visualizations).

**Query Parameters:**
| Param      | Type   | Required | Description |
|------------|--------|----------|-------------|
| `since`    | string | No       | Time window |
| `deviceId` | UUID   | No       | Filter to one device |

**Returns:** `200 OK`
```ts
{
  fromNodeId: number
  toNodeId:   number
  snr:        number   // Most recent SNR (dB)
  lastSeen:   string   // ISO 8601
}[]
```

---

### GET /api/analytics/position-history

GPS position fixes, newest first.

**Query Parameters:**
| Param      | Type   | Required | Description |
|------------|--------|----------|-------------|
| `since`    | string | No       | Time window |
| `nodeId`   | number | No       | Filter to one node |
| `deviceId` | UUID   | No       | Filter to one device |
| `limit`    | number | No       | Max rows (1–10000, default `2000`) |

**Returns:** `200 OK`
```ts
{
  id:          string
  nodeId:      number
  latitude:    number   // Decimal degrees
  longitude:   number   // Decimal degrees
  altitude:    number   // Meters
  speed:       number | null   // km/h
  groundTrack: number | null   // Degrees
  satsInView:  number | null
  recordedAt:  string   // ISO 8601
}[]
```

---

## WebSocket

### WebSocket Connection & Lifecycle

**Endpoint:** `ws://localhost:<PORT>/ws`

**On connection, the server immediately pushes:**
1. `device:list` — all connected devices
2. `node:list` — nodes for each device
3. `device:config` — config snapshot for each device
4. `mqtt_node:list` — all MQTT-sourced nodes
5. `mqtt:status` — MQTT gateway enabled/disabled
6. `activity:snapshot` — recent activity log
7. `log:snapshot` — recent console log

**All messages use this envelope:**
```ts
// Outbound (server → client)
{ type: string; payload: unknown }

// Inbound (client → server)
{ type: string; payload: unknown }
```

Messages are JSON strings. Validation failures return an `error` event.

---

## Client → Server Commands

All commands are Zod-validated on the server. Invalid payloads return:
```json
{ "type": "error", "payload": { "code": "VALIDATION_ERROR", "message": "..." } }
```

**Source:** [shared/src/ws-protocol.ts](packages/shared/src/ws-protocol.ts)

---

### message:send

Send a text message from the device to the mesh.

**Payload:**
```ts
{
  deviceId:     string   // UUID of the connected device
  text:         string   // 1–228 characters (Meshtastic packet limit)
  toNodeId:     number   // Destination node ID (0xFFFFFFFF = broadcast)
  channelIndex: number   // 0–7
  wantAck?:     boolean  // Default: true
}
```

**Server responds with:**
- `message:sent` event when the packet is queued
- `message:ack` event when acknowledgement is received (if `wantAck: true`)

---

### messages:request-history

Fetch paginated message history for a channel or DM thread.

**Payload:**
```ts
{
  deviceId:      string    // UUID
  channelIndex?: number    // Filter to one channel
  toNodeId?:     number    // Filter to DMs with one node
  limit?:        number    // 1–500 (default: 100)
  before?:       string    // ISO 8601 — return messages older than this cursor
}
```

**Server responds with:** `message:history` event

---

### packets:subscribe

Toggle raw packet streaming for this WebSocket client. Only subscribed clients receive `packet:raw` events.

**Payload:**
```ts
{
  deviceId: string    // UUID
  enabled:  boolean
}
```

**No direct response** — `packet:raw` events begin or stop flowing.

---

### nodes:request-list

Request a fresh node list for a device.

**Payload:**
```ts
{
  deviceId: string   // UUID
}
```

**Server responds with:** `node:list` event

---

### mqtt_nodes:request-list

Request the current list of MQTT-sourced nodes.

**Payload:** `{}`

**Server responds with:** `mqtt_node:list` event

---

### node:request-position

Trigger a position request to a specific node over the mesh.

**Payload:**
```ts
{
  deviceId: string   // UUID
  nodeId:   number   // Target node ID
}
```

**No direct response** — position update arrives as a `node:update` event when the node replies.

---

### node:traceroute

Initiate a traceroute to a specific node.

**Payload:**
```ts
{
  deviceId: string   // UUID
  nodeId:   number   // Target node ID
}
```

**Server responds with:** `traceroute:result` event when the route is discovered

---

### node:remove

Remove a node from the device's node database.

**Payload:**
```ts
{
  deviceId: string   // UUID
  nodeId:   number   // Node to remove
}
```

**Server responds with:** `node:removed` event broadcast to all clients

---

### mqtt:toggle

Enable or disable the MQTT gateway.

**Payload:**
```ts
{
  enabled: boolean
}
```

**Server responds with:** `mqtt:status` event broadcast to all clients

---

### device:config-request

Request the current configuration snapshot for a device.

**Payload:**
```ts
{
  deviceId: string   // UUID
}
```

**Server responds with:** `device:config` event

---

### device:set-config

Apply a configuration change to a device section.

**Payload:**
```ts
{
  deviceId:  string                      // UUID
  namespace: "radio" | "module"          // Config namespace
  section:   string                      // Section key within namespace
  value:     Record<string, unknown>     // Partial config values to apply
}
```

**No direct response** — changes are applied asynchronously. A `device:config` event is broadcast after the device confirms.

---

## Server → Client Events

The server pushes these events both in response to commands and proactively as the mesh state changes.

| Event Type          | Trigger                                      | Payload Type |
|---------------------|----------------------------------------------|--------------|
| `device:list`       | On connect; device added/removed             | `DeviceInfo[]` |
| `device:status`     | Device status change                         | `DeviceInfo` |
| `device:config`     | On connect; config requested or changed      | `DeviceConfig` |
| `node:list`         | On connect; `nodes:request-list` received    | `NodeInfo[]` |
| `node:update`       | Node heard / position received               | `NodeInfo` |
| `node:removed`      | `node:remove` command processed              | `{ nodeId: number }` |
| `message:received`  | Incoming mesh message                        | `Message` |
| `message:sent`      | `message:send` command queued               | `Message` |
| `message:history`   | `messages:request-history` processed         | `Message[]` |
| `message:ack`       | ACK or error received for a sent message     | `{ messageId, packetId, status, ackAt, ackError }` |
| `packet:raw`        | Any packet (subscribed clients only)         | `Packet` |
| `channel:list`      | On connect; channel update                   | `Channel[]` |
| `waypoint:list`     | On connect; waypoint update                  | `Waypoint[]` |
| `waypoint:update`   | Waypoint received or changed                 | `Waypoint` |
| `mqtt_node:list`    | On connect; `mqtt_nodes:request-list`        | `MqttNode[]` |
| `mqtt_node:update`  | MQTT node update received                    | `MqttNode` |
| `mqtt:status`       | On connect; `mqtt:toggle` processed          | `{ enabled: boolean }` |
| `traceroute:result` | Traceroute response received from mesh       | `{ deviceId, nodeId, route: number[], routeBack: number[] }` |
| `activity:snapshot` | On connect                                   | `ActivityEntry[]` |
| `activity:entry`    | Any loggable daemon event                    | `ActivityEntry` |
| `log:snapshot`      | On connect                                   | `LogEntry[]` |
| `log:entry`         | Console log line from daemon                 | `LogEntry` |
| `error`             | Validation failure or command error          | `{ code: string, message: string }` |

---

## Reference

### Shared Types

All types are defined in [shared/src/types.ts](packages/shared/src/types.ts) and [shared/src/ws-protocol.ts](packages/shared/src/ws-protocol.ts).

**`DeviceInfo`**
```ts
{
  id:     string   // UUID
  name:   string
  port:   string
  status: "connected" | "disconnected" | "error"
}
```

**`NodeInfo`**
```ts
{
  nodeId:    number
  longName:  string
  shortName: string
  hwModel:   number
  snr:       number
  rssi:      number
  hopsAway:  number
  lastHeard: string   // ISO 8601
  latitude?:  number
  longitude?: number
  altitude?:  number
}
```

**`NodeOverride`**
```ts
{
  nodeId:     number
  aliasName?: string
  latitude?:  number
  longitude?: number
  altitude?:  number
  notes?:     string
}
```

**`Message`**
```ts
{
  id:           string
  deviceId:     string
  fromNodeId:   number
  toNodeId:     number
  channelIndex: number
  text:         string
  rxSnr?:       number
  rxRssi?:      number
  hopLimit?:    number
  wantAck:      boolean
  ackStatus:    "pending" | "acked" | "error" | null
  ackError?:    string
  ackAt?:       string   // ISO 8601
  packetId?:    number
  receivedAt:   string   // ISO 8601
}
```

**`MqttNode`**
```ts
{
  nodeId:    number
  longName:  string
  shortName: string
  hwModel:   number
  lastHeard: string   // ISO 8601
}
```

**`ActivityEntry`**
```ts
{
  id:        string
  level:     "info" | "warn" | "error"
  message:   string
  timestamp: string   // ISO 8601
}
```

---

### The `since` Query Parameter

All analytics endpoints accept an optional `since` param that filters to records after a point in time.

| Value      | Meaning |
|------------|---------|
| `1h`       | Last 1 hour |
| `6h`       | Last 6 hours |
| `24h`      | Last 24 hours |
| `7d`       | Last 7 days |
| `30d`      | Last 30 days |
| `all`      | No time filter — all records |
| ISO 8601   | Custom start time, e.g. `2025-04-01T00:00:00Z` |

Omitting `since` uses a sensible server-side default (varies per endpoint).

**Implementation:** `parseSince()` helper in [routes/analytics.ts](packages/daemon/src/routes/analytics.ts)

---

### Error Responses

**REST validation errors** (Zod)
```json
{
  "error": {
    "fieldErrors": { "port": ["Required"] },
    "formErrors": []
  }
}
```

**REST runtime errors**
```json
{
  "error": "Device not found"
}
```

**WebSocket errors**
```json
{
  "type": "error",
  "payload": {
    "code": "VALIDATION_ERROR",
    "message": "Human-readable description"
  }
}
```

---

### HTTP Status Codes

| Code  | Meaning |
|-------|---------|
| `200` | Success with body |
| `204` | Success, no body (DELETE) |
| `400` | Bad request — invalid parameters or body |
| `404` | Resource not found |
| `503` | Service unavailable — device unreachable or DB not ready |
