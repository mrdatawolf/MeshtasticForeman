# TASK-049: Show not-responding status across the app

Owner role: interface-designer (frontend), implementer (daemon)
Assigned agent: general-purpose subagent
Proposed by: Claude, at Patrick Moon's request
Proposed date: 2026-11-06
Approved by: Patrick
Approved date: 2026-11-06
Related contracts: CONTRACT-013 (Accepted)
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
- [x] The GPS menu no longer suggests reconnecting when the radio is not responding.
- [x] Both messages link to the Debug page.
- [x] Multiple devices each show their own state.

The first three criteria stay unticked until the manual run with a real radio.
Automated tests pass for all three, but they use a fake radio. See "Manual run for the
human" in the handoff.

## Validation requirements

`pnpm lint`, `pnpm build`, and `pnpm test`, plus a manual run with a silent or
unplugged radio.

## Risks and assumptions

- Assumes the field is added alongside `connected` rather than replacing it, so
  existing WebSocket consumers keep working.

## Blocker

Cleared. This task needed TASK-047 to be completed. On 2026-11-06 Patrick cleared
the blocker and said TASK-049 can move forward while TASK-047 was still in
`tasks/review/`. At the base commit for this work (`a4b4a3a`), the TASK-047 file
is already in `tasks/completed/`, and its code is present.

## Implementation handoff

Task: TASK-049
Implementer: general-purpose subagent (Claude)
Date: 2026-11-06

### Changes made

- `packages/shared/src/types.ts`: `DeviceInfo` gains `notResponding: boolean` beside
  `status`. `status` and `connected` keep their meaning.
- `packages/daemon/src/device/radio-state.ts` (new): `radioState` and `RadioState`
  moved here unchanged from `debug/checks.ts`, so the device layer does not import
  from the debug layer. `checks.ts` and `DeviceManager` now share this one rule.
- `device-manager.ts`:
  - `isNotResponding(id)` is true only for the `silent` state.
  - `_syncResponding` runs when a request opens the window, when a frame closes it,
    and when a per-device timer fires at the 25 second mark. It sends a status event
    only when the state changes, so frames do not each produce one.
  - That event repeats the last status sent rather than assuming `connected`. A radio
    silent from the start fails at 25 seconds, during the up to 60 seconds that
    `connect()` waits on `configure()`, while the status is still `connecting`.
  - `_emitStatus` works the value out at send time, so every path is correct.
  - The timer is cleared on a frame, on disconnect, on a dropped connection and on
    shutdown.
- `telemetry-handler.ts` and `routes/websocket.ts`: these build `DeviceInfo` by
  themselves and now set the field. A client that connects late gets the state from
  `device:list`.
- `DeviceMenu.tsx`: shows "Not Responding" in place of the status, with a red dot, a
  short message and an "Open Debug page" link, per device.
- `GpsMenu.tsx`: shows "Radio not responding, so position requests will not work" with
  the same link, in place of the "reconnect" hint. It also shows when the node ID is
  known. `AppShell.tsx` passes the navigation through.

### Validation performed

All commands ran one at a time under the required memory cap.

- `pnpm test`: 539 pass (shared 31, web 144, daemon 364), peak 6.6 GB.
- `pnpm lint`: 0 errors, 5 warnings, all in files this task did not change.
- `pnpm build`: passes, including the docs. `pnpm format:check`: passes.
- Browser check of the built app in headless Chromium, with `/api` and `/ws` mocked and
  no daemon or serial port: 15 of 15 checks passed. They covered both menus, both
  links, one hung and one healthy device, live clearing from a `device:status` event
  with no reload, and no horizontal scroll at 390px. The screenshots looked correct at
  desktop and phone width.

### Acceptance criteria evidence

New tests are in `device-manager-debug.test.ts` ("not responding status"),
`routes/websocket.test.ts` and `components/shell/notRespondingMenus.test.tsx`.

| Criterion | Evidence | Status |
|---|---|---|
| Fails the check, shows "not responding" | One event at exactly 25 s with no frame; none at 24.999 s; correct during `connecting` | Unticked, needs real radio |
| Clears without a reload | One event on the next frame; live clear in the browser | Unticked, needs real radio |
| Healthy quiet radio never shows it | 10 minutes of fake time with the watchdog answered | Unticked, needs real radio |
| GPS menu stops suggesting reconnect | Component test and browser check | Ticked |
| Both messages link to Debug | Component tests and browser check | Ticked |
| Each device shows its own state | Daemon, component and browser tests with two devices | Ticked |

### Manual run for the human

Not done. It needs a real radio. Run it from this branch, not the live install.

1. Connect a healthy radio and leave it idle for at least 5 minutes. The device menu
   should stay **Connected** throughout. This covers criterion 3.
2. Connect a radio that is silent, or make one stop answering while the USB port stays
   open. A board powered so that its USB serial chip stays up can do this. The device
   menu should show **Not Responding** 25 seconds after the first unanswered request.
   This covers criterion 1.
3. While it is silent, open the GPS menu. It should show the new message and no
   reconnect advice. Both links should open the Debug page, and Radio responding there
   should fail at the same time.
4. Let the radio answer with the USB connection still up. The state should clear
   without a reload. This covers criterion 2. A power cycle that drops USB goes through
   **Disconnected** and a reconnect instead.
5. Unplug a radio. Expect **Disconnected**, not Not Responding, because the port closes
   and the daemon no longer holds it. The contract gives that state as `skipped`.
6. With two radios, repeat step 2 on one. Only that radio should change.

### Assumptions and deviations

- The field is named `notResponding`.
- `radioState` moved, as allowed. `checks.ts` no longer exports it, and its test now
  imports it from `device/radio-state.js`.
- `isNotResponding` is a new public `DeviceManager` method, and two new log lines record
  each change of state.
- The task file's Blocker section says TASK-047 was in `tasks/review/` when Patrick
  cleared it. At the base commit (`a4b4a3a`) the file is already in `tasks/completed/`.

### Unresolved risks

- The state only appears once a request goes unanswered. A radio that hangs after a
  normal start waits for the packet watchdog, so it can take about 160 seconds to show
  (90 s stale, up to 45 s for the next check, 25 s window). This follows CONTRACT-013.
- The state is visible only with the menu open. The API button's dot still reports the
  API connection. A header indicator would go beyond this task's scope.
- With the radio not responding, the GPS menu still shows "Waiting for GPS fix…" and the
  Refresh GPS button when the node ID is known. Both were left unchanged.
- CONTRACT-004's table of `device:status` call sites (line 161) does not list
  `_syncResponding`. The contract is accepted, so it was not edited.
- `API_PROMISES.md` lists `DeviceInfo` for the REST device routes, but `GET /api/devices`
  really returns saved rows. The new field is WebSocket only, and the doc says so. The
  older mismatch was left alone.

### Documentation updated

`API_PROMISES.md` and `docs/guide/getting-started.md`.

## Review

Not reviewed.

## Human acceptance

Pending.
