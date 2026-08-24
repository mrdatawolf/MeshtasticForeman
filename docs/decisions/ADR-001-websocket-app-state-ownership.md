# ADR-001: WebSocket/App state ownership

Status: Proposed
Date: 2026-08-24
Decision owners:
Related tasks and contracts: TASK-017 (blocked until this ADR is approved)

## Context

`App.tsx` (1118 lines) currently owns devices, mesh nodes, MQTT nodes,
activity, logs, and configuration state via ad hoc `useState` calls, and
dispatches incoming `ServerEvent`s through a chain of `if (event.type === "...")`
checks (13+ branches) rather than an exhaustive construct. `docs/ROADMAP.md`
Stage 4 asks to move this state out of `App.tsx` into "a reducer or a small
dedicated store" and make event handling exhaustive, but leaves the choice
between those two approaches open — a real architectural decision with
alternatives and consequences, not a detail an implementer should settle
unilaterally.

This decision was originally listed under Stage 6 ("record an ADR for
WebSocket state ownership" as retrospective documentation). Jarvis's roadmap
decomposition recommended pulling it forward to block TASK-017 instead,
since Stage 4 needs the decision made before implementation, not documented
after the fact.

## Decision

Not yet made. Pending human review of the alternatives below.

## Alternatives considered

- **A React reducer** (`useReducer`) co-located with `App.tsx` or a context
  provider. Keeps the dependency footprint at zero, fits idiomatic React data
  flow, and pairs naturally with an exhaustive `switch` over `ServerEvent`
  types with a `never`-check default arm.
- **A small dedicated store** (e.g. a hand-rolled subscribable store, or a
  minimal library such as Zustand). Decouples state from the React tree,
  can be read outside components if ever needed, and may reduce re-render
  scope compared to a single top-level reducer feeding a large context.

## Consequences

### Benefits

To be recorded once a direction is chosen.

### Costs and risks

To be recorded once a direction is chosen. Either choice touches state
consumed by every page (Nodes, Map, Messages, Analytics, Activity, Logs,
Device Config) — TASK-017's acceptance criteria require a full manual
regression pass across all of them regardless of which direction is taken.

## Follow-up work

TASK-017 (move daemon-derived state out of `App.tsx`) is blocked until this
ADR is approved. TASK-018 (split the application shell into components)
depends on TASK-017 landing first so new components are built against the
final state shape.
