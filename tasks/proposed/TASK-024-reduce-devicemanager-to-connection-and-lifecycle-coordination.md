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

Not started.

## Review

Not reviewed.

## Human acceptance

Pending.
