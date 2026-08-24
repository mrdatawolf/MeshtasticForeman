# TASK-019: Split MapPage.tsx by responsibility

Owner role: UX Specialist
Assigned agent: interface-designer
Proposed by: jarvis
Proposed date: 2026-08-24
Approved by:
Approved date:
Related contracts: None (coverage math contract, if accepted, was already attached to TASK-011 where the math is extracted — this task just relocates the already-tested module)
Related ADRs: None
Dependencies: **TASK-011 (hard blocker — coverage math, coordinate helpers must already be extracted and tested before this restructuring, so the split moves already-proven pure modules rather than extracting-and-restructuring simultaneously).**

## Desired outcome

`MapPage.tsx` (2175 lines) keeps orchestration only; map canvas, layer builders, controls, node popups, proposal editor, and terrain API concerns become separate components/modules. GeoJSON and coverage calculations (already extracted in TASK-011) remain framework-independent.

## Context

Confirmed `MapPage.tsx` currently mixes map rendering (`react-map-gl`/`maplibre-gl`), a coverage-union toggle UI (line 1318), node popups with ping/traceroute/position actions (lines 1171, 1684, 1743–1747), and other concerns in one file.

## Scope

### Included

Extracting map canvas setup, layer builders, map controls, node popup component(s), the proposal editor, and terrain-API interaction into separate modules/components, orchestrated by a slimmed `MapPage`.

### Excluded

Any change to map visuals, interactions, or the coverage math itself (already handled/tested in TASK-011) — behavior-preserving restructuring only.

## Plan

1) Confirm TASK-011's extracted coverage/coordinate modules are in place. 2) Extract the map canvas + layer-builder setup into its own module. 3) Extract map controls (coverage union toggle, etc.) into a component. 4) Extract node popup(s) — including the ping/traceroute/position-request actions — into a component. 5) Extract the proposal editor into its own component. 6) Extract terrain-API interaction (elevation lookups feeding coverage) into its own module. 7) Leave `MapPage` as the orchestrator wiring these together.

## Acceptance criteria

- [ ] `MapPage.tsx` primarily orchestrates the extracted map canvas, layers, controls, popups, proposal editor, and terrain API modules.
- [ ] Coverage and coordinate calculations remain in framework-independent modules (from TASK-011), unmodified by this restructuring.
- [ ] No visible change to map rendering, popups, or the coverage overlay (manual regression pass).
- [ ] Traceroute-visualization groundwork (from the Product roadmap section below) is *not* implemented here — flag as tempting scope creep to explicitly avoid.

## Validation requirements

Manual regression pass on map rendering, node selection/popups, ping/traceroute/position-request actions, coverage overlay toggling, and the proposal editor, across at least desktop and one narrower viewport.

## Risks and assumptions

Largest single-file split in Stage 4 by line count (2175 lines) — recommend splitting the implementation itself across multiple reviewable commits/PRs within this one task's scope, similar to TASK-005.

## Blocker

None.

## Implementation handoff

Not started.

## Review

Not reviewed.

## Human acceptance

Pending.
