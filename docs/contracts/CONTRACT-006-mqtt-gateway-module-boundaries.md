# CONTRACT-006: MQTT Gateway Module Boundaries

Status: Accepted
Approved by: Patrick
Approved date: 08/24/26
Related tasks: TASK-025

## Purpose

`packages/daemon/src/mqtt/gateway.ts` (`class MqttGateway extends EventEmitter`,
1,143 lines as of this writing, class declared at line 79) is being split into
six responsibility modules — transport, codec, topic parsing, inbound
handling, publishing, and node persistence — under TASK-025. `MqttGateway` is
the only component that publishes to the public `mqtt.meshtastic.org` broker;
a regression here does not just break this daemon, it can publish malformed
or incorrect data that other operators' maps and instances consume. TASK-025
is explicitly scoped as "a pure structural split," verified against
`packages/daemon/src/mqtt/__tests__/gateway.test.ts` (TASK-008's
characterization suite, 10 tests, already accepted-pending-review as the
authoritative executable spec for encryption round-trips and topic-string
parsing). This contract pins the module boundaries, the interfaces between
them, and — critically — a constraint imposed by the frozen test suite itself
that materially affects how the split can be implemented, so implementation
doesn't rediscover it mid-refactor.

## Scope

### Included

- The six module boundaries: transport (raw `mqtt.MqttClient` wrapper),
  codec (`_expandPsk`/`_encrypt`/`_decrypt` + `DEFAULT_KEY`), topic parsing
  (the logic inside `_handleInbound` that classifies a topic string and
  extracts channel/gateway/region), inbound handling (`_handleInbound`,
  `_handleJsonInbound`, `_upsertFromData`), publishing (`_handleMeshPacket`,
  `_publishSelf`, `_publishOwnPacket`, `_publishMapReport`, `_randomPacketId`),
  and node persistence (`_emitNodeUpdate` and the `mqtt_nodes`/`nodes` DB
  writes currently inlined in `_upsertFromData` and `_publishSelf`).
- What each module must accept as input (explicit dependency injection) to
  replace today's implicit access to `this.devices`, `this.db`, `this.cfg`,
  `this.client`, and `this.emit(...)`.
- The constraint that `packages/daemon/src/mqtt/__tests__/gateway.test.ts`
  must pass **unmodified** (TASK-025's own acceptance criterion), and what
  that requires of the orchestrating `MqttGateway` class's surface.
- `MqttGateway`'s public surface as consumed by `index.ts`, `device-manager.ts`,
  `routes/websocket.ts`, and `routes/devices.ts` — this must not change.

### Excluded

- Any change to wire protocol, encryption scheme, topic structure, or
  published payload content — per TASK-025's own scope boundary.
- Device attachment/lifecycle (`attachDevice`, `detachDevice`, the
  `meshDevice.events.*` subscriptions, self-announce timer scheduling). These
  are not among the six modules TASK-025 names for extraction and are not
  addressed by this contract; they remain orchestrator glue code unless the
  human directs otherwise.
- Where exactly the geo-distance helpers (`_haversineMeters`, `_getOwnLatLon`,
  `_recalcAllDistances`) land — TASK-025 explicitly defers this ("decide
  during implementation"). This contract does not resolve it; see Open
  questions.
- Adding new test coverage. This contract identifies where the existing
  characterization suite is silent, but authorizing new tests is a human
  decision (see Open questions), not something this contract mandates.

## Actors

- **Daemon process** (`packages/daemon/src/index.ts`): constructs
  `new MqttGateway(cfg, db)` when `config.mqtt.broker` is set, calls
  `mqttGateway.start()` conditionally, and passes the instance to
  `deviceManager.setMqttGateway(mqttGateway)`.
- **`DeviceManager`** (`packages/daemon/src/device/device-manager.ts`): calls
  `gateway.attachDevice`/`detachDevice` per connected device (outside this
  contract's scope) and subscribes to the `"gps:position"` event.
- **WebSocket/REST routes** (`routes/websocket.ts`, `routes/devices.ts`):
  subscribe to the `"mqtt_node:update"` event, call `listMqttNodes()`, and
  call `start()`/`stop()`/read `isRunning` to toggle the gateway at runtime.
- **The public MQTT broker** (`mqtt.meshtastic.org` or an operator-configured
  alternative): the external, non-project-controlled counterparty. It is the
  actor most affected by a regression in this split, since it is shared with
  other operators' Meshtastic instances.
- **`packages/daemon/src/mqtt/__tests__/gateway.test.ts`** (TASK-008): not a
  human actor, but an authoritative, frozen consumer of `MqttGateway`'s
  private surface (see "Constraint imposed by the frozen test suite" below).
  It must continue to pass without modification.
- **Human operator**: experiences MQTT connect/disconnect/error state via
  console log lines and the `mqtt:status` WebSocket event; ultimately relies
  on published data being well-formed for other operators' maps.

## Inputs and outputs

Unchanged, module-external inputs/outputs (must be preserved exactly):

- `new MqttGateway(cfg: MqttGatewayConfig, db: PGlite)` — same constructor
  shape; `MqttGatewayConfig` (`broker`, `port`, `username`, `password`,
  `rootTopic`, optional `selfAnnounceInterval`) is unchanged.
- `start(): void`, `stop(): void`, `get isRunning(): boolean`,
  `attachDevice(deviceId, meshDevice): void`, `detachDevice(deviceId): void`,
  `async listMqttNodes(): Promise<MqttNode[]>` — unchanged public methods.
  `MqttGateway` continues to extend `EventEmitter` and emit `"gps:position"`
  and `"mqtt_node:update"` with the same payload shapes.
- Inbound: MQTT `message` events (`topic: string`, `payload: Buffer`) from the
  subscribed broker topic tree.
- Outbound: MQTT `publish()` calls with binary `ServiceEnvelope` payloads on
  `{root}/2/e/{channel}/{!gatewayId}` and `{root}/2/map/`, unchanged topic
  layout (see header comment, lines 8–10 of `gateway.ts`).

New, module-internal inputs/outputs this contract defines (see Required
behavior):

- Codec: pure functions over `(key, packetId, fromNode, bytes)` →
  `Buffer`/`Uint8Array`. No `this`, no I/O.
- Topic parsing: a pure function over a topic `string` → a classification
  result (`encrypted` / `json` / `skip`, plus `channelName`, `gatewayId`,
  `regionPath` where applicable). No I/O.
- Inbound handling: requires `db`, a channel-key resolver, an own-lat-lon
  accessor, and a node-persistence handle (see below).
- Publishing: requires a `client`/`connected` accessor, `codec`, `db`, `cfg`,
  a node-persistence handle, and a single `DeviceState` per call (not the
  whole device map).
- Node persistence: requires `db` and an event-emit callback.

## Preconditions

- `packages/daemon/src/mqtt/__tests__/gateway.test.ts` passes against current
  `gateway.ts` before the split begins (TASK-025's plan step 1). This
  contract assumes that baseline holds.
- No change to `packages/shared`'s `formatNodeId`/`MqttNode` or to the
  `mqtt_nodes`/`mqtt_json_packets`/`nodes` table schemas is in scope here.

## Required behavior

### What the frozen test suite already pins (do not re-derive, cite instead)

**Codec (`_expandPsk`/`_encrypt`/`_decrypt`)**, `describe("MqttGateway crypto
helpers")`:

- `"expands sentinel, direct-length, padded, truncated, and all-zero PSKs"` —
  covers every `_expandPsk` branch: 1-byte sentinel `0x01` → `DEFAULT_KEY`;
  16- and 32-byte keys returned as-is; short keys zero-padded to 16 bytes;
  keys whose first 16 bytes are all-zero → `DEFAULT_KEY`; keys longer than 16
  bytes truncated to the first 16.
- `"round-trips plaintext with AES-128-CTR"` — `_decrypt(key, id, from,
  _encrypt(key, id, from, plaintext)) === plaintext`.
- `"matches a fixed AES-128-CTR known vector"` — pins the exact ciphertext
  bytes (`bc9848bbb4088190e3018abe47a71209`) for a fixed synthetic key,
  `packetId = 0x12345678`, `fromNode = 0x90abcdef`, and a fixed plaintext.
  This is the strongest available guarantee that the nonce construction
  (`packetId` little-endian at byte 0, `fromNode` little-endian at byte 8,
  AES-128-CTR) is unchanged by the split — any refactor that changes nonce
  byte order or key derivation will fail this test.

**Topic parsing / inbound routing**, `describe("MqttGateway inbound
handling")`:

- `"parses encrypted topics and filters the missing-city double slash"` —
  `msh/US/CA/CentralCoast//2/e/TestChannel/!aabbccdd` → `regionPath =
  "US/CA/CentralCoast"`, `channelName = "TestChannel"`, `gatewayId =
  "!aabbccdd"`. This is the double-slash case referenced by TASK-025; the
  source comments it precisely (lines 672–673 of the current `gateway.ts`):
  > `// Region path = everything between "msh/" and "/2/e" e.g.
  > "US/CA/Humboldt/Eureka"`
  > `// Filter empty segments to handle topics without a city level
  > (double-slash, e.g. msh/US/CA/CentralCoast//2/e/...)`
- `"normalizes an already-decoded inbound packet"` —
  `msh/US/CA/2/e/TestChannel/!aabbccdd` → `regionPath = "US/CA"` (a topic
  with no double-slash, one region segment).
- `"parses JSON topic metadata before delegating"` —
  `msh/US/CA/Humboldt/Eureka/2/json/TestChannel/!aabbccdd` → delegates to
  `_handleJsonInbound(payload, "TestChannel", "!aabbccdd",
  "US/CA/Humboldt/Eureka")`.
- `"skips non-2/e topics without throwing"` — `msh/US/CA/2/map/TestChannel`
  resolves to `undefined` (no `_upsertFromData`/`_handleJsonInbound` call).
- `"contains malformed encrypted protobuf and JSON payloads"` — garbage bytes
  on a `2/e` topic and invalid JSON text on a `2/json` topic both resolve
  without throwing.

**Publishing**, `describe("MqttGateway MQTT publication")`:

- `'subscribes to "#" when rootTopic is "all"'` — when `rootTopic === "all"`,
  the subscribe topic is the literal string `"#"` (verified via
  `mqttClient.subscribe`), not `"all/#"`.
- `"passes encrypted mesh bytes through and re-encrypts decoded mesh data"` —
  covers both `_handleMeshPacket` branches: an already-`encrypted`
  `payloadVariant` is published byte-for-byte unchanged; a `decoded`
  `payloadVariant` is re-serialized as `Data` and re-encrypted with the
  device's channel-0 key, and the resulting publish topic is asserted exactly
  as `msh/US/CA/CentralCoast/2/e/TestChannel/!12345678`.

The split implementation must pass all of the above unmodified. Where the
split changes *which module* a given line of logic lives in, the test file's
per-case behavior is the ground truth, not this contract's prose paraphrase
of it.

### Gaps the frozen test suite leaves open (this contract's actual job)

The following current behavior has **no** assertion in
`gateway.test.ts` today. This contract requires it to be preserved exactly as
existing behavior (per source, not newly designed here), but flags each as a
real coverage gap given TASK-025's own framing of this as one of the two
highest-protocol-risk tasks in the roadmap:

- `_upsertFromData`'s three branches (NODEINFO_APP upsert, POSITION_APP
  upsert + `nodes` table write + distance calc, and the generic/other-portnum
  upsert) are exercised only through mocked-out delegation in the inbound
  tests (`internals._upsertFromData = vi.fn()`); no test exercises the SQL or
  branching inside `_upsertFromData` itself.
- `_emitNodeUpdate` (the `mqtt_nodes` read-back + `MqttNode` construction +
  `emit("mqtt_node:update", ...)`) is untested.
- `_publishSelf`, `_publishOwnPacket`, and `_publishMapReport` are untested —
  the one publishing test only exercises `_handleMeshPacket`.
- `_handleJsonInbound`'s internal behavior (the `mqtt_json_packets` insert,
  and the `type === "position"` branch's `mqtt_nodes` write) is untested; the
  one JSON-related test only asserts that `_handleInbound` delegates to it
  with the right arguments, via a mock that replaces the real method.
- The `rootTopic === "all"` → `"msh"` substitution used when **publishing**
  (`_handleMeshPacket`, `_publishOwnPacket`, `_publishMapReport` all do
  `this.cfg.rootTopic === "all" ? "msh" : this.cfg.rootTopic` when building
  the outbound topic) is untested — the `"all"` test only covers the
  *subscribe* topic. A refactor that accidentally publishes to `all/2/e/...`
  instead of `msh/2/e/...` when `rootTopic === "all"` would not be caught by
  the existing suite.
- The decrypt-failure catch path in `_handleInbound` (wrong/unknown channel
  key → garbage plaintext → `fromBinary` throws → caught, logged, packet
  dropped) has no dedicated assertion.
- `_haversineMeters`, `_getOwnLatLon`, and `_recalcAllDistances` are entirely
  untested.

None of these gaps block this contract from being written, but they are
material to the human's acceptance decision on TASK-025 given the stated
risk ("a subtle encryption or topic-structure regression here... publishes
incorrect data to a public map other operators rely on"). See Open questions.

### Constraint imposed by the frozen test suite (implementation-shaping)

`gateway.test.ts` does not import the six future modules — it imports only
`MqttGateway` from `../gateway.js` and reaches into its **instance** via an
unsafe cast (`gateway as unknown as GatewayInternals`). It then:

- reads/writes `internals.client`, `internals.connected`, and
  `internals.devices` directly (e.g. `internals.devices.set("device-1",
  makeState(key))`, `internals.client = mqttClient`, `internals.connected =
  true`);
- calls `internals._expandPsk(...)`, `internals._encrypt(...)`,
  `internals._decrypt(...)`, `internals._handleInbound(...)`,
  `internals._handleMeshPacket(...)` directly;
- **monkey-patches** `internals._upsertFromData = vi.fn()...` and
  `internals._handleJsonInbound = vi.fn()...` before calling
  `internals._handleInbound(...)`, then asserts the mock was called with
  specific arguments.

Because TASK-025 requires this suite to pass **unmodified**, the split must
preserve, on the `MqttGateway` instance itself:

1. `client`, `connected`, and `devices` (a `Map<string, DeviceState>` with
   the current field shape) as live, directly-settable instance properties —
   not fully encapsulated inside a transport/inbound module that the
   orchestrator can no longer read or that reads a stale copy.
2. `_expandPsk`, `_encrypt`, `_decrypt`, `_handleInbound`,
   `_handleJsonInbound`, `_handleMeshPacket`, and `_upsertFromData` as real
   instance methods reachable at `internals.<name>` — they may be thin
   delegating wrappers around the new modules, but they must exist by these
   exact names on `MqttGateway`.
3. Internal calls between these responsibilities must be dispatched through
   `this.<name>(...)`, not through direct closures/references to a module's
   internal function. Concretely: whatever implements `_handleInbound` must
   invoke `this._handleJsonInbound(...)` and `this._upsertFromData(...)` (via
   the instance), because the test replaces `internals._handleJsonInbound`
   and `internals._upsertFromData` with `vi.fn()` *before* calling
   `_handleInbound` and asserts those mocks were invoked. If `_handleInbound`
   instead called an extracted inbound-handling module's JSON-handling
   function directly (bypassing `this`), the monkey-patch would silently
   stop intercepting the call and these two tests would fail even though
   runtime behavior looked correct.
4. `_handleMeshPacket` and any orchestrator method that reads `this.client`/
   `this.connected` must read them fresh at call time (not cache them at
   construction), since the test sets `internals.client`/`internals.connected`
   directly without going through `start()`.

This is not a constraint this contract invents — it falls directly out of
TASK-025's own acceptance criterion ("TASK-008's characterization test suite
passes unchanged"). It does not mandate a specific module file layout; it
only requires that `MqttGateway` keep this exact delegating surface,
regardless of where the underlying logic physically lives.

### Module boundary definitions

- **Codec**: `expandPsk`, `encrypt`, `decrypt`, and the `DEFAULT_KEY`
  constant, as pure functions/values with no reference to `this`, `db`, or
  `devices`. `DEFAULT_KEY` must be importable by inbound handling and
  publishing (both use it as a fallback channel key today), not private to
  the codec module.
- **Topic parsing**: a pure function classifying a raw topic string into one
  of: encrypted (`channelName`, `gatewayId`, `regionPath`), JSON
  (`channelName`, `gatewayId`, `regionPath`), or skip. No I/O, no state. Must
  reproduce the exact segment-search behavior (finds `"e"`/`"json"` preceded
  by `"2"`, filters empty segments for the region path) rather than assuming
  a fixed topic depth — this is what makes the `rootTopic === "all"`
  broad-subscribe case and the inconsistent regional depths (see the
  `start()` comment below) work today.
- **Transport**: owns the raw `mqtt.MqttClient` — `mqtt.connect(url, opts)`
  with the exact current `url` (`mqtt://{broker}:{port}`), `clientId`
  (`foreman_{4 random hex bytes}`), and options (`reconnectPeriod: 5000`,
  `keepalive: 60`); the subscribe-topic decision (`rootTopic === "all" ? "#"
  : "${rootTopic}/#"`), preserving this exact rationale (lines 116–120 of the
  current source):
  > `// Regions use inconsistent depths (centralvalley = 4 levels,
  > Humboldt/Eureka = 5 levels, CentralCoast// = 5 levels with empty city) so
  > a fixed +/+/2/e/# pattern misses some. _handleInbound already finds 2/e
  > by searching, so a broad # subscription is safe.`
  and force-close semantics on `stop()` (`client.end(true)`).
- **Inbound handling**: `_handleInbound`, `_handleJsonInbound`,
  `_upsertFromData`. Requires as injected dependencies: `db`; a channel-key
  resolver `(channelName: string) => Buffer` (replaces today's `for (const
  state of this.devices.values())` scan — see below); an own-lat-lon accessor
  `() => {lat, lon} | null` for the POSITION_APP distance calculation; and a
  node-persistence handle exposing an `emitNodeUpdate`-equivalent call.
- **Publishing**: `_handleMeshPacket`, `_publishSelf`, `_publishOwnPacket`,
  `_publishMapReport`, `_randomPacketId`. Requires: a `client`/`connected`
  accessor (read fresh per call, per the constraint above); `codec`; `cfg`
  (specifically `rootTopic`, with the `"all"` → `"msh"` substitution
  preserved for outbound topics — untested today, see Gaps); `db` (for the
  self-position write); a node-persistence handle; and, per call, the
  specific `DeviceState` for the device being published (not the whole
  `devices` map — the orchestrator already looks up `state = this.devices.get
  (deviceId)` before delegating, so publishing functions can take
  `DeviceState` directly).
- **Node persistence**: `_emitNodeUpdate` plus the `mqtt_nodes`/`nodes`
  upsert SQL currently inlined in `_upsertFromData` and `_publishSelf`.
  Requires `db` and an event-emit callback (e.g. `gateway.emit.bind
  (gateway)`) so it can perform "write, then immediately emit" as one step,
  matching current control flow, without inbound handling or publishing
  needing direct `EventEmitter` access themselves.
  - Recommendation (not mandatory — see Open questions): also route the
    `mqtt_json_packets` insert in `_handleJsonInbound` through inbound
    handling directly rather than node persistence, since it's an immutable
    packet-audit-log write keyed by packet, not an upsert keyed by node
    identity like everything else this module owns. This has no observable
    effect either way; it's purely an internal grouping call.

### Shared mutable state — what becomes explicit

Today, `this.devices: Map<string, DeviceState>` is read implicitly by three
different concerns that will sit in three different modules after the split.
This contract requires each to become an explicit, injected dependency rather
than continued implicit access to the whole map:

1. **Publishing** only ever needs a single device's state, looked up by
   `deviceId` before the call — pass `DeviceState` directly.
2. **Inbound handling**'s channel-key resolution
   (`_handleInbound`/`_upsertFromData` path) scans *all* attached devices'
   channel maps for a name match, falling back to `DEFAULT_KEY` if none
   match — this needs a resolver function injected by the orchestrator
   (which still owns `devices`), not the raw map, so inbound handling stays
   ignorant of `DeviceState`'s shape.
3. **Geo helpers** (`_getOwnLatLon`) likewise scan all attached devices for
   the first cached GPS fix — same treatment: an injected accessor function,
   not the raw map.

The orchestrating `MqttGateway` retains sole ownership of `devices` (per the
frozen-test-suite constraint above) and supplies these two resolver functions
to inbound handling using its own map.

## Postconditions and invariants

- No change to encryption inputs/outputs, nonce construction, topic string
  layout, or published payload encoding as a result of the split.
- The six modules, wired together by the orchestrating `MqttGateway`,
  reproduce the exact current control flow and DB write sequence — this is a
  structural split, not a behavior redesign.
- `MqttGateway`'s public method/event surface (`start`, `stop`, `isRunning`,
  `attachDevice`, `detachDevice`, `listMqttNodes`, `"gps:position"`,
  `"mqtt_node:update"`) is unchanged for `index.ts`, `device-manager.ts`,
  `routes/websocket.ts`, and `routes/devices.ts`.
- `gateway.test.ts` continues to import `MqttGateway` from `../gateway.js`
  and continues to pass without modification.

## Failure behavior

- Malformed inbound protobuf/JSON payloads resolve without throwing (per
  `"contains malformed encrypted protobuf and JSON payloads"`) — this
  isolation must be preserved at whichever module boundary now contains the
  `fromBinary`/`JSON.parse` calls.
- A single packet's processing failure must not crash the process or leave
  the MQTT client unusable. Today this isolation comes from the *caller*
  wrapping each async entry point in `.catch(console.error)` — the `message`
  handler wraps `_handleInbound(...)`, and self-announce call sites wrap
  `_publishSelf(...)` — rather than from try/catch inside those methods
  themselves (aside from the explicit protobuf/JSON parse try/catches). The
  split must preserve this outer-catch pattern at each place it exists today,
  not silently convert any of them to unguarded awaits.
- DB write failures inside `_upsertFromData`, `_emitNodeUpdate`,
  `_handleJsonInbound`, or `_publishSelf`'s writes are not caught internally
  today; they propagate as rejected promises to the same outer `.catch
  (console.error)` sites above. The split must not add new internal
  swallowing or new internal retries — this is existing behavior being
  preserved, not a new decision.
- Decrypt failures (`_decrypt` producing garbage that fails
  `fromBinary(Protobuf.Mesh.DataSchema, ...)`) are caught in
  `_handleInbound`'s inner `try`, logged, and the packet is dropped — no
  dedicated test exercises this path today (see Gaps); it must be preserved
  by description.

## Interfaces

Illustrative only — exact file names, export names, and internal signatures
are implementer discretion as long as they satisfy the behavioral
requirements and the frozen-test-suite constraint above.

```ts
// codec.ts
export const DEFAULT_KEY: Buffer;
export function expandPsk(psk: Uint8Array): Buffer;
export function encrypt(key: Buffer, packetId: number, fromNode: number, plaintext: Buffer): Buffer;
export function decrypt(key: Buffer, packetId: number, fromNode: number, ciphertext: Buffer): Buffer;

// topic-parsing.ts
type ParsedTopic =
  | { kind: "encrypted"; channelName: string; gatewayId: string; regionPath: string }
  | { kind: "json"; channelName: string; gatewayId: string; regionPath: string }
  | { kind: "skip" };
export function parseInboundTopic(topic: string): ParsedTopic;

// node-persistence.ts
export interface NodePersistence {
  upsertNodeInfo(nodeId: number, user: Protobuf.Mesh.User, meta: NodeWriteMeta): Promise<void>;
  upsertNodePosition(nodeId: number, pos: { lat: number; lon: number; alt: number | null }, meta: NodeWriteMeta): Promise<void>;
  upsertNodeSeen(nodeId: number, meta: NodeWriteMeta): Promise<void>;
  emitNodeUpdate(nodeId: number, meta: NodeWriteMeta): Promise<void>; // reads back + emits "mqtt_node:update"
}

// inbound-handling.ts — constructor/factory dependencies
interface InboundHandlingDeps {
  db: PGlite;
  resolveChannelKey(channelName: string): Buffer;
  getOwnLatLon(): { lat: number; lon: number } | null;
  nodePersistence: NodePersistence;
}

// publishing.ts — per-call dependencies
interface PublishDeps {
  getClient(): mqtt.MqttClient | null; // read fresh, not cached
  isConnected(): boolean;
  cfg: Pick<MqttGatewayConfig, "rootTopic">;
  db: PGlite;
  nodePersistence: NodePersistence;
}

// gateway.ts — orchestrator retains this exact instance surface
export class MqttGateway extends EventEmitter {
  private client: mqtt.MqttClient | null;
  private connected: boolean;
  private readonly devices: Map<string, DeviceState>;
  private _expandPsk(psk: Uint8Array): Buffer;
  private _encrypt(...): Buffer;
  private _decrypt(...): Buffer;
  private _handleInbound(topic: string, payload: Buffer): Promise<void>;
  private _handleJsonInbound(payload: Buffer, channelName: string, gatewayId: string, regionPath: string): Promise<void>;
  private _handleMeshPacket(deviceId: string, pkt: unknown): Promise<void>;
  private _upsertFromData(...): Promise<void>;
  // ...public methods/events unchanged
}
```

## UX expectations

N/A — no direct end-user-facing surface. The only human-visible effect is the
existing console log/error output (connection state, subscribe confirmation,
per-packet trace lines) and the `mqtt:status` WebSocket event. `gateway.test.ts`
spies on `console.log`/`console.error` without asserting on their content, so
this contract requires log *behavior* (something is logged at the same
decision points) to be preserved for operability, but does not pin exact log
wording as a pass/fail criterion the way it pins topic strings and ciphertext.

## Validation requirements

- `packages/daemon/src/mqtt/__tests__/gateway.test.ts` must pass unmodified
  against the split implementation — this is TASK-025's own primary
  acceptance criterion and this contract's primary executable validation.
- Typecheck/build (`tsc --noEmit` for `@foreman/daemon`) to confirm the
  module boundary refactor doesn't break the `MqttGateway` import sites in
  `index.ts`, `device-manager.ts`, `routes/websocket.ts`, `routes/devices.ts`.
- Per TASK-025's own validation requirements: a manual smoke test against
  `mqtt.meshtastic.org` (or a non-production broker) is recommended to
  confirm published packets remain well-formed, given the public-broker risk.
  This is not automatable by the existing suite and is called out again here
  because the Gaps section above identifies exactly which paths (self-announce
  publishing, JSON inbound DB writes, `"all"` rootTopic outbound substitution)
  have no automated coverage today.
- QualityAssurance review before acceptance, as TASK-025 itself recommends,
  given the risk profile.

## Open questions

1. **Should new characterization tests be added for the untested paths
   before/alongside this split?** The Gaps section above lists seven behaviors
   (`_upsertFromData`'s branches, `_emitNodeUpdate`, `_publishSelf`/
   `_publishOwnPacket`/`_publishMapReport`, `_handleJsonInbound`'s DB writes,
   the `"all"`→`"msh"` outbound substitution, the decrypt-failure path, and
   the geo helpers) with zero automated coverage today. TASK-025 frames this
   as a pure structural split verified against the *existing* suite, which
   would leave these paths validated only by prose-preservation and a manual
   broker smoke test. Given this task is explicitly called out as one of the
   two highest-protocol-risk items in the roadmap, the human should decide
   whether to scope a small test-addition task (mirroring TASK-008's own
   creation ahead of this split) before approving TASK-025, or accept the
   manual-smoke-test-only validation path for these specific gaps.

2. **Geo-distance helper placement** (`_haversineMeters`, `_getOwnLatLon`,
   `_recalcAllDistances`): TASK-025 explicitly leaves this open ("stay with
   node-persistence, or move to TASK-016's shared utilities if genuinely
   general-purpose — decide during implementation"). This contract does not
   resolve it. Note for whoever decides: `_getOwnLatLon` depends on the
   `devices` map (an MqttGateway-specific concept, not general-purpose), so
   only `_haversineMeters` (a pure lat/lon-in, metres-out function) is a
   plausible `packages/shared` candidate; `_getOwnLatLon` and
   `_recalcAllDistances` are gateway-specific regardless of where
   `_haversineMeters` ends up.

3. **`mqtt_json_packets` insert ownership**: this contract recommends leaving
   the `mqtt_json_packets` insert in inbound handling rather than moving it
   into node persistence, since it's an append-only packet log rather than a
   node-identity upsert (see Module boundary definitions). This has no
   observable effect either way and is implementer/human discretion, not a
   blocking decision.
