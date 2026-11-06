# TASK-047: Add Debug page with diagnostics and tools

Owner role: interface-designer (frontend), implementer (daemon)
Assigned agent: Codex
Proposed by: Claude, at Patrick Moon's request
Proposed date: 2026-11-04
Approved by:  Patrick
Approved date: 2026-11-06
Related contracts: CONTRACT-013 (Proposed)
Related ADRs: ADR-004
Dependencies: None. Should follow TASK-046 so the page uses its text tokens.

## Desired outcome

A user can open Settings > Debug, see what is wrong with the radio connection in
plain language, and act on it from the UI where that is possible.

## Context

On 2026-11-04 the GPS menu reported "Node ID not yet known". Investigation found
the radio had sent no frames since the daemon started, while the UI still showed
`connected`, cached Radio Config, a live node list from MQTT, and a green MQTT
light. The cause was only visible by reading daemon logs. Specific gaps:

- `connected` means the serial port opened, not that the radio answered.
- `configure()` resolves after a 60 second timeout whether or not the radio
  replied, so the log says "configuration completed" either way.
- The daemon does not record when it last received a frame from the radio.
- The cached config page gives no sign that its data is stale.
- The port is locked by the daemon, so outside tools need it disconnected first.

With the daemon stopped, two independent raw probes (Node `serialport`, then
shell `stty` and `cat`) sent a wake sequence and `wantConfigId` to the radio and
received 0 bytes. The USB device was still enumerated and active. This confirmed
the radio's firmware had stopped answering and ruled out the daemon's read path.
That test should be available from the UI, because a hung radio needs a physical
power cycle that no software tool here can perform.

Follow-up on 2026-11-06: after a power cycle, the same config request received
15,893 bytes and completed in under a second with a matching nonce. The radio's
clock showed it rebooted when `/dev/ttyACM0` returned, so the firmware hang is
confirmed. The USB link and permissions were not the cause, and ModemManager
listed no modems, though its logs could not be read. The cause of the hang is
unknown, so it may recur.

The same test corrected an earlier finding: the radio stayed silent for 8 seconds
of passive listening while healthy. Silence alone is not a fault. Only a request
with no reply is.

Two code facts shape this task:

- `configure()` takes 60 seconds on a healthy radio too, because `wantConfigId`
  is never acked and waits out the queue timeout. `connect()` waits for it.
- `disconnect()` returns early when the device is not in the live list, so during
  reconnect backoff it leaves the reconnect timer running.

Disconnect already exists: `DELETE /api/devices/:id` and the device menu. Debug
reuses it and does not add a second path.

## Scope

### Included

**Daemon**

- Per-device tracking: last frame received, frames received this connection,
  whether `DeviceConfigured` was reached, and last config request time.
- `GET /api/debug/checks`, which runs the read-only checks below and returns
  each with a status, summary, likely cause, suggested fix, and tool IDs.
- `POST /api/debug/tools/:toolId`, which runs one allowlisted tool on one device.
- A fix to `disconnect()` so it also works during reconnect backoff and while
  `connect()` is in flight, as CONTRACT-013 requires.
- Documentation in `API_PROMISES.md`.

**Checks** (`pass`, `warn`, `fail`, or `skipped`)

| Check | Detects |
|---|---|
| Serial port present | Configured device path is missing |
| Serial port permission | Daemon user cannot open the port |
| Connection held | Daemon holds the port, or it is released |
| Radio responding | A config request got no frame back within the response window (the 2026-11-04 failure) |
| Configuration finished | `DeviceConfigured` was never reached |
| Node ID known | Own node number was not received |
| Config freshness | Displayed config is cached, not from this session |
| GPS | No position received, and the cached GPS mode |
| MQTT broker | Broker connection, reported separately from the radio |
| Versions | Firmware and `@meshtastic/core` versions, for information |
| Saved devices | Saved rows for ports that do not exist |

**Tools**

| Tool | Action | Confirmation |
|---|---|---|
| Rerun checks | Runs all checks | No |
| Re-request config | Runs `configure()` | No |
| Disconnect serial | Existing disconnect, releases the port | Yes |
| Reconnect serial | Existing connect path | No |
| Raw serial probe | Reopens the port, sends a config request, reports the outcome | Yes |

**Web**

- A `Debug` item under Settings, a `debug` tab, and a Debug page.
- Connection status panel: port, port held, last frame age, frame count.
- Check list with status, cause, fix, and inline tool buttons on failures.
- A note after Disconnect that the port is free for outside tools such as
  `meshtastic --port <port> --info`, and a way to reconnect. The note also says
  a responding radio can be restarted with `meshtastic --port <port> --reboot`.
- Copy results as text for sharing.

### Excluded

- Running arbitrary shell commands, or any tool not on the allowlist.
- Bundling or running the Meshtastic CLI.
- A Reboot radio tool. It needs a responding radio, so it could not clear the
  hang, and it would add an unauthenticated action on the LAN.
- Factory reset, config writes, or deleting saved devices.
- Changing the meaning of `connected` across the app, and the app-wide "not
  responding" status. Both are in TASK-048.
- Authentication for the API.

## Plan

1. Add frame tracking and the `disconnect()` fix to `DeviceManager`, with tests.
2. Add a checks module that returns results as data, with one test per check.
3. Add debug routes with Zod validation following CONTRACT-007.
4. Add the page, menu item, and tab.
5. Update `API_PROMISES.md` and the user guide.

## Acceptance criteria

- [ ] Settings shows Debug, which opens the Debug page.
- [ ] With a silent radio, Radio responding fails and says so in plain language.
- [ ] A healthy radio with no traffic and no unanswered request does not fail
      Radio responding.
- [ ] Each failing check gives a cause and a next step, and offers a tool
      button where a tool can help.
- [ ] Disconnect releases the port so an outside tool can open it, and the
      daemon does not auto-reconnect until asked or until the daemon restarts.
- [ ] Disconnect works during reconnect backoff, and a Disconnect during an
      in-flight connect does not end with the app showing `connected`.
- [ ] Reconnect restores the connection without restarting the daemon.
- [ ] Reconnect and Re-request config return immediately and show progress,
      rather than holding a request open for the 60 second `configure()`.
- [ ] A second tool on the same device is rejected while one is running.
- [ ] Disconnect and Raw serial probe require confirmation.
- [ ] Raw serial probe bypasses `@meshtastic/core`, sends its request without a
      passive wait, stops when config completes, never opens the port below
      115200 baud, and restores the previous connection state afterwards.
- [ ] The probe reports one of the outcomes in CONTRACT-013, with bytes and frames
      received.
- [ ] When the probe receives 0 bytes, the page tells the user to power-cycle
      the radio, including its battery if it has one.
- [ ] When the probe's config request completes, the page says the radio is healthy
      and the daemon connection is the next thing to check.
- [ ] Tool IDs outside the allowlist are rejected with a validation error.
- [ ] Tools take a `deviceId` and only ever open that device's saved port.
- [ ] Checks still return useful results when no device is connected.
- [ ] Checks never expose keys, PSKs, or MQTT credentials.
- [ ] Checks work with Linux paths and Windows COM ports.
- [ ] The page is usable at phone width and from another machine on the LAN.

## Validation requirements

`pnpm lint`, `pnpm build`, and `pnpm test`. Also a manual run against a real
radio covering a healthy link, a disconnect followed by an outside tool opening
the port, a reconnect, and a silent or unplugged radio.

## Risks and assumptions

- The API binds to `0.0.0.0` and has no authentication, so anyone on the LAN
  could use these tools. Disconnect is already exposed this way, and the probe
  briefly drops the connection. Mitigated by the allowlist, by using saved ports
  only, and by leaving out destructive actions.
- A disconnect must not be undone by the reconnect logic or by a `connect()`
  still in flight. Both need tests.

## Decisions

Recorded from the human on 2026-11-06:

1. The app-wide "not responding" status is a follow-up task: TASK-048.
2. Reboot radio is left out. Instead of a hover tooltip, which does not work at
   phone width, the page shows the reboot suggestion as visible text.
3. A separate contract is required: CONTRACT-013.

## Blocker

Needs CONTRACT-013 to be accepted by the human before this task can be approved.

## Implementation handoff

Not started.

## Review

Not reviewed.

## Human acceptance

Pending.
