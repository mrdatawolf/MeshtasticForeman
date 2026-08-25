# CONTRACT-005: Meshtastic Payload Adapter Behavior

Status: Proposed
Approved by:
Approved date:
Related tasks: TASK-023

## Purpose

`packages/daemon/src/device/device-manager.ts` subscribes to three
`@meshtastic/core` `MeshDevice` events — `onNodeInfoPacket`,
`onPositionPacket`, and `onTelemetryPacket` — with `any`-typed callback
parameters, and forwards those values unchecked into `_handleNodeInfo`,
`_handlePosition`, and `_handleTelemetry`, which write directly to the
`nodes` and `position_history` tables and emit `node:update`/`device:status`
`ServerEvent`s to every connected frontend. TASK-023 replaces the `any`
boundary with `unknown`, introducing a new Meshtastic adapter layer that
validates/normalizes each payload before it reaches those handlers. No
validation exists at this boundary today — the handlers currently trust
whatever the SDK hands them, defaulting missing/nullish fields with `??`
without ever rejecting a structurally wrong payload. This contract defines
the **new** failure behavior TASK-023 must implement for malformed or
unexpected-shape payloads at this boundary: it is not a characterization of
existing behavior, because today there is no failure path to characterize —
a structurally broken payload either silently produces `NaN`/`null` data or
throws inside the handler and is swallowed by the existing
`.catch((err) => console.error(...))` wrapper at each subscription site.

## Scope

### Included

- The three subscription boundaries in `device-manager.ts`, current line
  numbers as of this writing (re-verify at implementation time; TASK-023's
  own citations are already stale):
  - `onNodeInfoPacket.subscribe(...)` — line 178, feeding `_handleNodeInfo`
    (line 1036).
  - `onPositionPacket.subscribe(...)` — line 185, feeding `_handlePosition`
    (line 1119).
  - `onTelemetryPacket.subscribe(...)` — line 280, feeding `_handleTelemetry`
    (line 1359).
- The adapter layer's validation/normalization contract: what counts as a
  valid payload for each of the three event types, what "malformed" means,
  and what observably happens when a payload fails validation.
- The typed shape each adapter must hand to its downstream handler.
- Confirmation that `_handleNodeInfo`, `_handlePosition`, and
  `_handleTelemetry`'s existing internal logic (DB writes, `ServerEvent`
  construction, the sparse-update/COALESCE semantics) is unchanged in
  observable effect — only the type/validity of what reaches them changes.

### Excluded

- `onMeshPacket`, `onFromRadio`, `onQueueStatus`, `onTraceRoutePacket`,
  `onDeviceMetadataPacket`, `onConfigPacket`, `onModuleConfigPacket`,
  `onChannelPacket`, `onMyNodeInfo` — all still `any`-typed in
  `device-manager.ts` today, but out of TASK-023's stated scope and
  therefore out of this contract's scope.
- `onMessagePacket` (`Types.PacketMetadata<string>`) and its handler
  `_handleMessage` — already reasonably typed per TASK-023's own Excluded
  section, unless implementation discovers hidden `any` leakage inside it
  (in which case that is a new finding to bring back to the human, not
  something this contract pre-authorizes covering).
- Any change to *what* data is extracted from a valid payload, how it is
  persisted, or the shape/content of the `ServerEvent`s emitted for valid
  input. Same information flows through; only the boundary's type-safety and
  its behavior on invalid input are new.
- Retry, backoff, or device-disconnect logic triggered by malformed
  payloads. A malformed payload is not evidence of a dead connection; this
  contract does not authorize treating it as one.
- Validating `PacketMetadata`'s own envelope fields (`id`, `type`, `to`,
  `channel`) beyond what each handler already reads (`from`, `data`,
  `rxTime`) — the adapter validates what the handlers actually consume, not
  the full SDK type.

## Actors

- **`@meshtastic/core` `MeshDevice` event dispatchers**: the untrusted
  counterparty. Values arrive already deserialized from the device's
  protobuf wire format by the SDK; this boundary is the first point in the
  daemon's own code that sees them.
- **New Meshtastic adapter module** (e.g. `device/meshtastic-adapter.ts`,
  per TASK-023's suggested naming — not mandated by this contract): the
  actor whose behavior this contract defines.
- **`DeviceManager`**: the adapter's only caller; owns the subscription
  callbacks and the downstream handlers (`_handleNodeInfo`,
  `_handlePosition`, `_handleTelemetry`).
- **Human operator**: indirectly affected — sees adapter rejections via the
  daemon's existing console-log-to-frontend pipeline (`activity/console-log.ts`,
  which mirrors `console.warn`/`console.error` into `log:entry`/`log:snapshot`
  `ServerEvent`s already rendered in the web UI's log view). No new UI
  surface is introduced by this contract.

## Inputs and outputs

- **Input to each adapter function**: `unknown` — the raw value handed to
  the subscription callback by the SDK, with no assumed shape.
- **Output on success**: a typed, repository-owned object (see Interfaces)
  containing only the fields the corresponding handler actually reads today,
  handed to that handler in place of its current `any` parameter.
- **Output on failure (malformed/unexpected-shape input)**: no typed object
  is produced. The packet is dropped — it does not reach
  `_handleNodeInfo`/`_handlePosition`/`_handleTelemetry`, no DB write occurs,
  and no `ServerEvent` is emitted for it. See Failure behavior for the exact
  observability requirement and the open question on drop mechanism (throw
  vs. return-and-skip).

## Preconditions

- The adapter functions are called only from the three subscription sites
  above, once per SDK-dispatched event, in the same synchronous position
  the current `any`-typed callback occupies (i.e., adaptation happens before
  the existing `.catch((err) => ...)`-wrapped async handler call, not inside
  it — see Open questions on whether adaptation itself is synchronous or is
  allowed to throw into that existing catch).
- No precondition on the SDK's declared TypeScript types being accurate;
  the adapter must not assume `@meshtastic/core`'s compile-time types
  describe the runtime shape faithfully (see Open questions — this is a
  named risk in TASK-023 itself, not one this contract can resolve without
  human input).

## Required behavior

### What "valid" means for each boundary, grounded in current handler usage

The adapter's validation surface should be exactly the set of fields each
handler currently dereferences, no more — this is what "narrowing the `any`
boundary" means: making today's implicit trust explicit and checked, not
expanding what data is required or extracted (excluded per TASK-023's own
scope). Current field usage, confirmed by reading the handlers:

- **`onNodeInfoPacket` → `_handleNodeInfo(deviceId, nodeInfo)`**
  (`Protobuf.Mesh.NodeInfo`, dispatched directly — *not*
  `PacketMetadata`-wrapped, confirmed against `@meshtastic/core`'s own
  `mod.d.ts`). Handler reads: `num` (number, required — `nodeId === 0` is
  already today's "nothing to do" early-return, confirmed by
  `device-manager.test.ts`'s "UPSERT" test dispatching `{ num: 12345, snr:
  8.0 }` with **no `user`, `lastHeard`, `hopsAway`, or `position` at all**
  and expecting a successful partial upsert); `user.macaddr` (`Uint8Array`,
  optional); `user.publicKey` (`Uint8Array`, optional); `user.longName`,
  `user.shortName` (string, optional); `user.hwModel` (number, optional);
  `lastHeard` (number, optional, `0`/absent treated as "unknown"); `snr`
  (number, optional, falsy treated as "unknown" — code uses `n.snr ||
  null`); `hopsAway` (number, optional).
- **`onPositionPacket` → `_handlePosition(deviceId, pkt)`**
  (`PacketMetadata<Protobuf.Mesh.Position>`). Handler reads: `pkt.from`
  (number, required — `0`/absent is today's early-return); `pkt.data`
  (object, required — falsy `pkt.data` is today's early-return, confirmed
  by the code's own `if (!pos) return;`); `pkt.data.latitudeI`,
  `pkt.data.longitudeI` (number, required — handler already treats
  missing/`(0,0)` as "no fix" and returns without writing); `pkt.data.altitude`,
  `pkt.data.groundSpeed`, `pkt.data.groundTrack`, `pkt.data.satsInView`
  (number, optional); `pkt.rxTime` (`Date`, optional — handler already
  falls back to `new Date()` if not a `Date` instance).
- **`onTelemetryPacket` → `_handleTelemetry(deviceId, name, pkt)`**
  (`PacketMetadata<Protobuf.Telemetry.Telemetry>`). Handler reads:
  `pkt.data.variant.case` (string, required to equal `"deviceMetrics"` — any
  other value or absence is today's early-return, not an error);
  `pkt.data.variant.value.batteryLevel` (number, required — `null`/`0` is
  today's early-return); `pkt.from` (number, optional, `?? 0`).

**Critical distinction the adapter must preserve**: a *sparse* payload
(missing optional fields, or a `variant.case` other than `"deviceMetrics"`,
or a zero/absent numeric identifier) is **normal, expected input under
today's handler logic**, not malformed input — the handlers already treat
absence of optional data as "nothing to update" and return early without
error. The adapter must not reject payloads the current handlers already
accept and process successfully; doing so would be new behavior TASK-023's
own scope excludes ("no change to what data is extracted"). "Malformed"
under this contract means: the payload is not an object at all (`null`,
primitive, array where an object is expected); a field the handler treats as
required is present but of the wrong type (e.g. `num` is a string, `data` is
a string instead of an object); or a `Uint8Array`-typed field is present but
not actually byte-array-like. The `device-manager.test.ts` "UPSERT" case
above (`{ num: 12345, snr: 8.0 }`) and any position/telemetry payload that
merely omits optional fields **must** continue to validate successfully.

### Validation/normalization approach

Per TASK-023's own instruction, the choice between a Zod-schema approach and
manual type guards is a real design fork left to the human — see Open
questions. This contract does establish the following regardless of which
approach is chosen:

- The daemon already has two internal precedents for input validation, and
  they are **not** the same idiom: `packages/daemon/src/config.ts` uses Zod
  schemas with `.transform()` to turn untrusted `process.env` strings into a
  typed `DaemonConfig`, and `packages/shared/src/ws-protocol.ts` uses Zod
  discriminated-union schemas to validate untrusted WebSocket client
  commands before they reach any handler. **`db/migrations.ts` does not use
  Zod and is not a validation-pattern precedent** — it is a plain
  SQL-migration array with no runtime input validation; it should not be
  cited alongside `config.ts`/`ws-protocol.ts` as evidence for the Zod
  convention (flagging this since TASK-023's own plan step 2 names it as
  one of two files establishing "the daemon's existing pattern," and the
  premise doesn't hold for that file).
- `ws-protocol.ts`'s pattern is the closer analog: like the Meshtastic
  boundary, it validates **untrusted external input arriving as `unknown`**
  before any handler runs, as opposed to `config.ts`'s narrower job of
  parsing string environment variables. If Zod is chosen, `ws-protocol.ts`
  is the more directly comparable precedent to follow (e.g., `z.object()`
  with `.optional()` fields matching the sparse-input tolerance above, not
  `.strict()`), and any deviation from that idiom should be justified.
- `zod` is already a direct dependency of `@foreman/daemon` (used in
  `config.ts`), so a Zod-based adapter introduces no new dependency.
- Regardless of approach, the adapter must not treat `@meshtastic/core`'s
  own declared TypeScript types (`Protobuf.Mesh.NodeInfo`,
  `Protobuf.Mesh.Position`, `Protobuf.Telemetry.Telemetry`) as sufficient
  proof of runtime validity — those types describe what the SDK's authors
  intend to dispatch, not what this contract requires be checked at the
  boundary. Existing code in this same file (`_handleConfigPacket`'s and
  `_handleChannelPacket`'s comments: "SDK dispatches the ... object
  directly," contradicting what the declared dispatcher type would suggest)
  is direct in-repo evidence that this SDK's actual runtime dispatch shape
  has previously diverged from what a naive read of its types would imply.

## Postconditions and invariants

- A payload that fails adapter validation **never** reaches
  `_handleNodeInfo`, `_handlePosition`, or `_handleTelemetry` — no DB write,
  no `ServerEvent` emission, no mutation of `DeviceManager`'s in-memory
  state (`myNodeIds`, `batteryLevels`, `gpsAcquired`, `gpsDetails`) occurs
  for that payload.
- A payload that passes adapter validation reaches its handler with an
  observable effect **identical** to today's effect for the equivalent
  well-formed input — the adapter changes what is checked at the boundary,
  not what a valid payload causes to happen downstream.
- Processing of the next dispatched event on the same or a different
  subscription is never blocked, delayed, or skipped as a result of a prior
  payload failing validation. Each event is independent.
- The daemon process does not crash, and no already-persisted row is
  corrupted or partially written, as a direct result of a malformed
  payload at any of the three boundaries. This is TASK-023's own explicit
  acceptance criterion and is treated here as a hard invariant: validation
  failure must be fully contained before any `db.query`/`db.exec` call is
  reached for that payload — partial writes are prevented by rejecting
  before persistence is attempted, not by any transactional rollback (none
  of the three handlers currently wrap their writes in a `transaction()`
  call, and this contract does not require adding one).

## Failure behavior

- **What "handled gracefully" means, concretely**: the malformed payload is
  dropped (not persisted, not emitted as a `ServerEvent`), and exactly one
  `console.warn` (not `console.error` — this is an expected-and-handled
  input-validation rejection, not an unexpected internal fault) is logged
  per rejected payload, tagged consistently with the file's existing `[devices]`
  prefix convention (e.g. `` `[devices] rejected malformed nodeInfo packet: ${reason}` ``),
  so that it is grep-able and attributable to this boundary.
- **This automatically satisfies "surfaced somewhere observable" without new
  UI work**: `packages/daemon/src/activity/console-log.ts` already
  monkey-patches `console.warn`/`console.error` to mirror every call into
  the `ConsoleLog` ring buffer, which the daemon already broadcasts to every
  connected frontend as `log:entry`/`log:snapshot` `ServerEvent`s and
  renders in the web UI's existing log view. A malformed-payload rejection
  is therefore visible to a human operator today's log view, with no new
  contract obligation to add a dedicated UI surface, metric, or alert.
- **Must not crash the daemon**: validation failure must be caught and
  converted to the drop-and-log behavior above before it can propagate as
  an uncaught exception or an unhandled promise rejection. Note the
  subscription sites already wrap their async handler calls in
  `.catch((err) => console.error(...))` — if the adapter runs
  synchronously inside the subscription callback (see Open questions) and
  throws, that throw happens **outside** the existing `.catch`, since the
  `.catch` only wraps the handler's returned promise, not the adapter call
  that constructs its arguments. This means: if the chosen implementation
  has the adapter throw on invalid input, the subscription callback itself
  must wrap the adapter call in its own `try`/`catch` (or the adapter must
  never throw, returning a sentinel instead) — a naive "just call the
  adapter, then call the handler" edit that leaves the adapter's throw
  unguarded would violate this contract's crash-safety requirement even
  though it looks superficially like "the same pattern as before."
- **Must not corrupt persisted data**: satisfied structurally by rejecting
  before any `db.query`/`db.exec` call for that payload is reached (see
  Postconditions). No handler performs a multi-statement write for a single
  incoming event where a partial adapter failure mid-write is possible
  today, so this contract does not require new transactional guarding
  beyond "reject before the first write."
- **Silent drop vs. any user-facing rejection indicator**: this contract
  requires only the `console.warn` above (surfaced via the existing log
  pipeline). It does not require a dedicated `ServerEvent` (e.g. a
  `type: "error"` payload) announcing the rejection to the frontend, since
  no such per-packet error channel exists for this boundary today and
  inventing one would exceed TASK-023's stated scope (adapting the
  boundary, not adding new user-facing error UX). If the human wants a more
  visible signal than the log view, that is a new decision, not one this
  contract makes.

## Interfaces

Proposed shapes reflecting exactly the fields each handler currently reads
(see Required behavior). These are illustrative of the required *output*
contract, not a mandate on internal adapter implementation:

```ts
// device/meshtastic-adapter.ts (illustrative — module name/location per
// TASK-023's own suggestion, not mandated here)

export interface AdaptedNodeInfo {
  num: number;
  lastHeard?: number;
  snr?: number;
  hopsAway?: number;
  user?: {
    longName?: string;
    shortName?: string;
    macaddr?: Uint8Array;
    hwModel?: number;
    publicKey?: Uint8Array;
  };
}

export interface AdaptedPosition {
  from: number;
  rxTime?: Date;
  data: {
    latitudeI: number;
    longitudeI: number;
    altitude?: number;
    groundSpeed?: number;
    groundTrack?: number;
    satsInView?: number;
  };
}

export interface AdaptedTelemetry {
  from?: number;
  data: {
    variant: { case: string; value?: { batteryLevel?: number } };
  };
}

// Return-and-skip form (one design option — see Open questions):
export function adaptNodeInfo(raw: unknown): AdaptedNodeInfo | null;
export function adaptPosition(raw: unknown): AdaptedPosition | null;
export function adaptTelemetry(raw: unknown): AdaptedTelemetry | null;
```

Updated handler signatures (replacing `any`):

```ts
private async _handleNodeInfo(deviceId: string, nodeInfo: AdaptedNodeInfo): Promise<void>;
private async _handlePosition(deviceId: string, pkt: AdaptedPosition): Promise<void>;
private async _handleTelemetry(deviceId: string, name: string, pkt: AdaptedTelemetry): Promise<void>;
```

## UX expectations

N/A directly — this is an internal daemon boundary. The only human-visible
effect is the existing log view surfacing the `console.warn` rejection
message described in Failure behavior; no new frontend component, toast, or
indicator is required or authorized by this contract.

## Validation requirements

- All existing `device-manager.test.ts` cases in the "node info handling
  (onNodeInfoPacket)" `describe` block (lines 447–566) must continue to pass
  unmodified, including the sparse-payload "UPSERT" case
  (`{ num: 12345, snr: 8.0 }`) and the position-conversion case that
  dispatches a minimal `{ from, data: { latitudeI, longitudeI, altitude } }`
  object with no `rxTime`/optional fields (lines 486–505) — both are
  existing evidence that sparse-but-well-typed input is accepted, not
  malformed.
- New tests required (per TASK-023's plan step 5), at minimum one
  malformed-input case per boundary:
  - `onNodeInfoPacket`: a dispatched value that is not an object (e.g. a
    string or `null`), and one with `num` present but non-numeric.
  - `onPositionPacket`: a dispatched value missing `data` entirely, and one
    where `data.latitudeI`/`data.longitudeI` are non-numeric.
  - `onTelemetryPacket`: a dispatched value missing `data` entirely, and one
    where `data.variant` is present but `value.batteryLevel` is
    non-numeric.
  - Each case must assert: no row is written/updated, no `node:update` /
    `device:status` event is emitted, the daemon does not throw an
    uncaught exception (the test itself does not crash), and (if
    feasible to assert against a captured `console.warn`) that a rejection
    is logged.
- Full `device-manager.test.ts` suite must continue to pass, per TASK-023's
  own acceptance criteria.
- Manual smoke test against a real or simulated device, per TASK-023's own
  validation requirements — this contract adds no additional manual step
  beyond what TASK-023 already specifies.

## Open questions

1. **Zod schemas vs. manual type guards.** This is the design fork
   TASK-023 explicitly reserves for human review. Given the daemon's
   existing `ws-protocol.ts` precedent (Zod, untrusted-`unknown`-input,
   `.optional()`-tolerant schemas) and `zod` already being a daemon
   dependency, this contract recommends Zod for consistency, but does not
   mandate it — manual type guards would satisfy every requirement above
   equally well and may be preferable given the SDK type-reliability
   concern in question 3. The human should decide.
2. **Throw-and-catch vs. return-null-and-skip at the adapter's own API
   boundary.** Two implementation shapes both satisfy this contract's
   crash-safety requirement: (a) the adapter throws a descriptive error on
   invalid input, and the subscription callback wraps the adapter call in
   its own `try`/`catch` before invoking the handler; or (b) the adapter
   never throws and instead returns `null`/a discriminated result, and the
   subscription callback checks for that before calling the handler. Zod's
   `safeParse()` naturally produces option (b); a hand-rolled guard could go
   either way. This contract requires the *outcome* (drop, log, no crash)
   but leaves this mechanical choice to the implementer, flagged here only
   so it isn't overlooked given the `.catch()`-placement subtlety described
   in Failure behavior.
3. **SDK type reliability, as TASK-023's own stated risk.** This contract's
   drafting found direct in-repo evidence (`_handleConfigPacket`'s and
   `_handleChannelPacket`'s comments about the SDK dispatching objects
   differently than their declared types suggest) that `@meshtastic/core`'s
   compile-time types have already diverged from observed runtime shape at
   least twice in this same file, for boundaries adjacent to (though not
   identical to) the three in scope here. This contract's validation rules
   in Required behavior are grounded in what the three in-scope handlers
   currently read successfully in practice (confirmed via the SDK's
   `mod.d.ts` and the existing test fixtures), not solely the SDK's
   declared types, precisely because of this risk. Flagging per TASK-023's
   own instruction: if implementation discovers the SDK's real-world
   `onNodeInfoPacket`/`onPositionPacket`/`onTelemetryPacket` dispatch shape
   diverges from `mod.d.ts` in a way that would make validation reject
   payloads the current handlers accept in production, that is new
   information for the human, not something to silently work around by
   loosening validation past what this contract specifies.
4. **`console.warn` vs. a lower-noise mechanism for high-frequency
   boundaries.** `onPositionPacket` and `onTelemetryPacket` can fire
   frequently on a busy mesh. This contract requires one `console.warn` per
   rejected payload with no rate-limiting/dedup, matching the file's
   existing per-event logging density elsewhere (e.g. `onTraceRoutePacket`,
   `_handleRawPacket` both log unconditionally per event). If malformed
   payloads turn out to be frequent enough in practice to flood the log
   view, that would be a follow-up tuning concern, not something this
   contract pre-emptively solves with unrequested rate-limiting logic.
