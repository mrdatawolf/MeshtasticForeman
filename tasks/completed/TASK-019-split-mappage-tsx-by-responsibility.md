# TASK-019: Split MapPage.tsx by responsibility

Owner role: UX Specialist
Assigned agent: interface-designer
Proposed by: jarvis
Proposed date: 2026-08-24
Approved by: Patrick
Approved date: 08/24/26
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

Implementer: Codex (interface implementation)
Date: 2026-08-24

### Changes made

- `packages/web/src/components/map/MapCanvas.tsx` now owns the `react-map-gl` canvas,
  navigation control, and the live-coverage, proposal-coverage, solid-traceroute,
  and dashed-traceroute source/layer definitions. `MapPage` supplies the existing
  GeoJSON and marker/popup children.
- `packages/web/src/components/map/MapControls.tsx` now owns the coverage panel,
  including simple/terrain, union/separate, visibility, preset, radius, MQTT,
  focused-node, expansion, and terrain-status controls.
- `packages/web/src/components/map/NodePopups.tsx` now owns the mesh and MQTT popup
  bodies, including request-position, traceroute, message, coverage-focus, and
  terrain-refresh actions.
- `packages/web/src/components/map/ProposalEditor.tsx` now owns the selected proposal
  edit/save, copy-GeoJSON, and delete UI. `ProposalControls.tsx` owns proposal
  placement/list visibility/delete/copy-all controls.
- `packages/web/src/components/map/terrainApi.ts` now owns elevation lookup, viewshed
  lookup, and viewshed invalidation requests. The existing orchestration, caches,
  concurrency limit, and status transitions remain in `MapPage`.
- `packages/web/src/components/map/mapCoverageConfig.ts` centralizes the map styles,
  preset/radius configuration, terrain fetch radius, preset-name conversion, and
  configured-device default-radius lookup used by the extracted pieces. `MapPage`
  re-exports `channelNameToPreset` to preserve its existing public export.
- `packages/web/src/pages/MapPage.tsx` is reduced from 2,556 to 1,619 lines and now
  composes these modules while retaining its original `Props` interface and
  exported `MapPage` signature.

### Validation performed

- Baseline `pnpm --filter @foreman/web test`: could not start —
  `/bin/bash: line 1: pnpm: command not found`.
- The required `pnpm --filter @foreman/web build` was run after each of the five
  extraction checkpoints (canvas/layers, controls, popups, proposal editor, and
  terrain API) and once at final verification. Every invocation was blocked before
  the build started with `/bin/bash: line 1: pnpm: command not found`.
- The initial final `pnpm --filter @foreman/web test` attempt likewise could not start
  with `/bin/bash: line 1: pnpm: command not found`.
- Follow-up toolchain investigation found installed NVM runtimes at
  `~/.nvm/versions/node/v22.22.3` and `v24.16.0`; NVM simply had not been sourced into
  the execution shell. The original `/usr/bin/node` was v20.19.2. With the installed
  Node v22.22.3 on `PATH`, Corepack resolved the project-pinned pnpm 11.21.0. A
  temporary Corepack shim was enabled under `/tmp/task019-corepack-bin` so the literal
  canonical commands could be run without changing the repository or user install.
- Initial fallback `packages/web/node_modules/.bin/vite build` from the repository
  root failed because that working directory has no `index.html`. The first full
  fallback `node_modules/.bin/tsc --noEmit && node_modules/.bin/vite build` from
  `packages/web` then found two strict-nullability errors in the extracted terrain
  refresh call; both were fixed.
- Isolated TypeScript checks covering `MapPage.tsx` and all extracted modules passed
  before and after formatting.
- Final fallback full web build from `packages/web`:
  `node_modules/.bin/tsc --noEmit && node_modules/.bin/vite build` passed; Vite
  transformed 1,841 modules and completed in 7.58s (only the existing >500 kB chunk
  size advisory was emitted).
- Fallback full web suite `node_modules/.bin/vitest run` passed twice after the
  extraction: 10 test files passed, 34 tests passed, 0 failed (final duration 2.03s).
  Because the requested baseline command could not launch in this environment, an
  exact pre-change count comparison is unavailable; the repeated final count is 34.
- Final canonical `pnpm --filter @foreman/web build` under Node v22.22.3 and pnpm
  11.21.0 passed: TypeScript completed, Vite transformed 1,841 modules, and the build
  completed in 6.46s. Only the existing >500 kB chunk-size advisory and pnpm's warning
  that the root `pnpm.onlyBuiltDependencies` field is no longer read were emitted.
- Final canonical `pnpm --filter @foreman/web test` under the same toolchain passed:
  10 test files passed, 34 tests passed, 0 failed, duration 903ms. The equivalent
  explicit `corepack pnpm@11.21.0` invocations also passed (build 6.40s; tests 34/34).

### Acceptance criteria evidence

- [x] `MapPage.tsx` primarily orchestrates extracted canvas/layers, controls,
  popups, proposal editing/controls, and terrain requests; it is 937 lines smaller.
- [x] `coverageMath.ts` and `coordinateHelpers.ts` were read but not edited. Their
  final SHA-256 values are respectively
  `c4f5a26f41f8e351bf4eb380e109d2621e6c9111bf506445a9a99229152a9327` and
  `073842b221cc79fc167a9f4eee3c84e09a9ca8765cdc064b39da3bf3a860213d`.
- [x] Manual code comparison (no browser available): `MapCanvas.tsx` retains the
  original map style/cursor/attribution/navigation settings and identical source IDs,
  layer IDs, layer types, paint expressions, opacity, widths, and dash arrays from
  original lines 815-929. `MapControls.tsx` retains the original coverage-control JSX
  from lines 1389-1641, with only prop threading. `NodePopups.tsx` retains the original
  popup fields, conditions, button text, disabled/pending behavior, titles, and styles
  from lines 2023-2204. `ProposalEditor.tsx` retains the original form fields,
  validation attributes, dirty/save behavior, GeoJSON shape, button text, and styles
  from lines 2210-2344; `ProposalControls.tsx` retains the original proposal panel
  conditions and actions from lines 1642-1810. `terrainApi.ts` uses the same URLs,
  query parameters, HTTP methods, response shapes, and non-OK handling as the original
  terrain/elevation call sites. Marker JSX, popup anchoring, ping/traceroute WebSocket
  payloads/timeouts, coverage GeoJSON calculations, and proposal state transitions
  remain in place.
- [x] No traceroute-visualization behavior or groundwork was added; existing stored
  traceroute line rendering was only passed through the extracted layer component.
- [x] `MapPage`'s external `Props` declaration and destructured exported function
  parameters are unchanged.
- [x] `App.tsx`, `AnalyticsPage.tsx`, and `packages/daemon/` were not edited by this
  implementation.

### Assumptions and deviations

- Browser-based desktop/narrow-viewport regression testing was impossible as stated
  in the assignment, so the required manual regression was performed by source-level
  JSX/style/action comparison rather than live interaction.
- Direct package binaries were initially used because the shell defaulted to Node 20
  and had no pnpm on `PATH`; follow-up validation selected the already-installed Node
  22 runtime and confirmed the literal canonical pnpm commands also pass.

### Unresolved risks

- A reviewer should still perform the requested live desktop and narrow-viewport map
  regression pass when a browser is available.

## Review

Not reviewed.

## Human acceptance

Pending.
