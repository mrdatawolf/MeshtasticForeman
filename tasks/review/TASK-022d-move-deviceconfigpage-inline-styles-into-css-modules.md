# TASK-022d: Move DeviceConfigPage inline styles into CSS modules

Owner role: UX Specialist
Assigned agent: interface-designer
Proposed by: Claude (orchestrating session), split from TASK-022 per Patrick's 2026-08-25 decision to split it into four independently-reviewable per-page sub-tasks
Proposed date: 2026-08-25
Approved by: Patrick
Approved date: 08/25/26
Related contracts: None
Related ADRs: None
Dependencies: TASK-021 (DeviceConfigPage split into wizard/cards/field editors/pure transforms — already implemented and verified; style extraction targets those now-separated components)

## Desired outcome

Large inline style collections and dynamically inserted style rules in `DeviceConfigPage` (and its TASK-021-extracted wizard/card/field-editor components) move into feature-level CSS modules or stylesheets.

## Context

Split from TASK-022, which originally covered the shell, MapPage, AnalyticsPage, and DeviceConfigPage as one umbrella task. Patrick decided to split it into four sub-tasks (TASK-022a through TASK-022d, one per page) for cleaner independent review, per TASK-022's own flagged scoping question. This task covers DeviceConfigPage only. Note `configStyles.ts` already exists as a colocated style-constants module from TASK-021 (mirroring `components/shell/shellStyles.ts`) — confirm during implementation whether that already satisfies this task's intent or whether it still needs conversion to true CSS modules/stylesheets.

## Scope

### Included

Converting inline `style={...}` objects and dynamically-generated style rules in DeviceConfigPage's now-split components (`SetupWizard`, `ConfigCard`, `RoleStep`, `RegionStep`, `FeaturesStep`, `ReviewStep`, `ChannelCards`, `FieldEditors`) into CSS modules or stylesheets scoped to the device-config feature.

### Excluded

Any visual redesign — colors, spacing, and layout must remain identical; this is purely a mechanism change (inline JS objects → CSS modules). Any change to configuration behavior or the `setDeviceConfigSchema` payload — this task is styling-only. Other pages (shell, MapPage, AnalyticsPage) — tracked separately as TASK-022a/b/c.

## Plan

1) Identify all inline style objects/dynamically-generated style rules across DeviceConfigPage's now-split components, including the existing `configStyles.ts`. 2) Convert each into a CSS module or stylesheet scoped to the device-config feature. 3) Confirm no visual change and no change to device-configuration behavior.

## Acceptance criteria

- [ ] DeviceConfigPage and its split-out components no longer contain large inline style-object collections.
- [ ] No visible styling change anywhere in the wizard or configuration UI (pixel-level regression pass or visual diff tooling if available).
- [ ] No change to what configuration values get sent to the device (this task must not touch `configCardTransform.ts`/`regionMerge.ts` behavior, only presentation).

## Validation requirements

Visual regression pass (manual or tooled, if a visual diff tool is available in this repo — confirm) for the wizard and direct-edit configuration UI.

## Risks and assumptions

Low risk for styling itself, but DeviceConfigPage carries the same real-hardware-consequence context as TASK-021 — be careful not to accidentally touch transform/payload logic while moving styles.

## Blocker

None.

## Implementation handoff

Implemented by interface-designer, finished/validated by the orchestrating Claude session on 2026-08-25 (agent completed the style conversion but was cut off before its final validation/write-up pass).

### Changes made

- `configStyles.ts` (from TASK-021) converted from CSSProperties objects to a CSS-Modules-backed classnames object, following TASK-022a/b/c's established convention.
- All inline `style={...}` usage removed from `SetupWizard`, `ConfigCard`, `RoleStep`, `RegionStep`, `FeaturesStep`, `ReviewStep`, `ChannelCards`, and `FieldEditors` — confirmed via `grep -rn "style={" src/components/config src/pages/DeviceConfigPage.tsx`, zero remaining.
- `configCardTransform.ts` / `regionMerge.ts` and their tests untouched (styling-only change, confirmed).

### Validation performed

All run from `packages/web`:
- `pnpm exec tsc --noEmit`: clean.
- `pnpm build`: passed (1... modules, only pre-existing chunk-size advisory).
- `pnpm test`: passed — 13 files, 53 tests.
- `pnpm lint`: passed — 0 errors, 5 pre-existing warnings unrelated to this change.
- `pnpm format:check`: fully clean, including `FieldEditors.tsx`'s previously-flagged pre-existing drift (fixed as part of this task, per its own scope).

### Unresolved risks

- No visual-diff tooling / browser available in this session; visual parity relies on value-by-value comparison against the original inline styles, same as sibling tasks 022a/b/c. Recommend a human spot-check of the wizard and direct-edit config UI before acceptance, given this page's real-hardware consequence.

## Review

Not reviewed.

## Human acceptance

Pending.
