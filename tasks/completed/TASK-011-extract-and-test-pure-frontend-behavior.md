# TASK-011: Extract and test pure frontend behavior

Owner role: Implementer
Assigned agent: openai-coder
Proposed by: jarvis
Proposed date: 2026-08-24
Approved by: Patrick
Approved date: 08/24/26
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

Task: TASK-011: Extract and test pure frontend behavior
Implementer: openai-coder
Date: 2026-08-24

### Changes made

- Extracted node override fallback precedence from `packages/web/src/App.tsx` to
  `packages/web/src/lib/nodeOverrides.ts`. The genuine merge location was shared
  application state in `App.tsx`, not `NodeOverridesPage.tsx`.
- Extracted Turf polygon union/fallback behavior from `MapPage.tsx` to
  `packages/web/src/lib/coverageMath.ts`.
- Extracted spherical destination, viewshed clipping, and coverage-circle coordinate
  conversions from `MapPage.tsx` to `packages/web/src/lib/coordinateHelpers.ts`.
- Extracted recursive region/device configuration merging from `DeviceConfigPage.tsx`
  to `packages/web/src/lib/configMerge.ts`.
- Located setup-wizard output construction inside `DeviceConfigPage.tsx` and extracted
  it to `packages/web/src/lib/setupWizardOutput.ts`.
- Added one colocated Vitest file for each module. No test-runner infrastructure was changed.

### Validation performed

- Initial literal `pnpm --filter @foreman/web ...` attempts: could not start because the
  sandbox shell did not expose `pnpm` on `PATH` (exit 127). `corepack pnpm` under the
  system Node 20 also could not start pinned pnpm 11 (`ERR_VM_DYNAMIC_IMPORT_CALLBACK_MISSING`).
- Subsequent commands used the repository-required Node 22.22.3 and
  `--config.store-dir=/tmp/task011-pnpm-store`, because the default pnpm store database
  was not writable in this sandbox.
- After the coverage extraction, web build passed (1,805 modules; Vite built in 14.74s)
  and the full test run passed (4 files, 10 tests). Its focused test run also passed.
- The first coordinate-helper run found one overly exact test assertion (`0` versus
  floating-point `-2.2e-18`); the assertion was corrected to numeric tolerance. At that
  time build was also temporarily blocked by concurrent TASK-013 work in
  `packages/web/src/api/coverage.ts`; no out-of-scope file was changed.
- After configuration merge extraction, the focused/full test run passed (7 files,
  25 tests); build still reported that same transient concurrent-file type error.
- After setup-wizard extraction, focused/full tests passed (8 files, 28 tests) and build
  passed (1,810 modules; Vite built in 12.63s).
- Final focused command:
  `pnpm --config.store-dir=/tmp/task011-pnpm-store --filter @foreman/web exec vitest run src/lib/nodeOverrides.test.ts src/lib/coverageMath.test.ts src/lib/coordinateHelpers.test.ts src/lib/configMerge.test.ts src/lib/setupWizardOutput.test.ts`
  passed: 5 files, 16 tests.
- Final full `pnpm --config.store-dir=/tmp/task011-pnpm-store --filter @foreman/web test`
  passed: 8 files, 28 tests.
- Final full `pnpm --config.store-dir=/tmp/task011-pnpm-store --filter @foreman/web build`
  passed: TypeScript `--noEmit` clean; 1,810 Vite modules transformed; built in 9.76s.
- Manually inspected every changed call site and confirmed identical inputs, precedence,
  output properties, fallback paths, ordering, and formulas. No interactive browser smoke
  test was performed in this non-running sandbox.

### Acceptance criteria evidence

- Five standalone `packages/web/src/lib/` modules have colocated behavior-focused unit
  tests and contain no React imports or DOM access.
- `App.tsx`, `MapPage.tsx`, and `DeviceConfigPage.tsx` now import/call the extracted
  functions; source-level before/after review found no page-visible behavior change.
- Coverage includes a concrete known-answer union test: two half-overlapping unit squares
  produce one polygon with planar area `1.5`.
- Coordinate tests cover the north pole, antimeridian normalization, clipping, and the
  existing kilometer-to-degree circle conversions.
- Final full web test and build commands pass.

### Assumptions and deviations

- Used a consistent `packages/web/src/lib/` location.
- Treated “coordinate helpers” as the inline destination-point, viewshed-clipping, and
  coverage-circle conversions actually used by `MapPage.tsx`; no separate inline
  lat/lon text formatter existed in the scoped pages.
- Treated configuration merging as the inline hierarchical region-settings merge used to
  combine setup defaults/overrides. Wizard config-write construction remains a separate
  module as required.
- Declined a new CONTRACT-011 for this pure extraction: the existing algorithm was
  preserved exactly and pinned by known-answer and fallback tests. A future behavioral
  change to operational coverage math should reconsider a contract.
- The pnpm PATH/store flags are environment-only accommodations and do not modify project
  infrastructure.

### Unresolved risks

- Interactive map-overlay and setup-wizard smoke testing remains for review in a running
  application with a connected/configured device. Automated known-answer, edge-case,
  TypeScript, and production-build validation passed.
- Turf behavior remains dependency-version-sensitive; the known-answer union test will
  detect relevant geometry regressions in the pinned dependency range.

### Documentation updated

- This implementation handoff only; no behavior or architecture documentation changed
  because the work is a pure extraction.

## Review

Not reviewed.

## Human acceptance

Pending.
