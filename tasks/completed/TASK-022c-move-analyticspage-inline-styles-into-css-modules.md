# TASK-022c: Move AnalyticsPage inline styles into CSS modules

Owner role: UX Specialist
Assigned agent: interface-designer
Proposed by: Claude (orchestrating session), split from TASK-022 per Patrick's 2026-08-25 decision to split it into four independently-reviewable per-page sub-tasks
Proposed date: 2026-08-25
Approved by: Patrick
Approved date: 08/25/26
Related contracts: None
Related ADRs: None
Dependencies: TASK-020 (AnalyticsPage split into per-tab modules — already implemented and committed; style extraction targets those now-separated tab modules)

## Desired outcome

Large inline style collections and dynamically inserted style rules in `AnalyticsPage` (and its TASK-020-extracted per-tab modules) move into feature-level CSS modules or stylesheets.

## Context

Split from TASK-022, which originally covered the shell, MapPage, AnalyticsPage, and DeviceConfigPage as one umbrella task. Patrick decided to split it into four sub-tasks (TASK-022a through TASK-022d, one per page) for cleaner independent review, per TASK-022's own flagged scoping question. This task covers AnalyticsPage only.

## Scope

### Included

Converting inline `style={...}` objects and dynamically-generated style rules in AnalyticsPage's now-split per-tab modules into CSS modules or stylesheets scoped to the analytics feature.

### Excluded

Any visual redesign — colors, spacing, and layout must remain identical; this is purely a mechanism change (inline JS objects → CSS modules). Other pages (shell, MapPage, DeviceConfigPage) — tracked separately as TASK-022a/b/d.

## Plan

1) Identify all inline style objects/dynamically-generated style rules across AnalyticsPage's now-split tab modules. 2) Convert each into a CSS module or stylesheet scoped to the analytics feature. 3) Confirm no visual change.

## Acceptance criteria

- [ ] AnalyticsPage and its per-tab modules no longer contain large inline style-object collections.
- [ ] No visible styling change anywhere in the analytics tabs (pixel-level regression pass or visual diff tooling if available).

## Validation requirements

Visual regression pass (manual or tooled, if a visual diff tool is available in this repo — confirm) per analytics tab touched.

## Risks and assumptions

Low risk — mechanism-only change, no behavior or visual change intended.

## Blocker

None.

## Implementation handoff

Implemented by interface-designer (openai/Claude agent), completed and validated by the orchestrating Claude session on 2026-08-25.

### Changes made

- New shared module `analyticsStyles.ts`/`analyticsStyles.module.css`: common classes used across tabs (`grid`, `gridSpan`, `card`, `cardFullWidth`, `cardTitle`, `empty`, `subLabel`, `errorRow`, `deliverySummary`, `latencySummary`, `matrixCorner/Header/RowHeader/Cell`, `logCell`, `rangeBtnRow`, `rangeBtn(Active)`, `spinner`, `meshPlaceholder`, `controlsRow(Wrap)`, `mutedNote`), plus `LEGEND_WRAPPER_STYLE` (a genuine exception: recharts' `Legend` `wrapperStyle` prop only accepts a CSSProperties object, not a className — same category of library constraint as TASK-022b's react-map-gl finding).
- Per-tab CSS modules: `messages.module.css`, `network.module.css`, `packets.module.css`, `positions.module.css`, `signal.module.css`, `telemetry.module.css`, each colocated with its tab and imported as `localStyles`.
- All six tab modules (`messages.tsx`, `network.tsx`, `packets.tsx`, `positions.tsx`, `signal.tsx`, `telemetry.tsx`), `components.tsx`, and `AnalyticsPage.tsx` converted from inline `style={...}` objects (and the old CSSProperties-returning `styles` object in `components.tsx`) to `className` + CSS modules.
- Genuinely dynamic/data-driven values (SNR-link colors, per-node dot/swatch colors, computed loading/graph heights) use CSS custom properties (`style={{"--x": value} as CSSProperties}`) consumed by `var()` in the CSS module, consistent with TASK-022a/b's established pattern. Discrete-state styling (SNR good/ok/bad/none, MQTT yes/no) uses mutually-exclusive modifier classes selected in JS rather than CSS variables, also per the established convention.
- Two verified library constraints left inline with explanatory comments: recharts' `Legend wrapperStyle` (see `LEGEND_WRAPPER_STYLE` above) and react-map-gl's `<Map style={...}>` in `positions.tsx` (no `className` alternative per its `.d.ts`, same finding as TASK-022b).

### Validation performed

All run from `packages/web`:
- `pnpm exec tsc --noEmit`: clean.
- `pnpm build`: passed (Vite, 1882 modules; only the pre-existing >500 kB chunk-size advisory).
- `pnpm test`: passed — 13 files, 53 tests.
- `pnpm lint`: passed — 0 errors, 5 pre-existing `react-hooks/exhaustive-deps` warnings unrelated to this change.
- `pnpm format:check`: passed for every file this task touched; the only remaining flagged file (`src/components/config/FieldEditors.tsx`) is pre-existing and out of scope (TASK-022d/DeviceConfigPage territory).
- `grep -rn "style={" src/pages/analytics src/pages/AnalyticsPage.tsx`: confirms every remaining inline `style=` is either a verified library constraint (documented above) or a genuine CSS-custom-property case for dynamic values — no static/enumerable style collections remain.

### Assumptions and deviations

- No visual-diff/screenshot tooling exists in this repo and none was available in this session, consistent with TASK-022a/b's finding; visual parity was verified by direct, value-by-value comparison of every converted CSS declaration against its original inline value, not a pixel diff. A human spot-check via `pnpm --filter @foreman/web dev` is recommended before acceptance, per the task's own validation-requirements section.
- This task's implementation crossed two work sessions: the interface-designer agent did the bulk of the design work (establishing the shared/per-tab module split and most of the conversions) but was interrupted by a length limit partway through `packets.tsx`, `messages.tsx`, and `network.tsx`, leaving one broken intermediate state (a planned re-export of `styles` from `components.tsx` that was never added, breaking `tsc` for six tab files) and several sections with CSS classes already authored but not yet wired into their JSX. The orchestrating session completed the remaining conversions (finishing `packets.tsx`'s log table and controls row, and all of `messages.tsx`/`network.tsx`) using the already-established naming conventions, then ran and confirmed all validation above directly.

### Unresolved risks

- Real-browser visual regression pass not performed (no visual-diff tooling / browser available in this environment) — recommend a human spot-check per the task's validation requirements before acceptance.

## Review

Not reviewed.

## Human acceptance

Pending.
