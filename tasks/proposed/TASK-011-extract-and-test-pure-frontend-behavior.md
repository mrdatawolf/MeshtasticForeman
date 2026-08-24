# TASK-011: Extract and test pure frontend behavior

Owner role: Implementer
Assigned agent: openai-coder
Proposed by: jarvis
Proposed date: 2026-08-24
Approved by:
Approved date:
Related contracts: CONTRACT-011 recommended for the map coverage-calculation module specifically (see note below — this is my addition, not one of the Stage 3–5 items you flagged, so treat as optional)
Related ADRs: None
Dependencies: TASK-010 (needs the web test runner)

## Desired outcome

Node override merging, map coverage calculations, coordinate helpers, configuration merging, and setup-wizard output logic are extracted from their current component homes into pure, framework-independent, tested modules — directly enabling the Stage 4 page splits (TASK-019, TASK-021) that depend on this work.

## Context

This logic currently lives inline inside `MapPage.tsx` (2175 lines), `DeviceConfigPage.tsx` (1061 lines), and node-override handling (location TBD — confirm exact file during implementation, likely `NodeOverridesPage.tsx` or shared state). Coverage math specifically has real operational consequence: operators rely on it to judge mesh coverage, so an incorrect extraction is a meaningful risk, not just a maintainability nicety.

## Scope

### Included

Extracting each of the five named behaviors into `packages/web/src/` pure-function modules (exact location e.g. `lib/` or `utils/`, to be decided during implementation) with unit tests; no visual or behavioral change to the pages that currently contain this logic.

### Excluded

The broader component restructuring of `MapPage.tsx`/`DeviceConfigPage.tsx` themselves (TASK-019, TASK-021) — this task only pulls out the pure logic and proves it's unchanged via tests, leaving the surrounding component otherwise intact (just calling the extracted function instead of inlining it).

## Plan

1) Identify and extract node-override merging logic; test merge precedence/conflict cases. 2) Extract map coverage-calculation math (likely involving `@turf/union`/`@turf/helpers`, visible in `web/package.json` dependencies) into a pure module; test against known geometries with expected areas/unions. 3) Extract coordinate helpers (lat/lon formatting, conversions); test edge cases (poles, antimeridian if relevant). 4) Extract configuration-merging logic (device config defaults + overrides); test merge behavior. 5) Extract setup-wizard output-construction logic; test that wizard inputs produce the expected config object. 6) For each extraction, confirm the original page's rendered/exported behavior is unchanged (before/after comparison, not a full component test — per TASK-010's stated preference for pure-logic tests over rendered-component snapshots).

## Acceptance criteria

- [ ] Node override merging, map coverage calculations, coordinate helpers, configuration merging, and setup-wizard output are each in standalone, framework-independent modules with unit tests.
- [ ] No visual or behavioral change to `MapPage.tsx`, `DeviceConfigPage.tsx`, or node-override handling as observed in manual testing.
- [ ] Coverage-calculation tests include at least one known-answer geometry case (not just "doesn't throw").

## Validation requirements

`pnpm --filter @foreman/web test`; manual smoke test of the map coverage overlay and device config wizard to confirm no visible change.

## Risks and assumptions

I'm recommending an optional CONTRACT (CONTRACT-011) specifically for the coverage-math module given its operational consequence if wrong — this goes beyond what you asked me to flag (you named Stage 3–5 items as contract candidates), so treat it as a suggestion to accept or decline rather than a firm recommendation.

## Blocker

None.

## Implementation handoff

Not started.

## Review

Not reviewed.

## Human acceptance

Pending.
