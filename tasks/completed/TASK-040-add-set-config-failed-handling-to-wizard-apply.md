# TASK-040: Add SET_CONFIG_FAILED handling to the setup wizard's apply flow

Owner role: Implementer
Assigned agent: openai-coder
Proposed by: contract-architect (via Claude, orchestrating session), per CONTRACT-012's Open question #2
Proposed date: 2026-08-24
Approved by: Patrick
Approved date: 08/25/26
Related contracts: CONTRACT-012 (documents this as a known, deliberately-preserved
asymmetry under TASK-021's "behavior-preserving only" scope; this task is the
fast-follow that closes it, matching the TASK-039/CONTRACT-001 precedent)
Related ADRs: None
Dependencies: TASK-021 (hard blocker — this task targets the wizard's apply
logic after it's extracted into its own module by TASK-021, not the current
monolithic `DeviceConfigPage.tsx`, to avoid fixing code TASK-021 is about to
relocate)

## Desired outcome

The setup wizard's apply step reacts explicitly to a `SET_CONFIG_FAILED`
response from the daemon, the same way `ConfigCard`'s direct-edit save
already does, instead of silently ignoring it and reporting success once its
12-second timeout elapses regardless of whether the daemon actually accepted
every write.

## Context

Found while drafting CONTRACT-012 for TASK-021 (device-config transform
behavior). `ConfigCard`'s `handleSave()` explicitly listens for a
`{ type: "error", payload: { code: "SET_CONFIG_FAILED" } }` event and sets
`saveStatus = "error"` immediately. The wizard's `applyAll()` has no
equivalent handler — it only listens for a `device:config` event (success)
or its own timeout, so a real device-side rejection during a wizard apply is
invisible to the operator, who sees "applied" even though one or more writes
failed. This is a pre-existing asymmetry between the two transform paths,
not introduced by TASK-021 — CONTRACT-012 requires TASK-021 to preserve it
as-is, and this task is the deliberate, separately-reviewable fix.

## Scope

### Included

Add a `SET_CONFIG_FAILED` listener to the wizard's apply logic (wherever
TASK-021 relocates `applyAll()`), surfacing the failure to the operator in
the Review step's UI (mirroring `ConfigCard`'s error-state pattern —
consult whatever component TASK-021 produces for `ConfigCard`'s save-status
UI as the reference implementation, for visual/UX consistency).

### Excluded

Changing the wizard's success-path behavior (the `device:config` event
listener and 12-second timeout) beyond adding the new failure branch. Any
change to what the wizard sends or how many `device:set-config` commands it
issues — this only adds failure *detection*, not different apply behavior.
Retrying failed writes automatically — surfacing the failure to the operator
is in scope; auto-retry is a separate, larger design decision not implied by
this task.

## Plan

1) Confirm TASK-021 has landed and locate the wizard's apply logic in its
   new module. 2) Add a `SET_CONFIG_FAILED` event listener alongside the
   existing `device:config` listener, following the same pattern
   `ConfigCard` already uses. 3) Surface the failure in the Review step's UI
   — propose to Patrick if there's a real design choice about whether a
   partial failure (some writes succeeded, one failed) should block
   `applied = true` entirely or show a partial-success state, since the
   wizard sends multiple writes in one `applyAll()` call and the daemon's
   `SET_CONFIG_FAILED` response isn't correlated to which specific write
   failed (a related, but separate, gap — see TASK-041). 4) Add a test
   characterizing the new failure path, matching whatever test coverage
   TASK-021 established for the extracted apply module.

## Acceptance criteria

- [ ] The wizard's apply flow explicitly handles a `SET_CONFIG_FAILED` event
      and surfaces it to the operator instead of silently completing via
      timeout.
- [ ] The success path (device:config event, 12s timeout) is unchanged.
- [ ] A test characterizes the new failure-handling behavior.
- [ ] No change to what the wizard sends or how many commands it issues.

## Validation requirements

New unit test for the failure path; manual verification against a real or
simulated device by triggering a rejected config write during a wizard
apply, if feasible.

## Risks and assumptions

Low-to-moderate risk — additive UI/logic change to an already-isolated apply
function, with `ConfigCard`'s existing handling as a direct precedent to
follow. Main open design question (partial-failure UX) is flagged in the
Plan for Patrick's input rather than decided unilaterally.

## Blocker

Awaiting TASK-021 to land, and awaiting Patrick's approval to move this out
of `proposed/`.

## Implementation handoff

Implemented by openai-coder on 2026-08-25.

### Changes made

- Added `applyError` state to
  `packages/web/src/components/config/SetupWizard.tsx`. Each manual apply clears
  the prior error. The new `SET_CONFIG_FAILED` branch clears the timeout,
  unsubscribes and clears the listener, sets `applying = false`, forces
  `applied = false`, and sets `applyError = true`.
- Added an `applyError` prop to
  `packages/web/src/components/config/ReviewStep.tsx`. When set, the Review step
  renders an error banner above the changes list while leaving the Apply button
  available for manual retry.
- Added the error-banner styling to
  `packages/web/src/components/config/ReviewStep.module.css`, using the same
  error colors and status-message pattern as `ConfigCard`.
- Added `packages/web/src/components/config/SetupWizard.test.tsx` with two
  component tests using a mocked `foremanClient`: one covers a failure followed
  by a possible success event, and one covers a success event followed by a
  failure. Both assert that the failure banner and retry button are shown and
  that the final UI does not show `Config applied`.

### Validation performed

All commands below were run from `packages/web` with the repository's pinned
pnpm via Corepack under Node 22:

- `pnpm test`: passed — 14 test files and 55 tests passed.
- `pnpm build`: passed — TypeScript emitted no diagnostics; Vite transformed
  1,892 modules and completed the production build in 10.24s. The existing
  advisory about chunks larger than 500 kB was reported.
- `pnpm lint`: passed with 0 errors and 5 warnings. The warnings are pre-existing,
  unrelated `react-hooks/exhaustive-deps` warnings in `DeviceConfigPage.tsx`,
  `MapPage.tsx`, and `NodeDetailPanel.tsx`; none of those files was touched by
  this change.
- `pnpm format:check`: passed — `All matched files use Prettier code style!`
- Focused `pnpm exec vitest run src/components/config/SetupWizard.test.tsx`:
  passed — 1 test file and 2 tests passed.
- `git diff --check`: passed with no output.

### Assumptions and deviations

- Adapted `ConfigCard`'s error copy to the wizard context as
  `Apply failed — check device connection and try again`.
- Per Patrick's pre-made design decision, any `SET_CONFIG_FAILED` received during
  a wizard apply is treated as failure of the whole operation; no partial-success
  state is attempted.
- Review identified an event-ordering race because the wizard issues several
  writes in one batch. The failure branch therefore explicitly forces
  `applied = false`, ensuring a failure always wins even if a `device:config`
  event for another write arrived first. The existing success branch and timeout
  behavior were otherwise left unchanged.

### Unresolved risks

- Correlation of a failure to the specific configuration write remains out of
  scope and is deferred to TASK-041, consistent with this task's explicit
  exclusion.
- No live or manual hardware verification was performed. Validation used
  automated component tests with a mocked `foremanClient`.

## Review

Not reviewed.

## Human acceptance

Pending.
