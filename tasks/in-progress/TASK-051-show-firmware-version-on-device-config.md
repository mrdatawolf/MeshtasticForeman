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

- [ ] Device Config shows the firmware version without opening any menu.
- [ ] The version is shown even before config has been received for the device.
- [ ] With several devices, it matches the selected device.
- [ ] The version stays visible after `connect()` finishes and after a GPS update.
- [ ] A test confirms every `device:status` event for a device with a known version
      carries that version, for both `firmwareVersion` and `hardwareModel`.
- [ ] A metadata packet with no version leaves the saved version unchanged.
- [ ] A disconnected device's version is labelled as last reported.
- [ ] An unknown version reads "Not reported yet", not a blank or `null`.
- [ ] The display is readable at phone width and meets the text contrast target.

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

Not started.

## Review

Not reviewed.

## Human acceptance

Pending.
