# Project Definition

## Purpose

MeshtasticForeman is a self-hosted dashboard and API for Meshtastic mesh
networks. It runs as a Node.js daemon with a persistent serial connection to a
Meshtastic device, persists everything locally, and serves a React frontend
for exploring and operating the mesh — a self-hosted alternative to
`client.meshtastic.org`. It also acts as an MQTT gateway so nRF52-based
devices without built-in WiFi can appear on the public map.

## Users and stakeholders

* Mesh network operators who want a live map, node list, analytics, and
  messaging UI without depending on a hosted client.
* Operators running nRF52-based devices who need an MQTT gateway to reach the
  public map.
* Contributors extending the daemon, frontend, or MQTT gateway.

## Desired outcomes

* Reliable, auto-reconnecting serial connection to the device.
* Accurate persistence and presentation of devices, nodes, messages, packets,
  and analytics.
* A maintainable codebase where the device, database, MQTT, analytics, and
  WebSocket boundaries can each be changed with confidence — see
  `docs/ROADMAP.md` for the current maintainability and product roadmap.

## Scope

Included: the daemon (serial connection, MQTT gateway, REST API, WebSocket
event stream, PGlite persistence), the web frontend (Nodes, Map, Messages,
Analytics, Activity, Logs, Overrides, Device Config), and the Electron
packaging used for installers.

Excluded: hosting or operating a public MQTT broker or map service; firmware
development (owned by the upstream Meshtastic project).

## Constraints

* Must run cross-platform (Windows and Linux; installers are built for both).
* Depends on the upstream Meshtastic protocol/firmware and public MQTT
  infrastructure (`mqtt.meshtastic.org`) for gateway behavior.
* Uses PGlite (an embedded Postgres-compatible database) via a
  Windows-compatible worker-thread pattern — see `docs/ARCHITECTURE.md`.
* User-defined configuration lives in the root `.env` file (see `CLAUDE.md`).

## Domain language

* **Daemon** — the Node.js/Fastify backend in `packages/daemon` that owns the
  serial connection, MQTT gateway, database, REST API, and WebSocket stream.
* **Node** — a Meshtastic mesh participant discovered via packets, distinct
  from a **Device**, which is a locally connected Meshtastic radio.
* **MQTT gateway** — the daemon's re-encryption/publishing bridge that lets
  WiFi-less devices appear on the public Meshtastic map.
* **MAP_REPORT** — the periodic packet type the gateway publishes to announce
  node position on the public map.
