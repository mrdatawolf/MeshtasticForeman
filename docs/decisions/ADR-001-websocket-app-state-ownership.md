# ADR-001: WebSocket/App state ownership

Status: Accepted
Date: 2026-08-24
Decision owners: Patrick
Related tasks and contracts: TASK-017 (unblocked by this decision)

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

A plain React `useReducer` (not a dedicated store) owns devices, mesh nodes,
MQTT nodes, activity, logs, and configuration state. The reducer is
co-located with `App.tsx` (or a context provider wrapping it, at TASK-017's
implementation discretion) and dispatches on an exhaustive `switch` over
`ServerEvent["type"]` with a `never`-check default arm, so a new event
variant fails to compile until it's handled or deliberately ignored.
Transient UI state (selected tab, open menu) stays local to the component
that renders it, per the roadmap's original framing — it is not lifted into
the reducer.

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

- Zero new runtime dependencies — `useReducer` is built into React, already
  used throughout this codebase's idioms.
- The exhaustive `switch`/`never`-check pattern is a direct, mechanical fit:
  one `dispatch(event)` call per incoming `ServerEvent`, one `case` per
  variant, compiler-enforced completeness. This was the specific behavior
  TASK-017's acceptance criteria required regardless of which alternative
  was chosen, and a reducer is the more natural vehicle for it than a
  store's typically looser action/subscription surface.
- State stays inside the React tree and its existing render/update model —
  no new mental model (subscriptions, external store snapshots) for anyone
  reading this codebase for the first time.

### Costs and risks

- A single top-level reducer feeding context can cause broader re-renders
  than a store with finer-grained subscriptions, if any consuming page
  turns out to be render-sensitive. Not a concern known in advance for this
  codebase's current page set (Nodes, Map, Messages, Analytics, Activity,
  Logs, Device Config) — TASK-017 should watch for this during its full
  manual regression pass across all of them, but should not pre-optimize
  against a hypothetical problem.
- State is not readable outside the React tree (e.g. from a non-component
  module) without prop/context plumbing. No current use case needs this;
  flagged only so a future task doesn't rediscover the constraint by
  surprise.

## Follow-up work

TASK-017 (move daemon-derived state out of `App.tsx`) is unblocked by this
decision. TASK-018 (split the application shell into components) depends on
TASK-017 landing first so new components are built against the final state
shape.
