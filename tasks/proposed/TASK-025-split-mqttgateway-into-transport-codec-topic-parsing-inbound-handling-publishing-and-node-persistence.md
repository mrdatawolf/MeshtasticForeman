# TASK-025: Split MqttGateway into transport, codec, topic parsing, inbound handling, publishing, and node persistence

Owner role: Implementer
Assigned agent: openai-coder
Proposed by: jarvis
Proposed date: 2026-08-24
Approved by:
Approved date:
Related contracts: **CONTRACT-006 recommended** (explicitly the kind of change-classification.md flags — protocol boundary, externally consumed via the public `mqtt.meshtastic.org` broker, high-risk given encryption correctness)
Related ADRs: None
Dependencies: **TASK-008 (hard blocker — MQTT gateway tests must exist first, same test-before-refactor pattern as TASK-007→TASK-012).**

## Desired outcome

`MqttGateway` (960 lines) is split into transport, codec (encrypt/decrypt), topic parsing, inbound packet handling, publishing, and node-persistence responsibilities.

## Context

Confirmed structure: `class MqttGateway extends EventEmitter` (line 75) holding `mqtt.MqttClient`, a `Map<string, DeviceState>`; methods `_handleMeshPacket`, `_publishSelf`, `_publishMapReport`, `_handleInbound`, `_upsertFromData`, `_emitNodeUpdate`, `_handleJsonInbound`, `_expandPsk`, `_decrypt`, `_encrypt`, plus geo-distance helpers (`_haversineMeters`, `_getOwnLatLon`, `_recalcAllDistances`). This is a public-map-facing component — a bug here can publish incorrect or malformed data to `mqtt.meshtastic.org`, affecting other operators' view of the mesh, which is why the contract recommendation is strong here.

## Scope

### Included

Transport module (raw MQTT client connect/subscribe/publish); codec module (`_expandPsk`/`_encrypt`/`_decrypt`); topic-parsing module (the logic inside `_handleInbound` that extracts channel/gateway/region from topic strings, including the documented double-slash edge case); inbound packet handling (`_handleInbound`, `_handleJsonInbound`, `_upsertFromData`); publishing (`_handleMeshPacket`, `_publishSelf`, `_publishMapReport`); node-persistence (`_emitNodeUpdate` and related DB writes). Geo-distance helpers can stay with whichever module owns node-persistence, or move to TASK-016's shared utilities if genuinely general-purpose — decide during implementation.

### Excluded

Any change to the wire protocol, encryption scheme, or topic structure — this must be a pure structural split, verified against TASK-008's characterization tests.

## Plan

1) Confirm TASK-008's tests pass against current `gateway.ts` behavior. 2) Extract the codec module (`_expandPsk`/`_encrypt`/`_decrypt`) first — smallest, most self-contained, easiest to verify against TASK-008's round-trip tests. 3) Extract topic parsing next, verified against TASK-008's topic-string test table. 4) Extract the transport module (raw `mqtt.MqttClient` wrapper). 5) Extract inbound handling, wiring it to the new codec/topic-parsing modules. 6) Extract publishing. 7) Extract node persistence. 8) Reduce `MqttGateway` to orchestrating these modules. 9) Re-run TASK-008's full suite unchanged against the split implementation.

## Acceptance criteria

- [ ] Transport, codec, topic parsing, inbound handling, publishing, and node persistence are each separate modules.
- [ ] TASK-008's characterization test suite passes unchanged against the split implementation.
- [ ] No change to published MQTT topic structure, payload encoding, or encryption behavior (verified against real or recorded broker traffic if feasible, otherwise against TASK-008's fixtures).
- [ ] CONTRACT-006 (if approved) accurately describes the resulting module boundaries and their observable behavior.

## Validation requirements

TASK-008's full test suite; ideally a manual smoke test against the real `mqtt.meshtastic.org` broker in a non-production/test configuration to confirm published packets are still well-formed, given this affects a public shared resource. Recommend QualityAssurance review before acceptance.

## Risks and assumptions

Second of the two highest-protocol-risk tasks in the roadmap (alongside TASK-024). A subtle encryption or topic-structure regression here doesn't just break this daemon — it publishes incorrect data to a public map other operators rely on.

## Blocker

None.

## Implementation handoff

Not started.

## Review

Not reviewed.

## Human acceptance

Pending.
