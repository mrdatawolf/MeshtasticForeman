# TASK-041: Correlate device:set-config completion events to device and write

Owner role: Implementer
Assigned agent: openai-coder
Proposed by: contract-architect (via Claude, orchestrating session), per CONTRACT-012's Open question #3
Proposed date: 2026-08-24
Approved by:
Approved date:
Related contracts: CONTRACT-012 (documents this as a known, deliberately-preserved
gap under TASK-021's "behavior-preserving only" scope; this task is the
fast-follow that closes it, matching the TASK-039/CONTRACT-001 precedent)
Related ADRs: None
Dependencies: TASK-021 (hard blocker — targets the apply modules for both the
wizard and `ConfigCard` after TASK-021 extracts them, not the current
monolithic `DeviceConfigPage.tsx`); benefits from TASK-040 landing first
since both touch the wizard's apply-completion logic, but is not strictly
blocked by it — confirm no merge conflict with TASK-040's changes before
starting if both are in flight.

## Desired outcome

Both the wizard's `applyAll()` and `ConfigCard`'s `handleSave()` treat only a
`device:config` event that actually corresponds to their own write (same
`deviceId`, and ideally the same `namespace`/`section` for `ConfigCard`) as
completion — not the first `device:config` event received from any device,
regardless of source.

## Context

Found while drafting CONTRACT-012 for TASK-021. Today, both apply paths
listen for *any* `device:config` event from the WS client and treat it as
confirmation of their own write. In a single-device session this is
unobservable. With multiple connected devices open simultaneously (the
daemon supports multi-device per its architecture), a `device:config` event
for device B can be misread as confirmation for a write actually sent to
device A — a latent cross-device false-positive that could report a wizard
apply or field save as successful when it hasn't actually been confirmed for
the intended device.

## Scope

### Included

Filtering the `device:config` event listener in both the wizard's apply
logic and `ConfigCard`'s `handleSave()` to require the event's `deviceId`
match the write's target `deviceId` before treating it as completion.
`ConfigCard` should ideally also confirm the event's config actually
reflects the `namespace`/`section` that was written, if the `device:config`
event payload carries enough information to check that (confirm during
implementation — if it doesn't, filtering by `deviceId` alone is an
acceptable partial fix, and the section-level gap should be noted rather
than silently left unmentioned).

### Excluded

Changing the event's payload shape or the daemon's `device:config` broadcast
behavior — this is a frontend-only filtering change against the existing
event shape. Any change to the wizard's or `ConfigCard`'s success/failure UX
beyond correcting which events count as "theirs" (TASK-040 covers explicit
failure-handling; this task is about correctly scoping success detection).

## Plan

1) Confirm TASK-021 has landed and locate both apply-completion listeners in
   their new modules. 2) Confirm the exact shape of a `device:config` event
   payload (check `packages/shared/src/ws-protocol.ts`/`types.ts`) to see
   what identifying information it carries. 3) Add a `deviceId` filter to
   both listeners. 4) If the payload supports it, add a
   `namespace`/`section` filter to `ConfigCard`'s listener specifically,
   since it's a single-section write and can be checked precisely. 5) Add
   tests simulating a `device:config` event for an unrelated device arriving
   during an in-flight apply/save, confirming it's correctly ignored.

## Acceptance criteria

- [ ] The wizard's apply-completion listener ignores `device:config` events
      for a different `deviceId` than the one being configured.
- [ ] `ConfigCard`'s save-completion listener ignores `device:config` events
      for a different `deviceId` (and section, if payload-feasible) than the
      one being edited.
- [ ] A test demonstrates an unrelated device's `device:config` event no
      longer triggers a false-positive completion.
- [ ] Single-device sessions behave identically to before (no regression to
      the common case).

## Validation requirements

New unit tests for the multi-device false-positive scenario; manual
verification with two connected devices if available, triggering a config
change on one while the other has an in-flight apply/save.

## Risks and assumptions

Low risk — additive filtering logic against an existing event stream, not a
protocol or payload change. Main risk is the payload not carrying enough
information for the `ConfigCard` section-level check; if so, ship the
`deviceId`-level fix and document the remaining section-level gap rather
than blocking the whole task on it.

## Blocker

Awaiting TASK-021 to land, and awaiting Patrick's approval to move this out
of `proposed/`.

## Implementation handoff

Not started.

## Review

Not reviewed.

## Human acceptance

Pending.
