# TASK-024: Reduce DeviceManager to connection and lifecycle coordination

Owner role: Implementer
Assigned agent: openai-coder
Proposed by: jarvis
Proposed date: 2026-08-24
Approved by:
Approved date:
Related contracts: **CONTRACT-004 recommended** (explicitly the kind of large/cross-cutting/high-risk change-classification.md calls for a contract on — this is the daemon's core device-control surface)
Related ADRs: None
Dependencies: **TASK-023 (hard blocker per the sequencing rationale above — extract handlers using the now-typed adapter output, not `any`).**

## Desired outcome

`DeviceManager` (1332 lines) is reduced to connection and lifecycle coordination; message handling, node updates, raw packet persistence, configuration, telemetry, bot commands, and traceroutes are extracted into services/handlers with explicit dependency injection so they're testable without a physical radio.

## Context

Confirmed `DeviceManager extends EventEmitter` (line 33) with private methods `_handleMessage`, `_handleBotCommand`, `_handleNodeInfo`, `_handleTelemetry` and comment-documented cross-handler coordination (e.g. the packetId→replyId correlation comment at line 54, and the ordering-dependency comment at lines 772–774 about `onMeshPacket` firing before `onMessagePacket`). `device-manager.test.ts` already exists and mocks `TransportNodeSerial`/`MeshDevice` — this existing coverage is a starting point, but confirm during implementation whether it exercises the telemetry, bot-command, and traceroute paths deeply enough before extracting them; if not, extend it as a first step of this task rather than as a separate task.

## Scope

### Included

Extracting message handling (`_handleMessage`, `_handleBotCommand`), node-update handling (`_handleNodeInfo`), raw-packet persistence, configuration handling, telemetry handling (`_handleTelemetry`), and traceroute handling into separate services/handler modules, each receiving its dependencies (DB, event emitter, config) explicitly rather than reaching into `DeviceManager` internals; `DeviceManager` itself retains connect/disconnect/reconnect/lifecycle coordination and delegates to the extracted handlers.

### Excluded

Any change to observable device behavior, event payloads, or persisted data shape — this is a structural extraction governed by CONTRACT-004 to make that explicit and reviewable.

## Plan

1) Review `device-manager.test.ts`'s existing coverage against the seven areas being extracted; extend coverage for any gap found (particularly telemetry, bot commands, traceroutes) before extracting that area, so extraction is provably behavior-preserving. 2) Extract raw packet persistence first (likely lowest cross-coupling). 3) Extract node-update handling. 4) Extract telemetry handling. 5) Extract configuration handling. 6) Extract message handling and bot commands together (given their documented packetId/replyId coordination dependency — do not split these two apart from each other without preserving that ordering guarantee explicitly). 7) Extract traceroute handling. 8) Confirm `DeviceManager` is reduced to lifecycle/coordination only, delegating to the extracted handlers.

## Acceptance criteria

- [ ] `DeviceManager` no longer contains message handling, node-update handling, raw-packet persistence, configuration handling, telemetry handling, bot-command handling, or traceroute handling directly — it coordinates extracted handlers.
- [ ] Each extracted handler receives its dependencies explicitly (constructor/parameter injection) and can be unit tested without a physical or simulated radio connection beyond what the existing mock pattern already provides.
- [ ] The documented packetId→replyId correlation between message and bot-command handling is preserved exactly (the ordering comment at lines 772–774 reflects a real invariant, not an implementation accident — confirm this explicitly during extraction).
- [ ] `device-manager.test.ts` (extended per the plan above) passes against the refactored implementation with no weakened assertions.
- [ ] CONTRACT-004 (if approved) accurately describes the resulting public API/event surface.

## Validation requirements

Full `device-manager.test.ts` suite; manual/simulated smoke test of message send/receive, bot commands (`!ping`, `!nodes`, `!status`, `!help`), telemetry updates, and traceroute requests. Recommend QualityAssurance review before acceptance given this is one of the two highest-risk tasks in the entire roadmap (alongside TASK-012).

## Risks and assumptions

Largest and riskiest daemon-side refactor in the roadmap. The packetId/replyId correlation between `_handleMessage` and `_handleBotCommand` is the single most fragile invariant here — call it out explicitly in CONTRACT-004 rather than letting it become implicit again after extraction.

## Blocker

None.

## Implementation handoff

Implemented 2026-08-25 by openai-coder.

### Changes made

- Extracted raw-packet persistence, node/position updates, telemetry,
  configuration, message/bot handling, and traceroute handling into explicit
  dependency-injected modules under `packages/daemon/src/device/`.
- Kept `batteryLevels`, `gpsAcquired`, `gpsDetails`, `myNodeIds`, and the shared
  `pendingReplyIds` map centrally owned by `DeviceManager`; handlers receive
  narrow getter/setter callbacks and the producer/consumer receive the same map.
- Kept the post-`configure()` config-snapshot trigger in `DeviceManager` so its
  queued passive-config-write ordering remains lifecycle-coordinated; snapshot
  read/emission logic lives in the configuration module.
- Grouped position handling with node updates because both mutate node/position
  state and emit the same `node:update` projection.
- Named the traceroute module `traceroute-handler.ts` and entry point
  `handleTraceroutePacket` to mirror the SDK event it handles.
- Added characterization coverage for reply-id correlation, bot commands,
  telemetry filters/change semantics, configuration paths, and traceroutes.

### Validation performed

Command used at every extraction checkpoint:
`pnpm --filter @foreman/daemon test -- device-manager.test.ts` (with Node
v22.22.3 and pnpm 11.21.0). The package script ran all daemon Vitest files.

- Step 2 raw packets: exit 0; 10 files, 183 tests passed.
- Step 3 node/position: exit 0; 10 files, 183 tests passed.
- Step 4 telemetry: exit 0; 10 files, 186 tests passed.
- Step 5 configuration: exit 0; 10 files, 191 tests passed.
- Step 6 message/bot: exit 0; 10 files, 197 tests passed.
- Step 7 traceroute: exit 0; 10 files, 199 tests passed.
- Step 8 final coordination audit: exit 0; 10 files, 199 tests passed.

The packetId/replyId test was present and passing at every step above. Source
order still subscribes `onMessagePacket` before `onMeshPacket`, both on the
same `meshDevice`; the raw handler still writes the shared map synchronously
before its first await, and message handling consumes/deletes the entry.

Final validation:

- `pnpm --filter @foreman/daemon build`: exit 0 (`tsc --noEmit`).
- `pnpm --filter @foreman/daemon lint`: exit 0 (`eslint .`).

### Assumptions and deviations

- Used the installed NVM Node v22.22.3 and Corepack-cached pnpm 11.21.0 because
  the non-interactive shell's default PATH exposed Node v20.19.2 and no `pnpm`.
- No behavioral deviations from CONTRACT-004 were intended or identified.
- No physical/simulated-radio manual smoke test was available; all specified
  paths were exercised through the existing mocked dispatcher pattern.

### Unresolved risks

- This remains a high-risk structural change and should receive the contract's
  recommended independent Quality Assurance review before human acceptance.
- The test dispatcher manually fires `onMeshPacket` immediately before
  `onMessagePacket`; the upstream SDK's internal derivation order is preserved
  structurally but cannot be independently proven by this mocked unit suite.

## Review

Not reviewed.

## Human acceptance

Pending.
