# TASK-051: Show firmware version on Device Config

Owner role: interface-designer (frontend), implementer (daemon)
Assigned agent: interface-designer
Proposed by: Claude, at Patrick Moon's request
Proposed date: 2026-11-06
Approved by: Patrick
Approved date: 2026-11-06
Related contracts: None. Small work, covered by the acceptance criteria below.
Related ADRs: ADR-004
Dependencies: None. Should follow TASK-048 so the display uses its text tokens.

## Desired outcome

Settings > Device Config clearly shows the selected radio's firmware version, and
the value stays correct while the app runs.

## Context

The radio already reports its firmware version in the config stream. The daemon
saves it in `devices.firmware` and sends it as `firmwareVersion` in `device:status`
and `device:list`. Today it appears only as a small `fw` label in the device menu,
and `DeviceConfigPage.tsx` does not show it.

The page cannot rely on the current value, because of a bug. `_emitStatus` in
`device-manager.ts` hardcodes `firmwareVersion` and `hardwareModel` to `null`, and
the web reducer replaces the whole device on each `device:status` event. The value
is therefore wiped by later status events, including the `connected` event emitted
when `connect()` finishes and the re-emit on each GPS fix. It returns only on a
battery update, a metadata packet, or a page reload, which read or carry the real
value. This was found by reading the code and has not been observed in the running
app.

## Scope

### Included

- `_emitStatus` carries the known firmware version and hardware model instead of
  `null`, so all status events agree.
- A metadata packet with no version does not erase a known version.
- A clearly visible firmware version at the top of the Device Config page, for the
  selected device, on each device when several are connected.
- The version also shows when no config has been received yet for the device.
- For a disconnected device, the saved version is labelled as last reported.
- When no version is known, the page says "Not reported yet".
- An update to the user guide.

### Excluded

- Comparing against the latest release, or update prompts.
- Firmware flashing or updates.
- Showing hardware model on this page.
- Changing how Device Config chooses its selected device.

## Plan

1. Fix `_emitStatus` and metadata handling, with tests.
2. Add the firmware display to `DeviceConfigPage.tsx`.
3. Check the page with a connected radio, then after a disconnect.

## Acceptance criteria

- [x] Device Config shows the firmware version without opening any menu.
- [x] The version is shown even before config has been received for the device.
- [x] With several devices, it matches the selected device.
- [x] The version stays visible after `connect()` finishes and after a GPS update.
- [x] A test confirms every `device:status` event for a device with a known version
      carries that version, for both `firmwareVersion` and `hardwareModel`.
- [x] A metadata packet with no version leaves the saved version unchanged.
- [x] A disconnected device's version is labelled as last reported.
- [x] An unknown version reads "Not reported yet", not a blank or `null`.
- [x] The display is readable at phone width and meets the text contrast target.

## Validation requirements

`pnpm lint`, `pnpm build`, and `pnpm test`, plus a manual check against a real radio
that the version on the page matches `meshtastic --port <port> --info`.

## Risks and assumptions

- The in-memory copy of the version must be cleared or reloaded with the device's
  other per-connection state, so a swapped radio on the same port cannot show the
  old radio's version once it has reported its own.
- TASK-047's Versions check and TASK-049's status changes read or touch the same
  status event, so whichever comes second should build on this fix.

## Blocker

None.

## Implementation handoff

Task: TASK-051
Implementer: Claude (interface-designer agent, finished by the main session after a
machine lockup)
Date: 2026-11-06

### Changes made

- `device-manager.ts`: status events carry the saved firmware version and hardware
  model. Versions are loaded from the device row on connect, kept per device across
  disconnects, and replaced when a metadata packet reports new values. A metadata
  packet with an empty field no longer erases the saved value.
- `firmwareDisplay.ts` and `DeviceConfigPage.tsx`: a firmware panel at the top of
  Device Config, with last-reported and "Not reported yet" states.
- `docs/guide/getting-started.md`: new section on checking the firmware version.

### Validation performed

- `pnpm test`: 505 pass (shared 31, web 133, daemon 341), peak 6.7 GB.
- `pnpm lint`: 0 errors, 5 warnings, all in code this task did not change.
- `shared`, `daemon` and `web` build. `pnpm build` still fails on the existing
  `CONTRACT-008` docs error, unrelated to this task.
- Contrast on the panel background: label 10.01:1, version 14.97:1, unknown text 8.1:1.
- The panel's CSS was rendered at 375px, including a long unbroken version string,
  with no overflow. That render used the panel alone with approximate colours, not
  the running app.

### Acceptance criteria evidence

Component tests cover the display states and device selection. Daemon tests cover
status events on every path, metadata packets, disconnects and radio swaps.

### Assumptions and deviations

- `device-manager.test.ts` gained an `afterEach` that shuts the manager down and
  closes the database. This is outside the task's scope and Patrick approved it. Each
  test leaked a PGlite instance, the suite passed 6 GB, and it contributed to the
  lockup on 2026-11-06. The suite now peaks at 1.9 GB. It is a separate commit.

### Unresolved risks

- The manual check is not done: compare the page against
  `meshtastic --port <port> --info` on a real radio, then after a disconnect.
- TASK-047's Versions check and TASK-049 touch the same status event. TASK-047 is on
  this branch and all tests pass, but neither has been run against a real radio with
  this change.

### Documentation updated

`docs/guide/getting-started.md`.

## Review

Not reviewed.

## Human acceptance

Pending.
