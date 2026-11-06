# TASK-048: Show not-responding status across the app

Owner role: interface-designer (frontend), implementer (daemon)
Assigned agent: Codex
Proposed by: Claude, at Patrick Moon's request
Proposed date: 2026-11-06
Approved by: Patrick
Approved date: 2026-11-06
Related contracts: CONTRACT-013 (Proposed)
Related ADRs: ADR-004
Dependencies: TASK-047, which adds the frame tracking this task reads.

## Desired outcome

Outside the Debug page, the app makes it obvious when the radio has stopped
answering, instead of showing `connected` and misleading messages.

## Context

In the 2026-11-04 failure the device menu showed `connected` while the radio sent
nothing, and the GPS menu said "Node ID not yet known — reconnect to enable
position request". Reconnecting could not have fixed a hung radio. TASK-047 puts
the diagnosis on the Debug page and leaves the rest of the app unchanged.

## Scope

### Included

- A "not responding" state in the device menu, using the Radio responding rule in
  CONTRACT-013.
- Carrying that state in the `device:status` payload.
- A corrected GPS menu message when the radio is not responding.
- A link from these messages to the Debug page.

### Excluded

- Changing what the existing `connected` status means to other consumers.
- Automatic recovery or notifications.
- Showing the Debug page's detail outside that page.

## Plan

1. Add the field to the shared `device:status` type and the daemon's status event.
2. Emit a status event when the state changes in either direction.
3. Update the device menu and GPS menu.
4. Update `API_PROMISES.md` and the user guide.

## Acceptance criteria

- [ ] A radio that fails the Radio responding check shows "not responding" in the
      device menu within one status update.
- [ ] The state clears without a reload when the radio answers again.
- [ ] A healthy radio with no traffic never shows "not responding".
- [ ] The GPS menu no longer suggests reconnecting when the radio is not responding.
- [ ] Both messages link to the Debug page.
- [ ] Multiple devices each show their own state.

## Validation requirements

`pnpm lint`, `pnpm build`, and `pnpm test`, plus a manual run with a silent or
unplugged radio.

## Risks and assumptions

- Assumes the field is added alongside `connected` rather than replacing it, so
  existing WebSocket consumers keep working.

## Blocker

Needs TASK-047 to be completed.

## Implementation handoff

Not started.

## Review

Not reviewed.

## Human acceptance

Pending.
