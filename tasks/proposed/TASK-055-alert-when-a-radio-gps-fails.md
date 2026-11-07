# TASK-055: Alert when a radio's GPS fails

Owner role: Implementer (daemon), interface-designer (frontend)
Assigned agent:
Proposed by: Claude, at Patrick Moon's request
Proposed date: 2026-11-06
Approved by:
Approved date:
Related contracts: None yet. See Risks for the decision on CONTRACT-013.
Related ADRs: ADR-004
Dependencies: TASK-049, TASK-053

## Desired outcome

If a radio's GPS never gets a fix, or stops getting them, the app says so without
anyone having to notice missing positions.

## Context

A GPS cold start can take about 30 minutes, so a missing fix means nothing at first. If
nothing has arrived after that, something is probably wrong.

Today:

- `gpsAcquired` in `device-manager.ts` is only set from the MQTT gateway's `gps:position`
  event. With no `MQTT_BROKER`, no gateway exists, so a fix is never recorded. This was
  found by reading the code and has not been observed in a running app.
- Any non-zero coordinates count, which could include a manually set position.
- A fix sets `gpsAcquired` once per connection, and the time of the last fix is not kept.
- The Debug GPS check reports `warn` while it waits, and never `fail`.

Patrick's decisions, 2026-11-06: catch both a GPS that never gets a fix and one that fails
later. The timeout defaults to 30 minutes when `.env` does not set it. Tracking must work
without MQTT.

## Scope

### Included

- Track the radio's own GPS fixes in the device layer, with or without MQTT.
- Count only real GPS positions, not manual ones, and record the time of the last fix.
- `GPS_FIX_TIMEOUT_MINUTES` in the root `.env`, defaulting to 30 in `config.ts`, and
  documented in `.env.example` and `docs/SETUP.md`.
- No fix after that long from connecting: the GPS is reported as failed.
- A fix that stops arriving after one has been received: also reported as failed, using a
  limit based on the radio's position broadcast settings.
- A new status field beside `notResponding`, carried on `device:status` and `device:list`,
  with one event when the state changes in either direction.
- The Debug GPS check reports `fail` in this state.
- The GPS menu explains the failure, and the header shows an amber indicator, such as
  "GPS no fix: Field Node", that opens the Debug page.
- `API_PROMISES.md` and the user guide.

### Excluded

- Radios with GPS mode Disabled or Not present, which never alert.
- Automatic recovery, or changing the radio's GPS settings.
- Notifications outside the app.
- Keeping the timer across daemon restarts.

## Plan

1. Move fix tracking out of the MQTT gateway, keeping the gateway's own use of position.
2. Check on a real radio what `locationSource` and the position time report with and
   without a fix.
3. Add the `.env` setting, timers, and status field. Clear the timers on disconnect and
   shutdown.
4. Update the Debug check, GPS menu, and header indicator.
5. Update the docs.

## Acceptance criteria

- [ ] With no MQTT broker configured, a real GPS fix is recorded.
- [ ] A manually set position does not count as a fix.
- [ ] With `GPS_FIX_TIMEOUT_MINUTES` unset, the timeout is 30 minutes.
- [ ] An invalid `GPS_FIX_TIMEOUT_MINUTES` fails the same way as other bad config.
- [ ] No fix within the timeout reports failed, and not before.
- [ ] A fix that stops arriving reports failed once past the limit.
- [ ] A stationary radio that is working normally does not report failed.
- [ ] A radio with GPS mode Disabled or Not present never reports failed.
- [ ] A new fix clears the state without a reload.
- [ ] A radio that is not responding shows only that, with no GPS failure.
- [ ] With several radios, the header names each affected radio.
- [ ] The header shows both indicators correctly when different radios are affected.
- [ ] The display fits at phone width and meets the text contrast target.

## Validation requirements

`pnpm lint`, `pnpm build`, and `pnpm test`, plus a browser check at desktop and phone
widths. Manual run on a real radio, with MQTT on and off, and with the GPS unable to get a
fix. Run heavy commands under a memory cap.

## Risks and assumptions

- CONTRACT-013 has no rule for the GPS check. It comes from TASK-047, and only the code
  limits it to `warn`. No accepted contract changes, but `device:status` gains a field and
  the failure rule is new. Patrick decides whether the criteria here are enough or the
  rule belongs in CONTRACT-013, as Radio responding does.
- The limit for a fix that stops arriving is the riskiest part. A stationary radio may
  report rarely, and the radio may keep sending its last position after losing its fix.
  Plan step 2 must show what can be trusted. A limit that causes false alarms should come
  back to Patrick rather than ship.
- Assumes `locationSource` is reported reliably. If it is not, manual positions need
  another way to be excluded.
- The timer restarts on every connect, so a daemon restart delays the alert.
- Testing a real failure may need the antenna blocked or the GPS unplugged, which only
  Patrick can do.

## Blocker

None.

## Implementation handoff

Not started.

## Review

Not reviewed.

## Human acceptance

Pending.
