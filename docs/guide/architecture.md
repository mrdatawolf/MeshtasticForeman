# Architecture

## How it fits together

```
Serial device (e.g. COM7)
      │
      ▼
┌──────────────────────┐
│  daemon              │  Node.js + Fastify
│  - DeviceManager     │  Owns serial connections, auto-reconnect
│  - MqttGateway       │  Forwards mesh traffic to MQTT broker
│  - PGlite (DB)       │  Persists devices, nodes, messages, packets
│  - REST API          │  /api/devices, /api/nodes, /api/messages, …
│  - WebSocket         │  /ws  (live event stream)
│  - Static file host  │  Serves the built frontend
└──────────────────────┘
         │                        │
         ▼                        ▼
  web frontend              mqtt.meshtastic.org
  (packages/web)            msh/US/CA/Humboldt/Eureka/2/e/...
```

## Packages

| Package | Description |
|---------|-------------|
| `packages/daemon` | Node.js backend — serial, MQTT, REST API, WebSocket, DB |
| `packages/web` | React frontend — Nodes, Map, Messages, Analytics, Config |
| `packages/shared` | Shared TypeScript types used by both |

## Data flow

1. The daemon opens a serial connection to the Meshtastic device and keeps it alive with auto-reconnect.
2. All incoming packets are decoded, stored in PGlite, and broadcast to connected WebSocket clients in real time.
3. The REST API exposes the stored data for analytics and configuration.
4. If `MQTT_BROKER` is set, the daemon also acts as a WiFi gateway — re-encrypting and publishing packets to the broker.

## MQTT gateway

The daemon acts as a WiFi gateway for nRF52-based Meshtastic devices that have no WiFi. When `MQTT_BROKER` is set in `.env` it:

- Subscribes to all mesh events via serial
- Re-encrypts decoded packets with the channel PSK (AES-128-CTR)
- Publishes `ServiceEnvelope` protobufs to `{root}/2/e/{channel}/{!gatewayId}`
- Publishes `MAP_REPORT_APP` to `{root}/2/map/`
- Re-announces the node (NODEINFO + POSITION + MAP_REPORT) every 15 minutes

## API

The daemon exposes a REST + WebSocket API on `API_PORT`. See [API_PROMISES.md](../API_PROMISES.md) for the full contract.
