# TASK-029: Add coordinated graceful shutdown

Owner role: Implementer
Assigned agent: openai-coder
Proposed by: jarvis
Proposed date: 2026-08-24
Approved by:
Approved date:
Related contracts: **CONTRACT-008 recommended** (ambiguous/high-risk per change-classification.md — shutdown ordering across many subsystems is exactly the kind of behavior that needs an explicit spec rather than emergent behavior)
Related ADRs: None
Dependencies: TASK-024 (DeviceManager reduced), TASK-025 (MqttGateway split), TASK-012 (consolidated PGlite proxy) — recommended, not strictly required, because each subsystem's shutdown hook is easier to define once that subsystem has clear ownership boundaries; doing this earlier risks rework as Stage 5 splits land

## Desired outcome

Fastify, WebSockets, MQTT, serial devices, background timers, worker threads, and PGlite all shut down in coordinated, deterministic order with no stale resources left behind.

## Context

No coordinated shutdown currently exists per the roadmap's framing; `index.ts` is the entry point where this would be orchestrated.

## Scope

### Included

A shutdown sequence (likely triggered by `SIGTERM`/`SIGINT`) that: stops accepting new HTTP/WS connections, closes existing WS connections cleanly, stops the MQTT gateway (unsubscribe/disconnect), closes serial device connections, clears background timers (e.g. the 15-minute MQTT re-announce timer confirmed in `docs/ARCHITECTURE.md`), terminates the PGlite worker thread cleanly (including releasing `postmaster.pid`, per `clearDbLock()`'s existing logic), and exits.

### Excluded

Health/readiness endpoint semantics (TASK-033) — related but separate.

## Plan

1) Define the exact shutdown order and per-subsystem hook contract (this is CONTRACT-008's content). 2) Implement shutdown handlers for each subsystem, wired to a single coordinator in `index.ts`. 3) Add a shutdown timeout (force-exit if graceful shutdown hangs) to avoid an unkillable process. 4) Test shutdown under normal conditions and under at least one subsystem-hung condition.

## Acceptance criteria

- [ ] `SIGTERM`/`SIGINT` triggers coordinated shutdown of Fastify, WebSocket connections, MQTT gateway, serial devices, background timers, and the PGlite worker, in a defined order.
- [ ] No stale lock files, dangling worker threads, or orphaned serial connections remain after shutdown (verified by process/resource inspection after a shutdown test).
- [ ] A shutdown timeout forces exit if graceful shutdown hangs, rather than leaving the process unkillable.
- [ ] CONTRACT-008 (if approved) defines the exact ordering and per-subsystem guarantees before implementation.

## Validation requirements

Manual shutdown testing: normal shutdown, shutdown mid-request, shutdown with an active serial connection and pending MQTT publishes. Verify no stale `postmaster.pid` or orphaned worker process afterward.

## Risks and assumptions

Recommend implementing after Stage 5's daemon splits land, since each extracted subsystem needs a defined shutdown hook, and it's easier to add those hooks to already-separated modules than to the current monolithic `DeviceManager`/`MqttGateway`.

## Blocker

None.

## Implementation handoff

Not started.

## Review

Not reviewed.

## Human acceptance

Pending.
