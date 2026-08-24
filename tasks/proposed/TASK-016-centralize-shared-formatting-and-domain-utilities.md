# TASK-016: Centralize shared formatting and domain utilities

Owner role: Implementer
Assigned agent: openai-coder
Proposed by: jarvis
Proposed date: 2026-08-24
Approved by:
Approved date:
Related contracts: None
Related ADRs: None
Dependencies: None

## Desired outcome

Node-ID formatting, relative-time formatting, node-name resolution, and modem-preset mappings each have one implementation, used consistently across daemon and web rather than being reimplemented per-file.

## Context

Confirmed patterns like `nodeHex(id)` appear in `NodeDetailPanel.tsx`; similar formatting almost certainly recurs across `NodesPage.tsx`, `MapPage.tsx`, `AnalyticsPage.tsx`, and daemon-side code — exact duplication sites to be enumerated during implementation via grep for hex-formatting/`toString(16)`/relative-time patterns (already visible in `mqtt/gateway.ts`'s `fromNum.toString(16).padStart(8,"0")` pattern, repeated multiple times in that file alone).

## Scope

### Included

A `packages/shared` (or split daemon/web-appropriate) module for: node-ID formatting (hex node-ID display), relative-time formatting, node-name resolution/fallback logic, and modem-preset name mappings; replacing duplicated inline implementations with calls to the shared module.

### Excluded

Any change to the formatted *output* — this is deduplication, not a UX change (that would belong to Stage 4/`interface-designer` work instead).

## Plan

1) Grep daemon and web for duplicated formatting logic matching the four named categories. 2) Decide placement — likely `packages/shared` for anything used by both daemon and web (e.g. modem-preset mappings, node-ID formatting), web-only for anything purely presentational (e.g. relative time strings if daemon never needs them). 3) Extract, test, and replace call sites one category at a time.

## Acceptance criteria

- [ ] Node-ID formatting has one implementation used everywhere it currently appears duplicated.
- [ ] Relative-time formatting has one implementation.
- [ ] Node-name resolution/fallback logic has one implementation.
- [ ] Modem-preset mappings have one implementation.
- [ ] No visible output changes in the UI (verified by manual comparison of before/after rendering for a representative page like `NodesPage.tsx`).

## Validation requirements

Unit tests for each extracted utility (using TASK-009's shared-package test infra); manual visual comparison of at least `NodesPage.tsx` and `NodeDetailPanel.tsx` before/after.

## Risks and assumptions

Low risk, purely a DRY refactor, but touches many call sites — recommend doing this incrementally (one utility category per commit) for reviewability.

## Blocker

None.

## Implementation handoff

Not started.

## Review

Not reviewed.

## Human acceptance

Pending.
