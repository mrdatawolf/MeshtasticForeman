# TASK-020: Split AnalyticsPage.tsx into per-tab modules

Owner role: UX Specialist
Assigned agent: interface-designer
Proposed by: jarvis
Proposed date: 2026-08-24
Approved by: Patrick
Approved date: 08/24/26
Related contracts: None (TASK-005's endpoint tests already pin backend behavior; this is a frontend-only restructuring)
Related ADRs: None
Dependencies: TASK-005 (endpoint behavior already regression-tested — safe to restructure the frontend consumer), TASK-013 recommended (typed HTTP client — natural fit for the "small query hook" the roadmap asks for), not a hard blocker if you'd rather sequence them independently

## Desired outcome

`AnalyticsPage.tsx` (1749 lines) is split into one module per analytics tab (signal, messages, network, telemetry, packets, positions — matching the same domain grouping used in TASK-026's backend route split) plus shared chart components, with a small query hook handling loading/cancellation/refresh/error state.

## Context

Confirmed `AnalyticsPage.tsx` currently fetches traceroutes, message-latency, link-quality, and presumably the remaining 14 analytics endpoints inline, each apparently with its own near-identical fetch effect (e.g. lines 437, 648, 1149 show the repeated `apiFetch<T>(...).then(...).catch(...)` pattern).

## Scope

### Included

One module per tab grouping; a shared query hook (loading/cancel/refresh/error) used by all tabs instead of near-identical individual effects; shared chart components factored out (this uses `recharts`, per `web/package.json`).

### Excluded

Changing what data any chart displays or how it's visually presented — behavior-preserving restructuring.

## Plan

1) Group the 17 analytics endpoints into the six domains (matching TASK-026's backend grouping so frontend/backend domain boundaries agree). 2) Build the shared query hook (ideally reusing TASK-013's typed client and its `AbortSignal` support for cancellation). 3) Extract shared chart components. 4) Migrate tab-by-tab, replacing individual fetch effects with the query hook.

## Acceptance criteria

- [ ] Analytics tabs are organized into signal, messages, network, telemetry, packets, and positions modules (or the closest sensible grouping, confirmed against TASK-026).
- [ ] A shared query hook handles loading, cancellation, refresh, and error states consistently across tabs, replacing the near-identical repeated effects.
- [ ] Shared chart components are factored out and reused across tabs.
- [ ] No visible change to any chart's displayed data (manual comparison per tab, before/after).

## Validation requirements

Manual regression pass per analytics tab comparing displayed values before/after; query hook unit tests (TASK-010 infra) for cancellation/error/refresh behavior.

## Risks and assumptions

Second-largest split by line count (1749 lines) — same recommendation as TASK-019 to split implementation across multiple commits/PRs within this task.

## Blocker

None.

## Implementation handoff

Implementer: Codex
Date: 2026-08-24

### Domain grouping and endpoint mapping

- `signal.tsx`: `snrHistory` (`SignalTab`) and `linkQuality`
  (`LinkQualityTab`). Link quality is grouped with signal because the endpoint is
  an SNR matrix; its separate visible tab remains unchanged.
- `messages.tsx`: `messageVolume`, `messageDelivery`, `busiestNodes`,
  `channelUtilization`, and `messageLatency` (`MessagesTab`), plus `nodeActivity`
  (`ActivityTimelineTab`). Activity is grouped here because it counts messages
  per node/time bucket; its separate visible Timeline tab remains unchanged.
- `network.tsx`: `hopDistribution`, `hardwareBreakdown`, `neighborGraph`, and
  `traceroutes` (`NetworkTab`). Hardware inventory is network composition, while
  neighbor and traceroute data describe network topology.
- `telemetry.tsx`: `telemetryHistory` (`TelemetryTab`).
- `packets.tsx`: `portnumBreakdown`, `packetTimeline`, and `packetLog`
  (`PacketsTab`).
- `positions.tsx`: `positionHistory` (`PositionsTab`).

This accounts for all 17 typed analytics client functions. No `fetch()` or
local `apiFetch` exists in `AnalyticsPage.tsx` or the new analytics directory;
all requests call `../../api/analytics.js` and pass the hook's signal.

### Files and extracted responsibilities

- Modified `packages/web/src/pages/AnalyticsPage.tsx`: retained the named
  `AnalyticsPage` export and identical `Props`; reduced it to eight-tab nav and
  domain-tab orchestration.
- Added `packages/web/src/pages/analytics/components.tsx`: shared `ChartCard`,
  `Empty`, `Loading`, `RangeBtn`, `MeshGraph`, node/time formatting helpers,
  graph helpers, chart colors/styles, map style, spinner rule, and shared style
  object.
- Added `packages/web/src/pages/analytics/useAnalyticsQuery.ts`: shared
  data/loading/error state, caller display fallback, stable `refresh()`, request
  generation protection, and `AbortController` cancellation on replacement and
  unmount.
- Added `packages/web/src/pages/analytics/useAnalyticsQuery.test.tsx`: success,
  refresh, ordinary error/fallback, abort-error suppression, and concrete stale
  request cancellation tests.
- Added `packages/web/src/pages/analytics/signal.tsx`: Signal and Link Quality
  tab implementations.
- Added `packages/web/src/pages/analytics/messages.tsx`: Messages and Activity
  Timeline tab implementations.
- Added `packages/web/src/pages/analytics/network.tsx`: Network tab.
- Added `packages/web/src/pages/analytics/telemetry.tsx`: Telemetry tab.
- Added `packages/web/src/pages/analytics/packets.tsx`: Packets tab.
- Added `packages/web/src/pages/analytics/positions.tsx`: Positions tab.
- Modified this task file with the implementation handoff.

### Query cancellation verification

The hook test starts a deferred request, rerenders with a changed dependency,
asserts the first request's actual `AbortSignal.aborted` changes from `false` to
`true`, resolves the second request to `"fresh"`, then resolves the first to
`"stale"` and asserts state remains `"fresh"`. A separate test verifies an
`AbortError` is not exposed as a query error. Success plus refresh and ordinary
error/fallback behavior are also covered. Result: 1 file, 4 tests passed.

### Per-tab before/after comparison

- Signal: same `snrHistory({ since })` ranges, top-eight count ranking, SNR/RSSI
  pivots and timestamp sort, empty copy, two line charts, axes, colors, and node
  labels. Only the signal argument and cancellation owner changed.
- Messages: same range-derived hour/day bucket and the same five calls with
  `{ since }`/`{ since, bucket }`; delivery slices, channel labels, busiest-node
  names, latency formatting, ordering, and all chart JSX/props are unchanged.
- Network: same unfiltered hop/hardware calls; same `graphSince` conversion of
  `all` to undefined for neighbor/traceroute calls; graph edge deduplication,
  best-SNR selection, route transformation, resize measurement, charts and
  cards are unchanged.
- Telemetry: same `telemetryHistory({ since })`; node collection, field pivots,
  timestamp sorting, device/environment metric selection, units, common axes,
  lines, and cards are unchanged.
- Packets: same portnum, timeline, and log calls (including the existing hour
  bucket, limit 200, and optional portnum); top-six/Other transformation, CSV
  URL, tables, chart ordering, palette, formatting, and JSX are unchanged.
- Link Quality: same `linkQuality({ since })`; node set/sort, directed-pair map,
  short names, cell thresholds/text, legend, matrix JSX and tooltip text are
  unchanged.
- Timeline: same `nodeActivity({ since, bucket })` with the existing hour/day
  rule; local-node filtering, top-15 pivot and timestamp sort, top-20 summary,
  colors, labels, axes and chart JSX are unchanged.
- Positions: same `positionHistory` query (`since`, optional selected node,
  limit 5000); node sort, chronological trail construction, latest-fix choice,
  newest-first 500-row table, map sources/layers and displayed formatting are
  unchanged.

No live browser was available. This comparison was performed by preserving each
tab body mechanically and then reviewing the request replacement and extracted
imports against the original body.

### Validation performed

- Baseline `pnpm --filter @foreman/web test` — FAIL to start, exit 127:
  `pnpm: command not found`.
- Baseline `./node_modules/.bin/vitest run` from `packages/web` — PASS: 9 test
  files, 30 tests.
- Initial Corepack attempt — FAIL under sandbox Node v20.19.2 with
  `ERR_VM_DYNAMIC_IMPORT_CALLBACK_MISSING`; repository requires Node >=22.13.
- After each of the six domain migrations, an initial
  `pnpm --filter @foreman/web build` attempt — FAIL to start for each domain,
  exit 127: `pnpm: command not found`.
- `./node_modules/.bin/vitest run src/pages/analytics/useAnalyticsQuery.test.tsx`
  — PASS: 1 file, 4 tests.
- An intermediate `./node_modules/.bin/tsc --noEmit` — PASS before a concurrent
  `MapPage.tsx` edit; a later run temporarily reported two out-of-scope
  MapPage nullability errors while that edit was in progress. No protected file
  was changed here.
- `./node_modules/.bin/vite build` — PASS: 1841 modules, 7.17s; existing
  large-chunk advisory only.
- The pinned pnpm 11.21.0 was then made available on PATH under the installed
  Node v24.16.0 runtime. `pnpm --filter @foreman/web build` was rerun once for
  each domain validation pass — all PASS: signal 5.91s, messages 5.91s,
  network 9.30s, telemetry 6.70s, packets 6.94s, positions 6.86s; 1841 modules,
  existing large-chunk advisory only.
- Final `pnpm --filter @foreman/web test` — PASS: 10 test files, 34 tests,
  0 failures (1.67s). Passing count increased from 30 to 34.

### Acceptance criteria evidence

- [x] Six domain modules contain all 17 endpoints while preserving all eight
  visible tabs and the TASK-026-aligned boundaries documented above.
- [x] Every tab fetch uses the shared hook; it owns loading/data/error/refresh,
  aborts replaced/unmounted requests, and its four focused tests pass.
- [x] Shared chart/UI components, constants, palettes, spinner, graph and style
  helpers are extracted into `components.tsx` and reused by every tab module.
- [x] The per-tab request, transformation and JSX comparison above found no
  displayed-data or visual behavior changes; production build and full tests
  pass.

### Assumptions, deviations, and unresolved risks

- `LinkQualityTab` remains visible but belongs to signal because SNR is its
  measured value. `ActivityTimelineTab` remains visible but belongs to messages
  because its endpoint aggregates message activity. `hardwareBreakdown` belongs
  to network as network composition.
- Existing silent display fallbacks on ordinary request failure were retained
  while the hook exposes the underlying error to callers. Abort failures are
  ignored and cannot replace current data.
- There was no browser/live-daemon regression pass. The remaining risk is a
  visual-only issue not caught by the mechanical body comparison, TypeScript,
  production bundle, or unit suite.
- `App.tsx`, `MapPage.tsx`, and all of `packages/daemon/` were not modified.
  No git command was run and no commit was created.

## Review

Not reviewed.

## Human acceptance

Pending.
