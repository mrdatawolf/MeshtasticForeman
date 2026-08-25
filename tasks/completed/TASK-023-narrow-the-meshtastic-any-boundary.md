# TASK-023: Narrow the Meshtastic `any` boundary

Owner role: Implementer
Assigned agent: openai-coder
Proposed by: jarvis
Proposed date: 2026-08-24
Approved by: Patrick
Approved date: 08/24/26
Related contracts: **CONTRACT-005 recommended** (ambiguous/high-risk per change-classification.md — malformed-payload handling at a third-party protocol boundary needs explicit failure-behavior definition)
Related ADRs: None
Dependencies: None (deliberately sequenced *before* TASK-024, reversing the roadmap's listed bullet order — see rationale below)

## Desired outcome

The third-party Meshtastic event boundary accepts `unknown`, not `any`; a Meshtastic adapter layer normalizes/validates payloads; the rest of the daemon receives repository-owned typed objects.

## Context

Confirmed `any`-typed boundaries in `device-manager.ts`: `meshDevice.events.onNodeInfoPacket.subscribe((nodeInfo: any) => ...)` (line 166), `onPositionPacket.subscribe((pkt: any) => ...)` (line 173), `onTelemetryPacket.subscribe((pkt: any) => ...)` (line 262), and the corresponding handler signatures `_handleNodeInfo(deviceId: string, nodeInfo: any)` (line 975) and `_handleTelemetry(deviceId: string, name: string, pkt: any)` (line 1283). I'm recommending this run *before* TASK-024 (DeviceManager reduction) — extracting handlers from typed events the first time avoids extracting them with `any` and retyping immediately after; this reverses the roadmap's listed bullet order, flagging that explicitly as my own sequencing judgment for your review.

## Scope

### Included

A Meshtastic adapter layer (new module, e.g. `device/meshtastic-adapter.ts`) that accepts `unknown` at each of the `any`-typed subscription boundaries above, validates/normalizes the payload, and produces typed, repository-owned objects; updating `_handleNodeInfo`/`_handleTelemetry` and the `onPositionPacket` handler to consume the typed output instead of `any`.

### Excluded

Any change to what data is extracted or how it's persisted — same information flows through, just with type safety at the boundary. `_handleMessage`'s `Types.PacketMetadata<string>` typing (already reasonably typed) is out of scope unless it also has hidden `any` leakage discovered during implementation.

## Plan

1) Enumerate every `any`-typed boundary in `device-manager.ts` (confirmed list above; verify completeness via a repo-wide search for `: any` in the device/mqtt boundary code). 2) Design the adapter layer's normalization/validation approach (Zod schemas, matching the daemon's existing pattern in `db/migrations.ts`/`ws-protocol.ts`, or manual guards — propose to you if there's a real choice here). 3) Implement adapters for node-info, position, and telemetry payloads. 4) Update consuming handlers to use the typed output. 5) Add tests for malformed/unexpected-shape payloads hitting the adapter (should fail gracefully, not crash the daemon or silently corrupt persisted data).

## Acceptance criteria

- [ ] No `any`-typed parameters remain at the `onNodeInfoPacket`, `onPositionPacket`, or `onTelemetryPacket` subscription boundaries.
- [ ] A Meshtastic adapter layer validates/normalizes payloads before they reach `_handleNodeInfo`/`_handleTelemetry`/position handling.
- [ ] Malformed or unexpected-shape payloads are handled gracefully (logged/rejected) rather than crashing the daemon or producing corrupted persisted records.
- [ ] `device-manager.test.ts` continues to pass unchanged (or with additions only, not modifications that weaken existing coverage).

## Validation requirements

New tests specifically for malformed-payload handling at each adapted boundary; full `device-manager.test.ts` suite; manual smoke test against a real or simulated device if available.

## Risks and assumptions

Assumes the underlying `@meshtastic/core` library's actual runtime payload shapes are stable enough to validate against confidently — if the library's types are themselves unreliable, flag that as a discovered risk during implementation rather than working around it silently.

## Blocker

None.

## Implementation handoff

Implemented and committed (6e73133, 2026-08-24). Board entry was stale
("Not started") relative to git history; corrected 2026-08-25.

### Changes made

- Added `device/meshtastic-adapter.ts`: a Zod-based adapter validating and
  normalizing the three previously-`any`-typed Meshtastic subscription
  boundaries in `device-manager.ts` (`onNodeInfoPacket`, `onPositionPacket`,
  `onTelemetryPacket`), per CONTRACT-005. Malformed payloads are dropped with
  a single `console.warn` and never reach the handlers or a DB write.
- Resolved a contradiction found in CONTRACT-005 during implementation (its
  Required-behavior section and Validation-requirements checklist disagreed
  on whether a payload missing `data` entirely should be sparse/accepted or
  malformed/rejected for position and telemetry): both boundaries now
  reject-with-warning consistently; `telemetrySchema.data` is no longer
  optional. CONTRACT-005 was updated to record the resolution.

### Validation performed

- `tsc --noEmit`: clean.
- ESLint: clean.
- Full daemon suite: 182/182 passing (pnpm@11.21.0 / Node 24.16.0).

## Review

Not reviewed.

## Human acceptance

Pending.
