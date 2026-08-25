# CONTRACT-004: DeviceManager Extraction Boundaries

Status: Proposed
Approved by:
Approved date:
Related tasks: TASK-024 (blocked on TASK-023, approved but not yet
implemented — see Open questions)

## Purpose

`packages/daemon/src/device/device-manager.ts` is currently 1408 lines (`wc
-l`, re-verified against the file at draft time — TASK-024's own "1332
lines"/"1408 lines" figures had already drifted from each other before this
contract was written, which is itself evidence of how fast this file moves
and why line citations below should be re-checked at implementation time
rather than trusted blindly). It is the daemon's single point of contact with
physical Meshtastic radios: connection lifecycle, message receipt, node/telemetry
tracking, raw packet persistence, configuration read/write, bot commands, and
traceroutes are all currently implemented as private methods on one
`EventEmitter` subclass. TASK-024 extracts everything except connection and
lifecycle coordination into separate handler modules with explicit
dependency injection.

This is a "pin down existing behavior so a structural extraction can't
silently drift" contract, in the same spirit as CONTRACT-001 and CONTRACT-012.
It is not a redesign. It records what `DeviceManager` actually does today —
its public surface, its emitted events, and the private handlers being
extracted — as the baseline TASK-024's extraction must be judged against.
Where `device-manager.test.ts` already characterizes a behavior with a
passing assertion, that test is treated as authoritative, matching the
convention CONTRACT-001 and CONTRACT-012 established. Where no test exists
today, this contract says so explicitly rather than inventing coverage that
isn't there — TASK-024's own plan already calls for extending coverage before
extracting an under-tested area.

## Scope

### Included

- `DeviceManager`'s public API surface (constructor, public methods) as it
  exists today — this is the "must not change" surface post-extraction.
- The exact set of `ServerEvent` names and payload shapes `DeviceManager`
  emits via `this.emit("event", ...)`, and which code path emits each one.
- Every private handler in scope for extraction per TASK-024: `_handleMessage`,
  `_handleBotCommand`, `_handleNodeInfo`, `_handleTelemetry`,
  `_handleRawPacket` (raw-packet persistence), `_handleConfigPacket` /
  `_handleModuleConfigPacket` / `_handleChannelPacket` /
  `applyConfigSection` (configuration handling), and the traceroute path
  (`onTraceRoutePacket` subscription + `_saveTraceroute`) — their current
  file:line locations, inputs, side effects (DB writes, emitted events), and
  ordering dependencies on each other.
- The two invariants TASK-024 names as the most fragile thing extraction
  could silently break: the packetId→replyId correlation between
  `_handleRawPacket`/`_handleMessage`/`_handleBotCommand`, and the
  `onMeshPacket`-before-`onMessagePacket` ordering dependency it relies on.
  Both are stated below as explicit, testable requirements.
- `device-manager.test.ts`'s current coverage, area by area, so the human and
  implementer can see exactly which of the seven extraction areas are
  characterized by an executable test today and which are not.

### Excluded

- Any change to observable device behavior, event payloads, persisted data
  shape, or the packetId/replyId correlation itself — TASK-024's own scope
  explicitly excludes this, and this contract does not introduce any.
- Redesigning how handlers should be structured internally (e.g., class vs.
  function, specific file layout beyond "separate modules with explicit
  dependency injection," dependency-injection container vs. plain
  constructor arguments). TASK-024 leaves these as implementer discretion;
  this contract does not narrow that discretion beyond what's needed to keep
  the invariants below intact.
- TASK-023's own scope (narrowing `any` types on the `@meshtastic/core` event
  boundary). TASK-024 depends on TASK-023's typed output but this contract
  does not restate or govern TASK-023's behavior.
- The MQTT gateway's own internal behavior (`MqttGateway`) — only its two
  call sites from `DeviceManager` (`attachDevice`/`detachDevice`, and the
  `gps:position` listener registered in `setMqttGateway`) are in scope, as
  context for what the connection/lifecycle-coordination role that remains in
  `DeviceManager` must keep calling.
- Watchdog/reconnect/backoff behavior (`_startPacketWatchdog`,
  `_scheduleReconnect`, `_handleDeviceStatus`) — these are lifecycle
  coordination, explicitly what TASK-024 says `DeviceManager` *keeps*, not
  what it extracts. Named here only as adjacent context, not restated in
  detail as this contract's subject.

## Actors

- **Physical Meshtastic radio / `MeshDevice` (from `@meshtastic/core`)**: the
  counterparty `DeviceManager.connect()` opens a serial (`TransportNodeSerial`)
  connection to, and whose event stream (`meshDevice.events.on*`) drives every
  handler in scope.
- **`DeviceManager`**: today, owns both lifecycle coordination and all
  extracted-area logic. After TASK-024, owns only lifecycle coordination and
  delegates to the extracted handlers.
- **Extracted handler modules** (post-TASK-024, not yet existing): receive
  `db: PGlite`, an event-emission dependency, and `config` (at minimum the
  `bot` slice) explicitly, rather than reaching into `DeviceManager`
  internals — per TASK-024's stated acceptance criterion.
- **`MqttGateway`**: attached via `setMqttGateway()`; emits `gps:position`
  events `DeviceManager` listens to; is attached/detached per device via
  `attachDevice`/`detachDevice`, called from `connect()`/`disconnect()`/
  `_handleDeviceStatus()`.
- **Callers of `DeviceManager`'s public API**: `packages/daemon/src/index.ts`
  (constructs it, calls `setMqttGateway`, `connect`, `reconnectSaved`),
  `packages/daemon/src/routes/websocket.ts` (subscribes to `"event"`, calls
  `listDevices`, `getDevice`, `getBatteryLevel`, `hasGpsPosition`,
  `getGpsDetail`, `getMyNodeId`, `listNodes`, `getDeviceConfig`,
  `refreshGpsPosition`, `applyConfigSection`, `getMessageHistory`), and
  `packages/daemon/src/routes/devices.ts` (`listDevices`, `connect`,
  `listNodes`, `getDeviceConfig`, `disconnect`, `deleteConversation`). None of
  these call sites may need to change as a result of TASK-024.
- **Human operator**: indirectly, via the frontend, experiences the
  device-status/message/node/telemetry/config/traceroute events these
  handlers produce.

## Inputs and outputs

### Public API surface (must not change — `device-manager.ts:45–486`)

```ts
class DeviceManager extends EventEmitter {
  constructor(db: PGlite, config: Pick<DaemonConfig, "bot">);

  setMqttGateway(gateway: MqttGateway): void;
  reconnectSaved(): Promise<void>;
  listDevices(): Promise<Array<{
    id: string; name: string; port: string;
    hw_model: string | null; firmware: string | null; last_seen: string | null;
  }>>;
  connect(port: string, name: string, existingId?: string): Promise<ConnectedDevice>;
  disconnect(deviceId: string): Promise<void>;
  getDevice(id: string): ConnectedDevice | undefined;
  getBatteryLevel(id: string): number | null;
  hasGpsPosition(id: string): boolean;
  getGpsDetail(id: string): GpsDetail | null;
  refreshGpsPosition(deviceId: string): void;
  getMyNodeId(deviceId: string): number | undefined;
  listNodes(deviceId: string): Promise<NodeInfo[]>;
  getMessageHistory(deviceId: string, opts: {
    channelIndex?: number; toNodeId?: number; limit: number; before?: string;
  }): Promise<Message[]>;
  deleteConversation(deviceId: string, nodeId: number): Promise<void>;
  getDeviceConfig(deviceId: string): Promise<DeviceConfig | null>;
  applyConfigSection(
    deviceId: string,
    namespace: "radio" | "module",
    section: string,
    value: Record<string, unknown>,
  ): Promise<void>;
}
```

`ConnectedDevice` (`device-manager.ts:25–32`): `{ id, port, name, connectedAt,
meshDevice, transport }` — exported today and consumed by
`device-manager.test.ts` and route handlers; its shape must not change.

### Emitted `"event"` payloads and their sources (must not change)

| `ServerEvent.type` | Emitted from | Current location |
|---|---|---|
| `device:status` | `_emitStatus`, called from `connect`, `disconnect`, `_handleDeviceStatus`, `_scheduleReconnect` (failure path), `setMqttGateway`'s `gps:position` listener, `refreshGpsPosition`, `_handleMetadata`, `_handleTelemetry` | `device-manager.ts:531–556`, call sites at `84`, `309`, `341`, `365`, `587`, `618` |
| `message:received` | `_handleMessage` (received), `_handleBotCommand` (bot reply, `role: "sent"`) | `device-manager.ts:641–695`, `697–792` |
| `packet:raw` | `_handleRawPacket` | `device-manager.ts:795–1033` |
| `node:update` | `_handleRawPacket` (per-packet last-heard refresh), `_handleNodeInfo`, `_handlePosition` | `device-manager.ts:857–895`, `1036–1116`, `1119–1186` |
| `message:ack` | `_handleRawPacket`'s ROUTING_APP branch | `device-manager.ts:950–994` |
| `traceroute:result` | `onTraceRoutePacket` subscription (inline in `connect()`, not a named private method) | `device-manager.ts:223–240` |
| `device:config` | `_emitDeviceConfig`, called from `connect()` (post-configure) and `applyConfigSection` | `device-manager.ts:1314–1319`, call sites at `314`, `1311` |

`node:update`, `packet:raw`, and `device:status` are each emitted from more
than one code path today; TASK-024 must preserve every one of these emission
sites and their exact payload construction, even after the logic that
produces them moves into a different module.

## Preconditions

- A handler receiving `deviceId` from a `meshDevice.events.on*` subscription
  can assume `DeviceManager.devices` (or, post-extraction, whatever holds the
  live connection map) already contains that device — the subscription is
  registered synchronously inside `connect()` before `meshDevice.configure()`
  resolves (`device-manager.ts:157–284` register, `291` configure).
- `_handleBotCommand` assumes the connected device is still present
  (`device-manager.ts:701–702`, returns silently if not) and that
  `this.config.bot.enabled` was already checked by its caller
  (`_handleMessage`, `device-manager.ts:690`) — `_handleBotCommand` itself
  does not re-check `config.bot.enabled`.
- `applyConfigSection` assumes the device is connected; it throws
  synchronously (`Error("Device ${deviceId} not connected")`,
  `device-manager.ts:1280`) rather than silently no-op-ing, unlike most other
  handlers below.
- `_handleTelemetry`'s battery-level update assumes `myNodeIds` has already
  been populated for the device via `onMyNodeInfo` (`device-manager.ts:271–277`)
  — if `fromNodeId !== myNodeId` (including the case where `myNodeId` is
  still `undefined`), the telemetry packet is treated as being about a peer,
  not this device, and no state changes (`device-manager.ts:1367–1371`).

## Required behavior

### Handler-by-handler baseline

**`_handleMessage(deviceId, packet)`** (`device-manager.ts:641–695`, extracted
into a message handler)
- Generates a new `id` (`randomUUID()`), reads `packet.rxTime.toISOString()`.
- Looks up `replyToPacketId` from `pendingReplyIds` keyed by `packet.id`, then
  **deletes** that map entry (`device-manager.ts:644–645`) — a one-shot
  consume, not a peek.
- Inserts into `messages` with `role: 'received'`, `ON CONFLICT(id) DO
  NOTHING` (idempotent against a duplicate `id`, which cannot realistically
  collide given `randomUUID()`, but is existing behavior to preserve).
- Updates `devices.last_seen` to the message's `rxTime`.
- Emits `message:received` with `role: "received"`, `ackStatus: null`,
  `wantAck: false` literal, `viaMqtt: false` literal, `rxSnr`/`rxRssi`/
  `hopLimit` literal `null` — none of these are read from `packet` even
  though `packet` is `Types.PacketMetadata<string>`, not from the richer raw
  packet; this is existing behavior (the richer fields come from
  `_handleRawPacket`'s separate `packet:raw` event instead), not something to
  "fix" during extraction.
- If `config.bot.enabled` is true AND `packet.data?.startsWith("!")`, calls
  `_handleBotCommand(deviceId, packet)` and swallows/logs any rejection
  (`device-manager.ts:690–694`) — a bot-command failure must never reject or
  throw out of `_handleMessage`'s own caller.

**`_handleBotCommand(deviceId, packet)`** (`device-manager.ts:697–792`,
extracted alongside `_handleMessage` per TASK-024's explicit instruction not
to split these apart)
- No-ops silently if the device is no longer connected.
- Parses `packet.data.trim()`, splits on whitespace after stripping the
  leading `!` and lowercasing; recognizes exactly `ping`, `help`, `nodes`,
  `status`; any other command with `args.length === 0 && raw.length < 20`
  gets an "Unknown command" reply, anything else (has args, or is long) is
  silently ignored with `reply` staying `null`.
- If `reply` is `null`, returns without sending anything or touching the DB.
- Otherwise sends via `device.meshDevice.sendText(reply, packet.from, false,
  packet.channel)`, capturing the returned `packetId`.
- Inserts a `messages` row with `role: 'sent'`, `ack_status: null`,
  `reply_to_packet_id: 0` (literal — a bot reply is never itself recorded as
  replying to anything), and `want_ack: false`.
- Emits a second `message:received` event (not a distinct `message:sent`
  type, despite `role: "sent"` in the payload) for the bot's own reply.

**Packet-id/reply-id correlation — the fragile invariant** (see Postconditions
below for the normative statement).

**`_handleNodeInfo(deviceId, nodeInfo)`** (`device-manager.ts:1036–1116`)
- No-ops if `nodeInfo.num` is `0`/absent.
- Derives `macAddress` from `user.macaddr` bytes as colon-separated lowercase
  hex, or `null` if absent/empty.
- Derives `publicKey` from `user.publicKey` bytes as lowercase hex, or `null`.
- Derives `lastHeard` from `nodeInfo.lastHeard` (unix seconds) → ISO string,
  or `null` if `0`/absent.
- Upserts into `nodes` keyed by `(node_id, device_id)`; on conflict, every
  column uses `COALESCE(EXCLUDED.x, nodes.x)` — an incoming `null`/absent
  field never overwrites an existing non-null value.
- Re-reads `latitude`/`longitude`/`altitude` from the DB (not from
  `nodeInfo.position`, which is otherwise unused by this handler) so the
  emitted `node:update` reflects whatever `_handlePosition` last wrote, not
  stale/absent position data on the nodeInfo packet itself.
- Emits `node:update` with the just-computed/just-read values.

**`_handleTelemetry(deviceId, name, pkt)`** (`device-manager.ts:1359–1407`)
- Only handles `pkt.data.variant.case === "deviceMetrics"`; every other
  telemetry variant is silently ignored (no persistence, no event — position/
  environment/power telemetry variants are dropped entirely today).
- Ignores `batteryLevel == null || batteryLevel === 0` (`0` is treated as "no
  reading," per the inline comment, not a real 0% battery).
- Only updates state if the telemetry's `from` matches this device's own
  `myNodeIds` entry — peer-node telemetry is discarded, not stored anywhere.
- Skips the emit entirely if the new level equals the cached one
  (`prev === batteryLevel`) — repeated identical readings produce zero
  events, not redundant ones.
- On an actual change, re-reads `hw_model`/`firmware` from `devices` and
  emits a full `device:status` event (not a narrower "battery changed"
  event) with the new `batteryLevel` and every other current status field.
- **No persistence** — battery level lives only in the in-memory
  `batteryLevels` map, never written to `devices` or any other table. This is
  existing behavior: extraction must not silently add persistence as a
  "cleanup."

**Raw-packet persistence — `_handleRawPacket(deviceId, meshPacket)`**
(`device-manager.ts:795–1033`)
- Computes `portnum`/`portnumName` (defaulting to `0`/`"UNKNOWN_APP"`),
  `rxTime` (from unix seconds, or `new Date()` if absent/zero).
- Stashes `pendingReplyIds` (see fragile invariant below) — synchronously,
  before any `await`.
- Decodes payload via `decodePayload()` for `decoded` variant packets;
  base64-encodes the raw payload bytes for both `decoded` and `encrypted`
  variants (`payloadRaw`); `decodedJson` is only populated for the `decoded`
  case.
- Updates the watchdog timestamp (`lastPacketMs`) unconditionally for every
  raw packet, decoded or not.
- Logs to `activityLog` (in-process ring buffer, not DB) whenever
  `fromNodeId !== 0`.
- **Upserts a bare `nodes` row** (`node_id`, `device_id`, `last_heard` only)
  whenever `fromNodeId !== 0`, independent of and in addition to whatever
  `_handleNodeInfo` does — this is how a node becomes visible before its
  first `NodeInfo` packet arrives. On conflict, `last_heard =
  GREATEST(EXCLUDED.last_heard, nodes.last_heard)` (monotonic — never moves
  backward), which is a **different** conflict strategy than
  `_handleNodeInfo`'s `COALESCE` strategy for the same column. This
  difference is intentional/existing, not a bug to reconcile during
  extraction.
- Re-reads the (now-upserted) node row and emits `node:update` — a **second,
  independent** `node:update` emission site from the one in `_handleNodeInfo`.
- Inserts a `packets` row unconditionally (every raw packet, decoded or not,
  gets a persisted row) and emits `packet:raw`. Note the emitted event's
  `decodedJson` is hardcoded to `null` (`device-manager.ts:943`) even though
  the DB row stores the real `decodedJson` — the event and the DB row
  intentionally differ here; this is existing behavior.
- **ACK/NACK detection**: for `portnum === ROUTING_APP (5)` decoded packets
  with a non-zero `requestId` and non-empty payload, decodes a `Routing`
  protobuf; on an `errorReason` variant, updates the matching `messages` row
  (`WHERE packet_id = requestId AND device_id = deviceId AND role = 'sent'
  AND ack_status = 'pending'`) and emits `message:ack` **only if a row was
  actually updated** (`RETURNING id`, checked before emitting). A malformed
  routing payload is caught and logged, not thrown.
- **Relayed-message capture**: for `portnum === TEXT_MESSAGE_APP (1)`,
  `encrypted` variant, where `fromNodeId` is not us and `toNodeId` is neither
  us nor broadcast, inserts a `role: 'relayed'` `messages` row with `text:
  NULL` (the payload is encrypted and cannot be read) — no event is emitted
  for this case; it is DB-only, for later analytics/inspection.

**Configuration handling** (`_handleConfigPacket`,
`device-manager.ts:1189–1202`; `_handleModuleConfigPacket`,
`1205–1218`; `_handleChannelPacket`, `1221–1238`; `applyConfigSection`,
`1273–1312`; `getDeviceConfig`, `1240–1267`)
- `_handleConfigPacket`/`_handleModuleConfigPacket`: no-op if
  `pkt.payloadVariant.case`/`.value` is absent; otherwise
  `jsonb_set`s a single section key into `devices.radio_config` /
  `devices.module_config` respectively. **No event is emitted** by either —
  the frontend only learns about config changes via the later
  `device:config` snapshot emitted from `_emitDeviceConfig` (called once,
  post-configure, in `connect()`; see below).
- `_handleChannelPacket`: no-op if `pkt`/`pkt.index` is absent; otherwise
  upserts one `channels` row keyed by `(device_id, idx)`, decoding
  `settings.psk` bytes to base64 if present. No event emitted here either.
- `getDeviceConfig(deviceId)`: reads `radio_config`/`module_config` and all
  `channels` rows, returns `null` if the device row itself doesn't exist
  (does not distinguish "device not found" from "device found but has no
  config yet" — the latter returns `{ radioConfig: {}, moduleConfig: {},
  channels: [] }`).
- `applyConfigSection(deviceId, namespace, section, value)`: **throws** (does
  not silently no-op) if the device isn't connected — the only handler in
  this group with throw-on-missing-device semantics. Calls
  `meshDevice.setConfig`/`setModuleConfig` (dynamic `import("@bufbuild/protobuf")`
  for `create()`), then `commitEditSettings()`, then persists the same
  section into `devices` via `jsonb_set` (mirroring the passive-packet
  handlers' storage shape), then calls `_emitDeviceConfig(deviceId)` — this
  is the **only** synchronous, caller-awaited config-write path; the passive
  `_handleConfigPacket`/`_handleModuleConfigPacket`/`_handleChannelPacket`
  handlers are the async, device-initiated mirror of the same storage.
- `_emitDeviceConfig` is called from exactly two places today: once at the
  end of `connect()` (after all `onConfigPacket`/`onModuleConfigPacket`/
  `onChannelPacket` handlers have had a chance to fire and queue their DB
  writes — see the ordering comment at `device-manager.ts:312–313`), and
  once at the end of `applyConfigSection`.

**Traceroute handling** (`onTraceRoutePacket` subscription,
`device-manager.ts:222–240`, plus `_saveTraceroute`, `626–639`)
- Not currently factored into a named private method — the subscription
  callback itself builds the `route`/`routeBack` arrays (`Array.from`, so a
  missing `pkt.data` yields empty arrays, not an error), resolves
  `fromNodeId` from `myNodeIds.get(id) ?? 0`, emits `traceroute:result`
  **synchronously before** persisting, then calls `_saveTraceroute`
  asynchronously (fire-and-forget, errors logged not thrown). The event is
  emitted even if the subsequent DB write fails.
- `_saveTraceroute` inserts one `traceroutes` row with `route`/`routeBack`
  each `JSON.stringify`'d into what the schema presumably declares as a
  `jsonb`/`text` column.

### The two named fragile invariants (verbatim from source)

**1. packetId → replyId correlation.** The class field comment
(`device-manager.ts:66`):

> `/** Correlates packetId → replyId for in-flight text packets between onMeshPacket and onMessagePacket */`

and the inline comment at the write site inside `_handleRawPacket`
(`device-manager.ts:804–806`):

> ```
> // Stash replyId synchronously before any await so _handleMessage can consume it.
> // onMeshPacket fires before the derived onMessagePacket, so the map entry will be
> // present by the time _handleMessage reads it.
> ```

**Required behavior, stated as an explicit, testable requirement:** for a
text-message-app packet with a non-zero packet `id`, `_handleRawPacket` (the
`onMeshPacket` handler) MUST synchronously (before any `await`) write
`pendingReplyIds.set(p.id, p.replyId ?? 0)` — synchronously specifically so
that `_handleMessage` (the `onMessagePacket` handler, fired from the same
underlying event) can read a fully-populated map entry, not a partially
constructed one, regardless of how the two handlers are subsequently
scheduled by the event loop. `_handleMessage` MUST read (and then delete)
`pendingReplyIds.get(packet.id)` and use it (defaulting to `0` if absent) as
the persisted and emitted `replyToPacketId` for that message. If this
correlation breaks (e.g., because the write moves after an `await`, or
because the two handlers end up in different modules that no longer share
the same `pendingReplyIds` map instance), every incoming reply's
`replyToPacketId` silently degrades to `0` — this is a silent correctness
regression, not a crash, which is exactly why TASK-024 and this contract call
it out explicitly rather than trusting a passing test suite to catch it by
accident. **No test in `device-manager.test.ts` currently exercises this
correlation** (see Validation requirements) — this is the single highest-
priority coverage gap this contract identifies.

**2. `onMeshPacket`-before-`onMessagePacket` ordering.** This is not
independently documented elsewhere in the file beyond the comment quoted
above; it is a property of the `@meshtastic/core` SDK's event derivation
(`onMessagePacket` is implemented, upstream, as a derived/filtered view over
the same underlying mesh-packet stream `onMeshPacket` subscribes to
directly), not something `DeviceManager` itself enforces. **Required
behavior:** the extraction must not change *subscription order* in
`connect()` in a way that could alter this — today, `onMessagePacket` is
subscribed **before** `onMeshPacket` in source order
(`device-manager.ts:162–175`), yet invariant #1 still holds, which confirms
the ordering guarantee comes from the SDK's internal event-firing order, not
from `DeviceManager`'s subscription-registration order. Extraction must
preserve both handlers subscribing to their respective SDK events on the
same `meshDevice` instance (so the SDK's internal firing order still
applies) and must not introduce any `await` between an extracted
`_handleRawPacket`-equivalent's `pendingReplyIds` write and the point where
its own subscription callback begins.

## Postconditions and invariants

- **Central invariant** (matches TASK-024's own acceptance criterion): for a
  fixed sequence of `meshDevice.events.on*` dispatches, the resulting set of
  DB writes (table, columns, values) and emitted `"event"` payloads (type,
  shape, order relative to each other) must be identical before and after
  TASK-024's extraction. Moving handler logic into new modules must not
  change which DB statements run, with what parameters, in what order, or
  what events fire, with what payloads, in what order.
- The packetId→replyId correlation (invariant #1 above) and its dependency on
  `onMeshPacket` firing before the derived `onMessagePacket` (invariant #2)
  must survive extraction exactly. If message handling and raw-packet
  persistence end up in different modules, they must share the same
  `pendingReplyIds` map instance (or an equivalent single source of truth) —
  TASK-024's plan already anticipates this by grouping message handling and
  bot commands together, but raw-packet persistence (the *producer* of the
  map entry) is planned to be extracted earlier (plan step 2) than message
  handling (plan step 6). **This means for four of the eight plan steps,
  the correlation crosses an extraction boundary that didn't exist before
  step 2 and won't be fully re-consolidated until step 6** — see Open
  questions for what this implies about intermediate-state testing.
- Each extracted handler must be constructible and unit-testable with
  explicit constructor/parameter-injected dependencies (`db`, an
  event-emission dependency, relevant `config` slice) and without a live
  `MeshDevice`/`TransportNodeSerial` connection beyond what today's mock
  pattern (`vi.mock("@meshtastic/core")`, a fake dispatcher-based
  `events` object) already provides.
- `DeviceManager` itself, post-extraction, contains none of: message
  handling, bot-command handling, node-update handling, telemetry handling,
  raw-packet persistence, configuration handling, or traceroute handling
  directly. It retains: `connect`/`disconnect`/`reconnectSaved`, all
  `meshDevice.events.on*` subscription wiring (delegating each callback body
  to the appropriate extracted handler), watchdog/reconnect/backoff logic,
  MQTT-gateway attach/detach, and the read-oriented public getters
  (`getDevice`, `getBatteryLevel`, `hasGpsPosition`, `getGpsDetail`,
  `getMyNodeId`, `listDevices`, `listNodes`, `getMessageHistory`,
  `deleteConversation`, `getDeviceConfig`) — note several of these getters
  read state (`batteryLevels`, `gpsAcquired`, `gpsDetails`, `myNodeIds`) that
  is *written* by handlers being extracted (`_handleTelemetry` writes
  `batteryLevels`; the MQTT `gps:position` listener writes `gpsAcquired`/
  `gpsDetails`; `onMyNodeInfo`'s inline handler writes `myNodeIds`). TASK-024
  must decide (and this contract flags as needing an explicit answer, not a
  silent one — see Open questions) whether that state stays owned by
  `DeviceManager` with extracted handlers calling back into it, or moves with
  the handler and `DeviceManager`'s getters delegate outward.

## Failure behavior

- Every handler subscription callback in `connect()` today wraps its handler
  call in `.catch((err) => console.error/warn(...))` — a rejected handler
  promise is logged, never thrown, and never crashes the process or the
  `MeshDevice` event pipeline. This must be preserved for every extracted
  handler's invocation site, even if the handler itself moves.
- `_handleBotCommand`'s and `_handleMessage`'s failures are independently
  caught at two different levels: `_handleMessage`'s own top-level failure is
  caught by `connect()`'s `onMessagePacket` subscription; `_handleBotCommand`'s
  failure is caught separately, inside `_handleMessage`, at its own call site
  (`device-manager.ts:691–693`) — so a bot-command failure never prevents the
  triggering message from having already been persisted/emitted (that already
  happened earlier in `_handleMessage`, before the bot-command branch).
  Extraction must preserve this two-level catch structure, not collapse it
  into one.
- `applyConfigSection` is the sole exception to "handlers never throw to
  their caller" — it throws synchronously for a disconnected device, and lets
  `meshDevice.setConfig`/`setModuleConfig`/`commitEditSettings` failures
  propagate to its caller (`routes/websocket.ts`) uncaught, unlike every
  passive packet handler. This asymmetry (throw-to-caller for the one
  human-initiated, awaited write path; catch-and-log for every
  device-initiated, fire-and-forget path) must be preserved.
- A malformed/unexpected packet shape does not crash a handler: `_handleNodeInfo`
  no-ops on `num === 0`; `_handlePosition` no-ops on missing/zero-zero
  position; `_handleConfigPacket`/`_handleModuleConfigPacket`/
  `_handleChannelPacket` no-op on missing variant/index; `_handleRawPacket`'s
  routing-decode failure is caught and logged. None of these currently-silent
  no-ops may become throws as a side effect of extraction.

## Interfaces

No new interfaces are prescribed by this contract beyond the "must not
change" public surface documented in Inputs and outputs above. TASK-024's own
task description requires each extracted handler to receive dependencies
"explicitly (constructor/parameter injection)" — this contract does not
mandate a specific injected-dependency interface shape (e.g., a shared
`HandlerDeps { db: PGlite; emit: (e: ServerEvent) => void; config: ... }`
type vs. per-handler bespoke constructor args) since TASK-024 leaves that as
implementer discretion. Whatever shape is chosen, it must give each handler
everything it needs to reproduce the exact DB writes and event payloads
documented above without importing or reaching into `DeviceManager`'s private
fields (`devices`, `myNodeIds`, `batteryLevels`, `gpsAcquired`, `gpsDetails`,
`pendingReplyIds`, etc.) directly.

## UX expectations

N/A. This contract governs an internal daemon-side coordination boundary with
no direct rendering surface. Every human-visible effect is indirect, via the
`ServerEvent`s enumerated above reaching the frontend over the existing
WebSocket broadcast (`routes/websocket.ts:68`, unaffected by this contract).

## Validation requirements

- `packages/daemon/src/__tests__/device-manager.test.ts` must pass, unmodified
  in its currently-passing assertions, against the refactored implementation
  — no weakened assertions, per TASK-024's own acceptance criteria.
- **Coverage by extraction area, today** (informs TASK-024 plan step 1 —
  "extend coverage for any gap found... before extracting that area"):
  - **Message handling** (`describe("message handling (onMessagePacket)")`,
    lines 291–345): moderately covered — DB write, `message:received` event,
    `last_seen` update. **Not covered**: the `replyToPacketId` correlation
    with a preceding `onMeshPacket` dispatch (bot.enabled is `false` in every
    test's `DeviceManager` construction, so `_handleBotCommand` is never
    exercised transitively through `_handleMessage` either).
  - **Bot-command handling**: **zero coverage.** No test constructs a
    `DeviceManager` with `bot.enabled: true`, and no test dispatches a `!`-
    prefixed message. None of `!ping`/`!help`/`!nodes`/`!status`/unknown-command
    behavior, nor the bot's own reply-persistence/emission path, is
    characterized by an executable test today.
  - **Node-update handling** (`describe("node info handling
    (onNodeInfoPacket)")`, lines 447–566): deeply covered — upsert, lat/lng
    conversion (via a chained `onPositionPacket` dispatch), MAC formatting,
    emitted event shape, `COALESCE`-preserving partial update, and
    `(node_id, device_id)` composite-key isolation across two devices.
  - **Telemetry handling**: **zero coverage.** No test dispatches
    `onTelemetryPacket`. The `deviceMetrics`-only filter, the `0`-means-
    "no reading" rule, the own-node-vs-peer-node filter, the
    same-value-skips-emit rule, and the full `device:status` re-emission
    shape are all unverified by any executable test.
  - **Configuration handling**: **zero coverage.** No test dispatches
    `onConfigPacket`/`onModuleConfigPacket`/`onChannelPacket`, and no test
    calls `applyConfigSection` or `getDeviceConfig`.
  - **Raw-packet persistence** (`describe("raw packet handling
    (onMeshPacket)")`, lines 348–444): moderately covered — `packets` table
    write, `rxTime` computation, base64 payload, `packet:raw` event, and the
    `encrypted`-variant branch. **Not covered**: the `pendingReplyIds` stash
    itself (see the fragile-invariant gap above), the bare-`nodes`-row
    upsert-on-any-packet branch and its resulting `node:update` emission, the
    ACK/NACK (`ROUTING_APP`) detection branch, and the relayed-message
    (`role: 'relayed'`) capture branch.
  - **Traceroute handling**: **zero coverage.** No test dispatches
    `onTraceRoutePacket`.
  - Given this, TASK-024's plan step 1 is not optional busywork — bot
    commands, telemetry, configuration, and traceroutes each currently have
    no executable baseline at all, and raw-packet persistence's
    highest-risk sub-behavior (the replyId stash) is likewise unverified.
    Extracting any of these areas without first adding characterization
    tests means the extraction cannot be judged against a precise baseline
    for that area, contradicting this contract's own purpose.
- Recommended, specific new test (highest priority, addresses the
  single-most-fragile invariant directly): dispatch an `onMeshPacket` event
  carrying a text-message-app packet with a known `id` and `replyId`,
  immediately followed by an `onMessagePacket` dispatch with a matching
  `id`, and assert the resulting `messages` row / `message:received` event's
  `replyToPacketId` equals the stashed `replyId`. This test does not exist
  today and should be added before (not after) raw-packet persistence and
  message handling are extracted into separate modules.
- Manual/simulated smoke test (per TASK-024's own validation requirements):
  message send/receive, bot commands (`!ping`, `!nodes`, `!status`,
  `!help`), telemetry updates, and traceroute requests, against a real or
  simulated device.
- QualityAssurance review before acceptance, per TASK-024's own
  recommendation, given this is one of the two highest-risk tasks in the
  roadmap.

## Open questions

1. **Where does handler-written, getter-read state live post-extraction?**
   `batteryLevels`, `gpsAcquired`, `gpsDetails`, and `myNodeIds` are each
   written by logic in scope for extraction (`_handleTelemetry`, the MQTT
   `gps:position` listener, and the inline `onMyNodeInfo` handler
   respectively) but read by public getters TASK-024 says `DeviceManager`
   keeps (`getBatteryLevel`, `hasGpsPosition`, `getGpsDetail`, `getMyNodeId`)
   and by other extracted handlers themselves (e.g., `_handleBotCommand`'s
   `!status` reply reads `myNodeIds`; `_handleNodeInfo`'s emitted event does
   not, but `_emitStatus` does). The task description doesn't say whether
   this state stays centrally owned by `DeviceManager` (with extracted
   handlers required to call back into it — which is itself a form of
   "reaching into DeviceManager internals" the task says to avoid) or moves
   out with whichever handler writes it most (with `DeviceManager`'s getters
   delegating outward). This is a real architectural decision TASK-024's own
   text doesn't resolve, and this contract deliberately does not resolve it
   either — it needs human/implementer decision before extraction starts,
   since it affects nearly every handler's dependency list.
2. **TASK-024's plan sequences raw-packet persistence extraction (step 2)
   before message-handling extraction (step 6)**, meaning for four
   intermediate plan steps, the `pendingReplyIds` producer and consumer live
   in different modules while `_handleMessage`/`_handleBotCommand` are still
   unextracted. Should the correlation-verifying test recommended above be
   required to pass at *every* intermediate plan step (i.e., after step 2,
   not just at the end), or is it sufficient to verify it once at the end of
   step 6? This contract recommends the former (continuous verification) but
   leaves the decision, and any adjustment to TASK-024's plan ordering that
   might follow from it (e.g., extracting message handling and raw-packet
   persistence together instead of four steps apart), to the human.
3. **TASK-023 (the typed-adapter-output dependency) is approved but not yet
   implemented** as of this contract's drafting. TASK-024's own text frames
   this as a hard blocker ("extract handlers using the now-typed adapter
   output, not `any`"). This contract's behavioral baseline above is written
   against the current `any`-typed code and does not change if/when TASK-023
   lands first — but the human should confirm TASK-024 (and any
   implementation against this contract) should not begin until TASK-023 is
   actually complete, not just approved.
4. **Traceroute handling has no named private method today** (it's inline in
   the `onTraceRoutePacket` subscription callback). TASK-024's plan step 7
   treats it as one of the seven areas to extract; this contract does not
   mandate a specific new method/module name for it, only that its documented
   behavior (synchronous event-then-async-persist ordering, `myNodeIds`
   fallback to `0`) survives extraction unchanged.
5. **Should `_emitDeviceConfig`'s two call sites (end of `connect()`, end of
   `applyConfigSection`) both move into whichever module owns configuration
   handling, or does `connect()`'s call site stay in `DeviceManager` as
   lifecycle coordination** (since it's gated on "all onConfigPacket/
   onModuleConfigPacket/onChannelPacket handlers have had a chance to fire,"
   per the comment at `device-manager.ts:312–313` — itself an ordering
   dependency on configuration handling's completion, similar in kind to the
   packetId/replyId one, though not called out by TASK-024's own risk
   framing)? This contract documents the dependency; TASK-024/the implementer
   should decide where the call site lives without breaking the ordering
   guarantee it depends on.
