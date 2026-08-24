# Roadmap

This roadmap is a suggested sequence of improvements, not a commitment to a
particular release schedule. The stages are ordered to put safety checks in
place before larger refactors begin. Each stage should be deliverable on its
own, with the application remaining usable between stages.

## Working now

- [x] Serial connection to Meshtastic devices with automatic reconnect
- [x] MQTT gateway with encrypted packet forwarding and MAP_REPORT publishing
- [x] Device auto-connect from `MESHTASTIC_PORT` on daemon startup
- [x] PGlite persistence using a Windows-compatible worker-thread pattern
- [x] REST API for devices, nodes, overrides, messages, configuration, and MQTT nodes
- [x] WebSocket event stream at `/ws`
- [x] Hardware model name synchronization
- [x] Web frontend for Nodes, Map, Messages, Analytics, Activity, Logs, Overrides, and Device Config
- [x] First-run introduction and setup wizard prompt

## Maintainability roadmap

### Stage 1: Establish automated guardrails

**Goal:** Make the current behavior easier to preserve while later stages move
code around.

- [ ] Add a pull-request CI workflow for the complete application.
  - Install dependencies with the pnpm version declared in `package.json`,
    preferably through Corepack.
  - Run formatting checks, linting, TypeScript builds, and tests.
  - Keep the documentation deployment workflow separate from application CI.
- [ ] Replace the placeholder lint scripts with a shared ESLint configuration.
  - Use TypeScript ESLint, the React Hooks rules, unused-import checks, and
    consistent import ordering.
  - Start noisy rules as warnings, fix the existing baseline, and promote the
    important rules to errors afterward.
  - Review existing `react-hooks/exhaustive-deps` suppressions individually;
    do not remove them mechanically.
- [ ] Add Prettier and `format`/`format:check` scripts at the workspace root.
- [ ] Add a shared base TypeScript configuration and extend it from the daemon,
  web, and shared packages.
- [ ] Align version metadata.
  - The root, daemon, web, and shared package should have one
    clear source of truth.
  - Since workspace packages are private, another option is to remove package
    versions where they are not required.
- [ ] Document the supported Node.js and pnpm versions in the setup guide.

**Suggested completion criteria:** A clean checkout has one documented command
that installs dependencies and one CI-equivalent command that passes locally.
Pull requests cannot merge with type, lint, test, or formatting failures.

### Stage 2: Test the critical boundaries

**Goal:** Cover the behavior most likely to break during cleanup.

- [ ] Add tests for every analytics endpoint.
  - Cover query validation, time and device filters, empty results, limits, and
    conversion of database rows to API response objects.
- [ ] Test database migrations from an empty database and from representative
  older schema versions.
  - Verify that migrations are transactional and idempotent.
- [ ] Add MQTT gateway tests for topic parsing, PSK expansion,
  encryption/decryption, inbound packet normalization, and malformed input.
- [ ] Add tests for the shared WebSocket command schemas and important server
  event payloads.
- [ ] Add web tests for the WebSocket reconnect lifecycle and event-driven state
  updates.
- [ ] Extract and test pure frontend behavior such as node override merging,
  map coverage calculations, coordinate helpers, configuration merging, and
  setup-wizard output.

Prefer behavior-focused tests over snapshots of large rendered components.
Small pure functions and API handlers should be tested directly; a limited
number of integration tests can then verify that the pieces are wired together.

**Suggested completion criteria:** The device, database, MQTT, analytics, and
WebSocket boundaries have regression coverage, and CI publishes an easily read
test result when one fails.

### Stage 3: Consolidate duplicated infrastructure

**Goal:** Create one implementation for cross-cutting behavior that currently
has multiple or inconsistent implementations.

- [ ] Remove the duplicate PGlite worker proxy from `db/client.ts` and
  `db/open.ts`.
  - Keep the worker lifecycle, request queue, transaction handling, and error
    propagation in `open.ts` or a dedicated `pglite-proxy.ts`.
  - Make `client.ts` only create and export the daemon's singleton database.
  - Add tests before changing this code because it controls all persistence.
- [ ] Introduce a typed frontend HTTP client under `packages/web/src/api/`.
  - Give devices, analytics, coverage, proposals, overrides, and configuration
    small feature-specific modules.
  - Check `response.ok` consistently, decode structured errors, encode query
    parameters, support `AbortSignal`, and handle empty responses.
  - Replace direct `fetch()` calls feature by feature rather than all at once.
- [ ] Add a daemon configuration module.
  - Read and validate environment variables once at startup, ideally with Zod.
  - Pass a typed configuration object into services instead of reading
    `process.env` throughout the application.
- [ ] Generate `docs/api/index.md` from `API_PROMISES.md`, or choose one as the
  canonical source and link to it. They should not be maintained as two copies.
- [ ] Centralize shared formatting and domain utilities, such as node IDs,
  relative times, node names, and modem-preset mappings.

**Suggested completion criteria:** Database access, HTTP error handling,
configuration loading, API documentation, and common domain formatting each
have one obvious implementation.

### Stage 4: Simplify frontend state and component boundaries

**Goal:** Reduce the amount of application behavior concentrated in very large
React components.

- [ ] Move daemon-derived state out of `App.tsx`.
  - Use a reducer or a small dedicated store for devices, mesh nodes, MQTT
    nodes, activity, logs, configuration, and WebSocket events.
  - Make event handling exhaustive so a new `ServerEvent` produces a compiler
    error until it is handled or deliberately ignored.
  - Keep transient UI state, such as the selected tab or an open menu, close to
    the component that renders it.
- [ ] Split the application shell into focused components.
  - Suggested components include `AppShell`, `MainNavigation`, `DeviceMenu`,
    `GpsMenu`, `MqttMenu`, and `SettingsMenu`.
  - Replace the repeated outside-click effects with a tested
    `useClickOutside` hook.
- [ ] Split `MapPage.tsx` by responsibility.
  - Keep orchestration in `MapPage` and extract the map canvas, layer builders,
    controls, node popups, proposal editor, terrain API, and coverage math.
  - Keep GeoJSON and coverage calculations in framework-independent modules so
    they can be unit tested.
- [ ] Split `AnalyticsPage.tsx` into one module per analytics tab plus shared
  chart components.
  - Introduce a small query hook, or a focused query library, for loading,
    cancellation, refresh, and error states.
  - Group related requests at the tab level instead of maintaining many nearly
    identical effects.
- [ ] Split `DeviceConfigPage.tsx` into the setup wizard, configuration cards,
  field editors, and pure configuration transformation functions.
- [ ] Move large inline style collections and dynamically inserted style rules
  into feature-level CSS modules or stylesheets.

Avoid arbitrary file-size limits. The useful boundary is one clear reason for
a module to change, not a specific line count.

**Suggested completion criteria:** `App.tsx` primarily composes the shell and
routes; each major page coordinates smaller feature components; pure map,
analytics, and configuration logic can run without React.

### Stage 5: Separate daemon services and validate inputs

**Goal:** Make backend behavior easier to understand and change without
affecting unrelated device, MQTT, or analytics behavior.

- [ ] Reduce `DeviceManager` to connection and lifecycle coordination.
  - Extract message handling, node updates, raw packet persistence,
    configuration, telemetry, bot commands, and traceroutes into services or
    handlers.
  - Pass dependencies explicitly so handlers can be tested without a physical
    radio.
- [ ] Split `MqttGateway` into transport, codec, topic parsing, inbound packet
  handling, publishing, and node persistence responsibilities.
- [ ] Narrow the Meshtastic `any` boundary.
  - Accept `unknown` at the third-party event boundary.
  - Normalize or validate payloads in a Meshtastic adapter layer.
  - Pass repository-owned typed objects to the rest of the daemon.
- [ ] Split the analytics route file by domain.
  - Suggested groups are signal, messages, network, telemetry, packets, and
    positions.
  - Keep SQL/query functions separate from Fastify request handling so they can
    be tested directly.
- [ ] Add Fastify/Zod schemas for REST query strings, parameters, bodies, and
  important responses.
  - Reuse shared schemas where they genuinely describe the same public contract.
  - Let validation provide consistent defaults and error responses instead of
    manually casting `req.query` in every route.
- [ ] Introduce repository modules where database row mapping is repeated.
  Raw SQL can remain; the aim is to centralize column naming and conversion to
  domain types, not to add a heavyweight ORM.

**Suggested completion criteria:** Device lifecycle, protocol adaptation,
packet handling, MQTT transport, persistence, and API delivery can be changed
and tested independently.

### Stage 6: Operational resilience and ongoing maintenance

**Goal:** Make normal failure, shutdown, and future growth predictable.

- [ ] Add coordinated graceful shutdown for Fastify, WebSockets, MQTT, serial
  devices, background timers, worker threads, and PGlite.
- [ ] Replace broad process-level exception suppression with errors handled as
  close as possible to the serial transport boundary.
- [ ] Standardize structured logging and attach useful context such as device
  ID, packet ID, operation, and error cause.
- [ ] Add retention or pruning policies for packet, message, activity,
  telemetry, and cache data.
- [ ] Add lightweight health and readiness endpoints covering the HTTP server,
  database worker, and optional external integrations.
- [ ] Record architectural decisions for major choices such as PGlite worker
  usage, WebSocket state ownership, MQTT bridging, and multi-device support.
- [ ] Review dependencies and supported runtime versions on a regular schedule.

**Suggested completion criteria:** The daemon starts, reconnects, and shuts down
without stale resources; operators can distinguish healthy, degraded, and
failed states; maintenance decisions are documented near the codebase.

## Product roadmap

These product ideas can proceed alongside the maintainability stages, but large
features should include tests and follow the boundaries introduced above.

### In progress or exploring

- [ ] **Message delivery confirmation** — combine MQTT data with the message
  system to create a back-channel for verifying receipt.
- [ ] **Cross-mesh relay** — when a recipient is out of direct range, use MQTT
  to hand the message off to another relay node that can reach it.
- [ ] **Traceroute visualization** — display traceroute paths on the map.
- [ ] **Ping data** — surface device ping and latency information in the UI.
- [ ] **Node list improvements** — improve organization and presentation of
  node data.
- [ ] **Message system stability** — continue hardening message persistence,
  acknowledgment, retry, and reconnect behavior.
- [ ] **Multi-device MQTT messages** — use private channel keys to decrypt
  messages from other devices through MQTT.
- [ ] **Multiple devices per daemon** — support more than one connected device
  without mixing per-device state.

### Longer-term ideas

- [ ] **Terrain-aware coverage prediction, phase 2** — use locally cached SRTM
  elevation data or a carefully managed elevation provider to calculate
  realistic line-of-sight coverage.
- [ ] **Scalable topology graph** — use a force-directed graph implementation
  that remains readable and responsive on larger meshes.
- [ ] **Long-term telemetry storage** — first measure PGlite retention and query
  performance, then evaluate pruning, rollups, or a time-series database if the
  measured workload requires one.

## How to use this roadmap

- Prefer small pull requests that complete one checkbox or a closely related
  group of checkboxes.
- Add characterization tests before refactoring behavior that is not already
  covered.
- Keep moves and behavior changes in separate commits when practical.
- Update this document when priorities or constraints change; stages may overlap
  when work is independent.
- Open an issue for substantial features or architectural changes before
  implementation so the intended behavior and migration path are clear.
