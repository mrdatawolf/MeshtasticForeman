# TASK-040: Add SET_CONFIG_FAILED handling to the setup wizard's apply flow

Owner role: Implementer
Assigned agent: openai-coder
Proposed by: contract-architect (via Claude, orchestrating session), per CONTRACT-012's Open question #2
Proposed date: 2026-08-24
Approved by:
Approved date:
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

Not started.

## Review

Not reviewed.

## Human acceptance

Pending.
