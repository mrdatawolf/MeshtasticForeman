# TASK-022b: Move MapPage inline styles into CSS modules

Owner role: UX Specialist
Assigned agent: interface-designer
Proposed by: Claude (orchestrating session), split from TASK-022 per Patrick's 2026-08-25 decision to split it into four independently-reviewable per-page sub-tasks
Proposed date: 2026-08-25
Approved by: Patrick
Approved date: 08/25/26
Related contracts: None
Related ADRs: None
Dependencies: TASK-019 (MapPage split by responsibility — already implemented and committed; style extraction targets those now-separated components)

## Desired outcome

Large inline style collections and dynamically inserted style rules in `MapPage` (and its TASK-019-extracted sub-components, including `NodeDetailPanel`) move into feature-level CSS modules or stylesheets.

## Context

Split from TASK-022, which originally covered the shell, MapPage, AnalyticsPage, and DeviceConfigPage as one umbrella task. Patrick decided to split it into four sub-tasks (TASK-022a through TASK-022d, one per page) for cleaner independent review, per TASK-022's own flagged scoping question. This task covers MapPage only. Confirmed extensive inline `style={...}` usage and style-object helper functions (e.g. `actionBtnStyle`, `popupActionBtnStyle`) in `MapPage.tsx`/`NodeDetailPanel.tsx`.

## Scope

### Included

Converting inline `style={...}` objects and dynamically-generated style rules in `MapPage` and its now-split sub-components into CSS modules or stylesheets scoped to the map feature.

### Excluded

Any visual redesign — colors, spacing, and layout must remain identical; this is purely a mechanism change (inline JS objects → CSS modules). Other pages (shell, AnalyticsPage, DeviceConfigPage) — tracked separately as TASK-022a/c/d.

## Plan

1) Identify all inline style objects/dynamically-generated style rules across MapPage's now-split components. 2) Convert each into a CSS module or stylesheet scoped to the map feature. 3) Confirm no visual change.

## Acceptance criteria

- [x] MapPage and its sub-components no longer contain large inline style-object collections.
- [x] No visible styling change anywhere in the map view or node detail panel (pixel-level regression pass or visual diff tooling if available).

## Validation requirements

Visual regression pass (manual or tooled, if a visual diff tool is available in this repo — confirm) for the map view and node detail panel.

## Risks and assumptions

Low risk — mechanism-only change, no behavior or visual change intended. `MapPage` has the most extensive inline-style usage of the four pages, so this is likely the largest of the four sub-tasks.

## Blocker

None.

## Implementation handoff

Implementer: interface-designer
Date: 2026-08-25

### Changes made

Follows the CSS Modules convention TASK-022a established for the shell (`*.module.css`,
colocated per component, a `styles` classnames object, `style={...}` → `className={...}`).
`MapPage`/`NodeDetailPanel` and the TASK-019-extracted map sub-components
(`MapControls`/`ProposalControls`/`NodePopups`/`ProposalEditor`/`MapCanvas`) had three copies of
the same `ageFilterBtnStyle`/`controlPanel`/`summaryPill`/`controlLabel` styling (MapPage,
MapControls, ProposalControls) and two copies of the same `popupActionBtnStyle`/`popupStyles`
styling (NodePopups, ProposalEditor), so — matching TASK-022a's precedent of one shared file for
classes reused across 3+ components plus one file per component for the rest — this task adds two
shared modules in addition to the per-component ones:

- `packages/web/src/components/map/mapStyles.module.css` (new) + `mapStyles.ts` (new) — the
  shared `controlPanel`/`summaryPill`/`controlLabel`/`ageFilterBtn` styling and toggle-color
  variants (green/purple/teal/amber) used by MapPage's traceroute panel, `MapControls`'s coverage
  panel, and `ProposalControls`'s proposals panel. Exports `styles`, a `cx` classname-joining
  helper (same pattern as `shellStyles.ts`), `ageFilterBtnClass(active, variant?)` (replaces the
  three duplicate copies of the `ageFilterBtnStyle(active)` function), `onOffBtnClass(active)`
  (the traceroute/coverage On-Off toggle's muted-when-off text color), and `statusClass(done,
  total, errors)` (the terrain-viewshed status text's three-color state).
- `packages/web/src/components/map/popupStyles.module.css` (new) + `popupStyles.ts` (new) — the
  shared map-popup content styling (`popup`/`name`/`muted`/`actions`/`tag`/`grid`/`label`/`mono`)
  and the `popupActionBtnStyle(active)` function (replaced by `popupActionBtnClass(active,
  variant?)`) used by `NodePopups.tsx` (MeshPopup/MqttPopup) and `ProposalEditor.tsx`.
- `packages/web/src/pages/MapPage.module.css` (new) + `MapPage.tsx` (edited) — every page-specific
  style: the wrap div, node markers (outer/inner/local-ring/stack-badge), proposal markers, the
  colocated-node popup header, the search bar, and the legend (including its per-item swatches).
  The old `ageFilterBtnStyle` function and the ~155-line `styles: Record<string,
  React.CSSProperties>` object at the bottom of the file are gone entirely — the traceroute
  panel's controls now use the shared `mapStyles` helpers, and everything else moved to
  `MapPage.module.css`. The unused `controls` entry in the old `styles` record (confirmed zero
  call sites, dead since before this task) was dropped, same as TASK-022a dropped `tabCount`.
- `packages/web/src/pages/NodeDetailPanel.module.css` (new) + `NodeDetailPanel.tsx` (edited) — the
  full `styles` record and the `actionBtnStyle`/`messageBubbleStyle`/`sendBtnStyle` helper
  functions moved to classes (`actionBtn`/`actionBtnActive` + `actionBtnDanger`/`actionBtnGreen`/
  `actionBtnPushRight` modifiers for the "Confirm Reset"/"Coverage Map"/"Reset Node" button
  overrides; `msgBubble`/`msgBubbleOutgoing`; `sendBtn`/`sendBtnDisabled`; `detailValue`/
  `detailValueMono`), using a small local `cx` helper (this component doesn't share styling with
  any other file, so it didn't warrant a `mapStyles.ts`-style dedicated `.ts` wrapper — the CSS
  module's classnames object is used directly).
- `packages/web/src/components/map/MapControls.tsx` / `ProposalControls.tsx` (edited) — switched
  to the shared `mapStyles` module; each file's own copy of `ageFilterBtnStyle` and the local
  `styles`/`popupStyles` records is gone.
- `packages/web/src/components/map/NodePopups.tsx` / `ProposalEditor.tsx` (edited) — switched to
  the shared `popupStyles` module; `ProposalEditor.tsx` also gets its own small
  `ProposalEditor.module.css` for the form-specific styling (`input`/`textarea`/`formRow`/
  `formColFlex1`/`formColFlex2`/`metaLine`) that isn't shared with `NodePopups.tsx`.
- `packages/web/src/components/map/MapCanvas.tsx` — left untouched except a one-line clarifying
  comment; its one inline style (`style={{ width: "100%", height: "100%" }}` on react-map-gl's
  `<Map>`) is a required library integration point, not app styling — see "Assumptions and
  deviations" below.

Per-node dynamic color handling (the task's "use CSS custom properties for genuinely
continuous/dynamic values" guidance): `nodeColor(nodeId)` computes an HSL hue per node
(`hsl(hue, 70%, 55%)`, effectively continuous across 360 possible hues) used for mesh/MQTT marker
borders/fills and the colocated-node popup buttons. These keep the exact same JS-computed final
CSS value strings (e.g. `` `2px solid ${color}` ``, `` `${color}33` ``) as before, but now pass
them through named CSS custom properties (`--marker-color`, `--marker-bg`, `--marker-fg`,
`--marker-border`, `--marker-shadow` on markers; `--stack-border`/`--stack-bg`/`--stack-color` on
the colocated-node popup buttons) set via a small `style={{ "--x": value } as CSSProperties}` on
each element, consumed by `var(--x)` in the corresponding `.module.css` class. This mirrors
TASK-022a's `--battery-width` precedent and preserves byte-identical values, including one
pre-existing no-op: `markerOuterMesh` sets `border-color: var(--marker-color)` but no
`border-width`/`border-style` was ever set on that div (original code did the same
`borderColor`-only override with no border shorthand), so it has no visible effect in either
version — not something this task's "no visual change" mandate authorized fixing.

Two-boolean discrete state (not continuous, so resolved with a JS-computed modifier class instead
of a CSS variable, per TASK-022a's technique notes): the coverage legend swatch's `borderRadius`/
`background`/`border` depended on `coverageUnion` and `terrainMode` — the exact original ternary
logic (`coverageUnion` always wins the color; `terrainMode` only affects radius when `!
coverageUnion`) is preserved in JS, now selecting one of three CSS classes
(`legendSwatchUnion`/`legendSwatchTerrainSeparate`/`legendSwatchCircle`) instead of three inline
style branches.

### Validation performed

- Manual, property-by-property comparison: every CSS declaration in the new `.module.css` files
  was copied verbatim (same hex colors, units, and shorthand/longhand form) from the original
  inline `React.CSSProperties` objects/functions visible in the pre-edit file reads; no color,
  spacing, or layout value was changed. The two shared modules (`mapStyles`, `popupStyles`) were
  built by diffing the three/two duplicate copies against each other first to confirm they were
  byte-identical before merging into one shared definition.
- Confirmed (as TASK-022a did) that no visual-diff/screenshot/browser-automation tool exists
  anywhere in this repo, so — per the task's own validation requirements — this is a manual
  regression pass, not a tooled pixel-diff.
- `grep -c "style={" src/pages/MapPage.tsx src/pages/NodeDetailPanel.tsx
  src/components/map/*.tsx` after the change: `NodeDetailPanel.tsx`, `NodePopups.tsx`,
  `MapControls.tsx`, `ProposalControls.tsx`, `ProposalEditor.tsx` → 0. `MapCanvas.tsx` → 1 (the
  react-map-gl `<Map>` container's required `style` prop — no `className` alternative exists, see
  below). `MapPage.tsx` → 6: four are the CSS-custom-property assignments described above (mesh
  marker outer div, mesh marker inner div, MQTT marker inner div, and the colocated-node popup
  button), and two are `<Popup style={{ fontFamily: "monospace" }}>` — see below.
- `pnpm build` (`tsc --noEmit && vite build`): passed — `✓ 1873 modules transformed` /
  `✓ built in 8.81s` (only the pre-existing >500 kB chunk-size advisory, unrelated to this change).
- `pnpm test` (`vitest run`): passed — `Test Files 13 passed (13)`, `Tests 53 passed (53)`.
- `pnpm lint` (`eslint .`): `✖ 5 problems (0 errors, 5 warnings)` — the same 5 pre-existing
  `react-hooks/exhaustive-deps` warnings on `DeviceConfigPage.tsx`/`MapPage.tsx`/
  `NodeDetailPanel.tsx` already noted in TASK-021's and TASK-022a's handoffs; none are new and none
  are style-related. (Two `import/order` errors and two unused-`size`-variable errors surfaced
  during this task's own edits — the unused `size` variables were leftover from the old
  `width/height: size` inline styles once marker sizing moved to a `markerInnerStacked` CSS
  modifier class — and were fixed before this validation run; `eslint --fix` handled the import
  ordering.)
- `pnpm format:check` (`prettier --check`): found and fixed formatting drift this task's own edits
  introduced in `mapStyles.ts`/`ProposalControls.tsx`/`MapPage.tsx`/`NodeDetailPanel.tsx` (ran
  `prettier --write` on just those four files, then reran build/test/lint to confirm nothing broke
  from the reformat). The one remaining reported file, `src/components/config/FieldEditors.tsx`,
  is untouched by this task (DeviceConfigPage/TASK-022d territory) and was left as-is per this
  task's scope boundary.

### Assumptions and deviations

- Two react-map-gl components genuinely cannot take this task further: `MapCanvas.tsx`'s `<Map>`
  and both `<Popup style={{ fontFamily: "monospace" }}>` usages in `MapPage.tsx`. Checked their
  TypeScript definitions directly (`node_modules/.../react-map-gl/dist/maplibre/{map,popup}.d.ts`):
  both `MapProps` and `PopupProps` only declare a `style?: CSSProperties` prop for their
  library-rendered container — no `className` passthrough exists — so these three occurrences stay
  inline with a one-line comment explaining why, the same category of justified exception as
  TASK-022a's `--battery-width` custom property (a library/data constraint, not a style-authoring
  choice).
- Chose to add two shared modules (`mapStyles`, `popupStyles`) rather than duplicating the same
  classes into three/two separate per-component `.module.css` files, since the source objects were
  byte-identical duplicates across those files — same judgment call and granularity TASK-022a used
  for `shellStyles.module.css`.
- `NodeDetailPanel.module.css`/`.ts` intentionally has no shared module — nothing in it overlaps
  with the map sub-components' button styling (different colors/sizing), so a dedicated
  `.module.css` plus a local `cx` helper (no separate `.ts` wrapper needed, since there's nothing
  else to export) was more direct than forcing a shared abstraction that wouldn't be reused.
- Dropped the dead, already-unused `controls` style key from `MapPage.tsx`'s old `styles` record
  (zero call sites, confirmed via grep) rather than carrying forward unused CSS — mirrors TASK-022a
  dropping `tabCount`.
- No true visual-diff tool exists in this repo (confirmed above), so "confirm no visual change" is
  a manual, exhaustive value-for-value comparison rather than a pixel-diff screenshot comparison.

### Unresolved risks

- Same as TASK-022a: the manual comparison did not include an actual rendered-browser screenshot
  A/B (no visual-diff tooling or browser automation available to this agent); a human running
  `pnpm --filter @foreman/web dev` and exercising the map view (markers, popups, traceroute/
  coverage/proposal panels, search, legend) and the node detail panel (all action-button states,
  message bubbles, confirm-reset flow) is the recommended final check before acceptance.
- This task deliberately did not touch the shell, `AnalyticsPage`, or `DeviceConfigPage` (tracked
  separately as TASK-022a/c/d), so those pages are unaffected and out of scope for this review.

## Review

Not reviewed.

## Human acceptance

Pending.
