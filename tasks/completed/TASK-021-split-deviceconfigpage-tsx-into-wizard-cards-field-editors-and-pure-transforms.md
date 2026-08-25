# TASK-021: Split DeviceConfigPage.tsx into wizard, cards, field editors, and pure transforms

Owner role: UX Specialist
Assigned agent: interface-designer
Proposed by: jarvis
Proposed date: 2026-08-24
Approved by: Patrick
Approved date: 08/24/26
Related contracts: **CONTRACT-012 (Accepted 08/24/26)** — pins down the current wizard/field-edit transform behavior this split must preserve exactly.
Related ADRs: None
Dependencies: TASK-011 (setup-wizard output logic already extracted and tested). CONTRACT-012 is accepted, but Patrick has asked that implementation of this task specifically wait for his go-ahead — do not dispatch to openai-coder until he says so.

## Desired outcome

`DeviceConfigPage.tsx` (1061 lines) is split into the setup wizard, configuration cards, field editors, and pure configuration-transformation functions.

## Context

This page pushes configuration to a physically connected radio via `setDeviceConfigSchema`/`requestDeviceConfigSchema` (confirmed in `packages/shared/src/ws-protocol.ts`) — meaning bugs here have real hardware-configuration consequences, not just cosmetic ones, which is why I'm flagging the optional contract.

## Scope

### Included

Extracting the setup wizard (building on TASK-011's already-extracted wizard-output logic), configuration cards, individual field editors, and any remaining pure configuration-transformation functions (defaults/merging beyond what TASK-011 already extracted) into separate modules/components.

A test file for `ConfigCard`'s direct-edit transform (`draft` accumulation, partial-value payload construction), matching the existing `setupWizardOutput.test.ts`/`configMerge.test.ts` pattern — CONTRACT-012 flagged that no such test exists today; Patrick confirmed on 2026-08-24 this should be added as part of this task rather than tracked separately.

### Excluded

Any change to what configuration options exist or how they're validated before sending to the device — behavior-preserving restructuring only.

## Plan

1) Confirm TASK-011's wizard-output extraction is in place. 2) Extract configuration cards (grouped settings sections) as components. 3) Extract individual field editors as reusable components. 4) Identify and extract any remaining pure transformation logic (e.g. building the final `setDeviceConfigSchema` payload from form state) not already covered by TASK-011. 5) Leave `DeviceConfigPage` orchestrating wizard vs. direct-edit flows.

## Acceptance criteria

- [ ] Setup wizard, configuration cards, field editors, and pure transformation functions are each in separate, focused modules.
- [ ] No change to what configuration values get sent to the device for a given set of user inputs (verified by comparing the constructed `setDeviceConfigSchema` payload before/after for representative inputs, using deep equality — not strict serialization — per CONTRACT-012's resolved Open question #1).
- [ ] No visible change to the wizard or configuration UI (manual regression pass).
- [ ] A new test file characterizes `ConfigCard`'s direct-edit transform (draft accumulation, partial-value payload construction), matching CONTRACT-012's documented behavior.

## Validation requirements

Given the real-hardware consequence, this task warrants more than a visual smoke test — recommend a before/after comparison of the actual payload sent to `setDeviceConfigSchema` for a fixed set of test inputs, not just "the UI looks the same." Manual regression pass against a real or simulated device connection if available.

## Risks and assumptions

Highest-consequence Stage 4 task despite not being the largest file — a transform bug here can misconfigure a physical radio, unlike the other Stage 4 splits which are purely presentational risk.

## Blocker

None.

## Implementation handoff

Implementer: interface-designer
Date: 2026-08-25

### Changes made

- Confirmed TASK-011's `buildWizardChanges` (`packages/web/src/lib/setupWizardOutput.ts`)
  and `mergeConfig` (`packages/web/src/lib/configMerge.ts`) were already extracted and
  tested; both are reused unchanged by the new modules below (plan step 1).
- Extracted the remaining pure transform logic CONTRACT-012 named but TASK-011 hadn't yet
  pulled out:
  - `packages/web/src/lib/regionMerge.ts` — `RegionNode`/`RegionPresets` types plus
    `mergeSelectedRegionSettings()`, a verbatim relocation of the wizard's
    `selectedRegions.reduce(...)` fold (previously inline in `SetupWizard`,
    `DeviceConfigPage.tsx:283–290`) that composes with `buildWizardChanges`.
  - `packages/web/src/lib/configCardTransform.ts` — `applyDraftEdit`, `currentFieldValue`,
    and `buildConfigCardSetConfigPayload`, extracted from `ConfigCard`'s inline
    `handleChange`/`currentVal`/`handleSave` payload logic (previously
    `DeviceConfigPage.tsx:954–970`).
- Extracted configuration cards and field editors as components under
  `packages/web/src/components/config/`:
  - `ConfigCard.tsx` — the per-section direct-edit card, now calling the pure functions
    above instead of inlining draft/payload logic.
  - `FieldEditors.tsx` — `canEdit`, `FieldEditor` (boolean/number/string inline editor),
    and `FieldDisplay` (read-only rendering with sensitivity masking and enum lookups).
  - `ChannelCards.tsx` — the channel summary cards.
- Extracted the setup wizard as components under the same directory:
  `SetupWizard.tsx` (orchestrator, owns wizard state and `applyAll()`), `RoleStep.tsx`,
  `RegionStep.tsx`, `FeaturesStep.tsx` (with its co-located `FieldInput`), and
  `ReviewStep.tsx`.
- Colocated shared, non-transform pieces used by the above: `configConstants.ts`
  (`DEVICE_ROLE`/`LORA_REGION`/`CHANNEL_ROLE`/`ENUM_LOOKUPS`/`SENSITIVE_KEYS`/`ROLES`,
  `camelToLabel`, `visibleEntries`) and `configStyles.ts` (all inline
  `React.CSSProperties` objects/helpers), following the same pattern already established
  by `components/shell/shellStyles.ts`. Style values themselves are untouched — this task
  only relocated them; TASK-022 owns any further inline-style extraction.
- `packages/web/src/pages/DeviceConfigPage.tsx` is reduced from 1,565 to 155 lines and now
  only owns device selection, the config-request/auto-open-wizard/disconnect-guard
  effects, and composes `ChannelCards`, `ConfigCard`, and `SetupWizard`. Its exported
  `Props`/`DeviceConfigPage` signature is unchanged.
- Added `packages/web/src/lib/regionMerge.test.ts` and
  `packages/web/src/lib/configCardTransform.test.ts`, matching the existing
  `setupWizardOutput.test.ts`/`configMerge.test.ts` pattern (pure-function unit tests, no
  rendered-component tests — consistent with TASK-010/011's stated preference and this
  package's current lack of a component-testing library).

### Validation performed

- **Payload-equality check (CONTRACT-012 Open Question #1 — deep equality, not strict
  serialization):**
  - `regionMerge.test.ts` includes the two cases CONTRACT-012's own validation
    requirements name: (a) the shipped `US → US-CA → US-CA-Humboldt` breadcrumb, and
    (b) a role selection colliding with a region on the same section (`radio.device`).
    Expected outputs were hand-derived by tracing `mergeConfig`'s and
    `buildWizardChanges`'s documented algorithms against the shipped
    `region-presets.json` data, then asserted with `toEqual` (deep equality) against the
    composed `mergeSelectedRegionSettings()` + `buildWizardChanges()` pipeline — both
    pass.
  - `configCardTransform.test.ts` characterizes `ConfigCard`'s direct-edit transform per
    this task's acceptance criteria: draft accumulation (`applyDraftEdit`, including that
    falsy values like `false`/`0`/`""` are recorded rather than dropped, and that a
    repeated edit to the same key replaces rather than merges), value fallback
    (`currentFieldValue`), and payload construction (`buildConfigCardSetConfigPayload`
    returns `null` for an empty draft — no write on a no-op save — and otherwise returns
    `{ deviceId, namespace, section, value: draft }` containing only the edited keys).
  - `setupWizardOutput.test.ts` and `configMerge.test.ts` were run unmodified against the
    relocated `buildWizardChanges`/`mergeConfig` and still pass, per CONTRACT-012's
    validation requirements.
  - Manually traced `ConfigCard.tsx`'s new `handleChange`/`currentVal`/`handleSave` and
    `SetupWizard.tsx`'s new `mergedRegionSettings`/`changes`/`applyAll` against the
    original inline code line-by-line: same functions called, same arguments, same
    order, same WS payload shape (`{ type: "device:set-config", payload }`) — no logic
    was altered during relocation.
- `pnpm --filter @foreman/web build`: passed — `tsc --noEmit` clean, Vite transformed
  1,861 modules, built in 5.91s (only the pre-existing >500 kB chunk-size advisory).
- `pnpm --filter @foreman/web test`: passed — 13 test files, 53 tests, 0 failed.
- `pnpm --filter @foreman/web lint`: 0 errors. 5 pre-existing warnings, none new or
  related to this change (`react-hooks/exhaustive-deps` on `DeviceConfigPage.tsx`'s
  auto-open-wizard effect — present with the identical dependency array in the original
  file — plus 4 pre-existing warnings in `MapPage.tsx`/`NodeDetailPanel.tsx`, both
  outside this task's scope).
- No interactive browser/hardware smoke test was performed in this non-running sandbox
  (no connected device or running daemon available); acceptance criterion "no visible
  change to the wizard or configuration UI" is validated here by unchanged JSX structure,
  props, and style values in the extracted components, not by an interactive pass — flagged
  below as a remaining risk.

### Assumptions and deviations

- Followed the `components/<page>/` + colocated `<page>Styles.ts` convention already
  established by TASK-018/019/020 (`components/shell/shellStyles.ts`,
  `components/map/mapCoverageConfig.ts`) rather than inventing a new layout.
- Treated `mergeSelectedRegionSettings` (the wizard's region-breadcrumb fold) and
  `ConfigCard`'s draft/payload functions as the "remaining pure transformation functions"
  the task's plan step 4 asked for, since these were the two payload-construction sites
  CONTRACT-012 named that TASK-011 had not already extracted.
- Kept `canEdit` colocated in `FieldEditors.tsx` rather than moving it to `lib/`: it is a
  simple, already-covered-by-manual-trace editability predicate, not named in
  CONTRACT-012's Required Behavior/Postconditions as a transform needing its own
  characterization test, and the task's acceptance criteria only call out the
  draft-accumulation/payload-construction behavior for testing.
- Did not touch any inline style *values*, only their location — no visual change is
  expected, and any further style-system change is explicitly TASK-022's scope.
- No configuration options, validation, or wire-protocol shapes were added, removed, or
  changed, per this task's Excluded scope.

### Unresolved risks

- No interactive manual regression pass against a real or simulated device was possible
  in this sandbox (no connected radio, no running daemon/websocket server). The
  acceptance criterion "no visible change to the wizard or configuration UI" should get a
  human manual pass before/alongside acceptance, per the task's own validation
  requirements.
- TASK-021's own Risks section and CONTRACT-012 both flag pre-existing gaps this task
  deliberately preserves rather than fixes: the wizard's `applyAll()` has no
  `SET_CONFIG_FAILED` handling (tracked as TASK-040) and both `applyAll()` and
  `ConfigCard.handleSave()` treat the first unfiltered `device:config` event as
  confirmation regardless of device/section (tracked as TASK-041). Both remain exactly
  as before, now living in `SetupWizard.tsx`/`ConfigCard.tsx`.
- Unrelated to this task: while working in this shared repository I observed several
  files in `tasks/review/` (e.g. `TASK-014`, `TASK-023`, `TASK-024`, `TASK-025`,
  `TASK-027`, `TASK-029`, `TASK-034`, `TASK-035`, `TASK-039`) showing as modified in
  `git status` with changes I did not make (e.g. `Approved by`/`Approved date` fields
  being filled in on already-reviewed tasks). I did not create, edit, or move any task
  file other than this one — flagging for the human's awareness since it suggests
  concurrent activity elsewhere in this working tree.

### Documentation updated

- This implementation handoff only; no behavior or architecture documentation changed
  because the work is a behavior-preserving restructuring.

## Review

Not reviewed.

## Human acceptance

Pending.
