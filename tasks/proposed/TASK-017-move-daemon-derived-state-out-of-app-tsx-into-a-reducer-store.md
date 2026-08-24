# TASK-017: Move daemon-derived state out of App.tsx into a reducer/store

Owner role: Implementer
Assigned agent: openai-coder
Proposed by: jarvis
Proposed date: 2026-08-24
Approved by:
Approved date:
Related contracts: None initially (contract can follow once the store shape is settled, at your discretion)
Related ADRs: **ADR-001 required first** (durable architectural direction — reducer vs. a small dedicated store is explicitly left open by the roadmap itself, a real alternatives-and-consequences decision)
Dependencies: **ADR-001 must be approved before this task is approved** (per `docs/workflow/approval-gates.md` — meaningful work needs design approval before an implementation task is approved)

## Desired outcome

Devices, mesh nodes, MQTT nodes, activity, logs, configuration, and WebSocket events are managed by a reducer or dedicated store, not scattered `useState` calls in `App.tsx`; a new `ServerEvent` variant produces a compiler error until handled or deliberately ignored (exhaustive handling).

## Context

Confirmed `App.tsx` (1118 lines) currently handles `ServerEvent`s via a chain of `if (event.type === "...")` checks (13+ branches confirmed at lines 224–288) rather than an exhaustive switch — exactly the gap the roadmap names. TASK-009 already adds a compile-time exhaustiveness *type* check at the shared-schema level; this task makes the actual consumer (`App.tsx`) exhaustive too. Note: this decision materially overlaps with the Stage 6 item "record an ADR for WebSocket state ownership" — I recommend deciding that now (ADR-001) rather than documenting it retrospectively after the fact in Stage 6's TASK-034, so the decision drives the implementation instead of chasing it.

## Scope

### Included

Design and implement the chosen state-management approach (per ADR-001) for the seven named state categories; convert `App.tsx`'s `if`-chain event handling into an exhaustive construct (switch with a `never`-check default, or equivalent); keep transient UI state (selected tab, open menu) local to the components that render it, explicitly *not* moved into the new store.

### Excluded

Splitting `App.tsx` into shell components (TASK-018) — that's a separate task, though closely related and dependent on this one landing first so the new components are built against the final state shape rather than being rewired afterward.

## Plan

1) (Prerequisite, tracked as ADR-001) Decide reducer-in-React vs. small dedicated store (e.g. Zustand-style, or hand-rolled) with you. 2) Design the store's state shape and action/event-handling surface. 3) Implement it, migrating the seven state categories one at a time. 4) Convert event dispatch to an exhaustive switch. 5) Confirm no behavioral regression across Nodes, Map, Messages, Analytics, Activity, Logs, and Device Config pages (all consume this state).

## Acceptance criteria

- [ ] ADR-001 is approved before this task is approved for implementation.
- [ ] Devices, mesh nodes, MQTT nodes, activity, logs, configuration, and WebSocket events are managed outside ad hoc `useState` in `App.tsx`.
- [ ] Adding a new `ServerEvent` variant without handling it produces a TypeScript compile error (verified by a deliberate test addition, then reverted).
- [ ] Transient UI state remains local to its component, not lifted into the new store.
- [ ] All pages consuming this state (Nodes, Map, Messages, Analytics, Activity, Logs, Device Config) behave identically before/after (manual regression pass).

## Validation requirements

Full manual regression pass across every page listed above, since this is the highest cross-cutting risk in Stage 4 — it touches state consumed by literally every page. Recommend QualityAssurance review before acceptance.

## Risks and assumptions

This is the largest single risk in Stage 4 given how central this state is. Strongly recommend not combining this with TASK-018 in one PR even though they're related — keep them independently reviewable as scoped.

## Blocker

None.

## Implementation handoff

Not started.

## Review

Not reviewed.

## Human acceptance

Pending.
