# TASK-047: Add Debug page with diagnostics and tools

Owner role: interface-designer (frontend), implementer (daemon)
Assigned agent: Claude (implementer and interface designer)
Proposed by: Claude, at Patrick Moon's request
Proposed date: 2026-11-04
Approved by:  Patrick
Approved date: 2026-11-06
Related contracts: CONTRACT-013 (Accepted)
Related ADRs: ADR-004
Dependencies: None. Should follow TASK-048 so the page uses its text tokens.

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
  responding" status. Both are in TASK-049.
- Authentication for the API.

## Plan

1. Add frame tracking and the `disconnect()` fix to `DeviceManager`, with tests.
2. Add a checks module that returns results as data, with one test per check.
3. Add debug routes with Zod validation following CONTRACT-007.
4. Add the page, menu item, and tab.
5. Update `API_PROMISES.md` and the user guide.

## Acceptance criteria

- [x] Settings shows Debug, which opens the Debug page.
- [x] With a silent radio, Radio responding fails and says so in plain language.
- [x] A healthy radio with no traffic and no unanswered request does not fail
      Radio responding.
- [x] Each failing check gives a cause and a next step, and offers a tool
      button where a tool can help.
- [ ] Disconnect releases the port so an outside tool can open it, and the
      daemon does not auto-reconnect until asked or until the daemon restarts.
- [x] Disconnect works during reconnect backoff, and a Disconnect during an
      in-flight connect does not end with the app showing `connected`.
- [ ] Reconnect restores the connection without restarting the daemon.
- [x] Reconnect and Re-request config return immediately and show progress,
      rather than holding a request open for the 60 second `configure()`.
- [x] A second tool on the same device is rejected while one is running.
- [x] Disconnect and Raw serial probe require confirmation.
- [ ] Raw serial probe bypasses `@meshtastic/core`, sends its request without a
      passive wait, stops when config completes, never opens the port below
      115200 baud, and restores the previous connection state afterwards.
- [x] The probe reports one of the outcomes in CONTRACT-013, with bytes and frames
      received.
- [x] When the probe receives 0 bytes, the page tells the user to power-cycle
      the radio, including its battery if it has one.
- [x] When the probe's config request completes, the page says the radio is healthy
      and the daemon connection is the next thing to check.
- [x] Tool IDs outside the allowlist are rejected with a validation error.
- [x] Tools take a `deviceId` and only ever open that device's saved port.
- [x] Checks still return useful results when no device is connected.
- [x] Checks never expose keys, PSKs, or MQTT credentials.
- [x] Checks work with Linux paths and Windows COM ports.
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

1. The app-wide "not responding" status is a follow-up task: TASK-049.
2. Reboot radio is left out. Instead of a hover tooltip, which does not work at
   phone width, the page shows the reboot suggestion as visible text.
3. A separate contract is required: CONTRACT-013.

## Blocker

None.

## Implementation handoff

Task: TASK-047
Implementer: Claude, as implementer (daemon) and interface designer (frontend)
Date: 2026-11-06

**Needs the human:** the manual run against a real radio has not been done, because
agents must not open the port. Four criteria stay unticked until it is. Steps are
under "Manual run for the human".

### Changes made

**Daemon**

- `device-manager.ts`: per-connection frame tracking, with every config request
  going through one `_requestConfig()`. Requests core makes by itself after a
  radio reboot are caught from its `DeviceConfiguring` status event.
- `disconnect()` now works in every state. It stops the watchdog and backoff
  timer, cancels any running `connect()`, and returns only once the OS has
  released the port. `connect()` runs as a cancellable attempt, so a cancelled one
  stops at the next step and cannot act on a newer connection.
- New `reconnect()`, `requestConfig()`, `rawProbe()`, and `getConnectionFacts()`.
- New `device/raw-probe.ts`: opens the port directly with `serialport`, and frames
  and decodes by hand so it shares no code with the path it tests. A test checks
  the field numbers against the real schema.
- New `debug/checks.ts` and `routes/debug.ts`.
- `POST /api/devices/connect` returns `409` if a disconnect cancels it.

**Web**

- New `pages/DebugPage.tsx`, `api/debug.ts`, and `lib/debugReport.ts`, plus a
  Settings item and a `debug` tab. The page refreshes every 5 seconds and on any
  `device:status` change.
- `shellStyles.module.css`: the header and nav now wrap, and menu panels fit the
  screen under 640px. Without this, Settings was off-screen at phone width and
  the Debug page could not be reached.

**Other**

- `serialport` is now a direct daemon dependency, at the version already installed,
  and is external in `scripts/bundle-daemon.js`.
- `packages/daemon/vitest.config.ts`: raised test and hook timeouts to 20 seconds.
  See "Unresolved risks".
- Updated `API_PROMISES.md` and `docs/guide/getting-started.md`. The
  `DELETE /api/devices/:id` entry said it removes a device, which it does not, so
  that sentence is corrected.

### Validation

| Check | Result |
|---|---|
| `pnpm lint` | 0 errors. 5 existing warnings, none in files added here |
| `pnpm format:check` | Pass |
| `pnpm test` | Pass, on 2 consecutive runs: 331 daemon, 91 web, 31 shared |
| Build `shared`, `daemon`, `web` | Pass |
| `pnpm build` | Exits 1 only in `@foreman/docs`, on `CONTRACT-008` |
| Docs build with `CONTRACT-008` set aside | Pass, so the new docs add no failure |
| Browser check at 1280px and 375px, `/api` and `/ws` mocked | 17 of 17 checks pass |

No test or browser check opened a serial port. `serialport` and the transport are
fakes in every daemon test that could reach them, and the browser check ran against
a static copy of the build with no daemon behind it.

### Acceptance criteria evidence

Ticked criteria were verified with fakes or a mocked browser. Criteria that depend
on a real radio or a second machine are unticked.

- Unticked, "Disconnect releases the port so an outside tool can open it": the
  release and the no-reconnect behavior are tested with fakes. An outside tool
  opening the port needs the manual run.
- Unticked, "Reconnect restores the connection": tested with fakes only.
- Unticked, the "from another machine on the LAN" half of the last criterion.
  Phone width is verified. The page uses relative URLs and has a copy fallback for
  plain HTTP, but no second machine was used.
- Unticked, "Raw serial probe": its behavior is tested with a fake port, and the
  wire format with the real schema, but it has never run against a real radio.

### Manual run for the human

Run these on the normal daemon, not from a worktree.

1. Healthy link: open Settings > Debug. Radio responding, Configuration finished,
   and Node ID known should pass.
2. Raw serial probe: confirm it. Expect "The radio is healthy", about 15 KB in
   under a few seconds, and the connection back within about a minute.
3. Disconnect serial: confirm it, then run `meshtastic --port /dev/ttyACM0 --info`
   in a terminal. It should work. Wait two minutes and check the daemon has not
   reconnected.
4. Reconnect serial: the status should return to connected without a restart, and
   the page should show progress meanwhile.
5. During a reconnect, before it shows connected, use Disconnect serial. It should
   end disconnected and stay there.
6. Silent or unplugged radio: unplug it, or wait for a hang. An unplugged radio
   should fail Serial port present and go into backoff. Use Disconnect serial
   during backoff and check that retries stop.
7. Open the page from another machine on the LAN and use Copy results.

### Deviations and decisions

- The tool lock covers the request, not the 60 second background `configure()`.
  Holding it for the full 60 seconds would block Disconnect during an in-flight
  connect, which the contract requires to work. So a second Re-request config
  during that time is accepted.
- `DELETE /api/devices/:id` is not subject to the tool lock. During a probe it stops
  the probe, closes the port, and cancels the restore, and the probe's request gets
  `409`. The contract has no outcome for an interrupted probe, and reporting
  `no-response` would wrongly tell the user to power-cycle.
- A probe restores a device that was mid-connect as well as held or in backoff.
  The contract names only the latter two.
- A failed `reconnect` falls back to normal backoff, so a probe's restore survives
  a brief failure.
- Radio responding reports `warn` for the moment between holding the port and the
  first request. The contract has no row for this. It is not a failure, because
  nothing is unanswered yet.
- The Device menu's Connect button still connects after a disconnect. It is an
  explicit request, so it counts as asking.
- Reading the private `port` on the transport is the only way to observe the close,
  since the transport's `disconnect()` does not wait for it. It falls back to a
  3 second timeout.
- Page confirmations use `window.confirm`, as `MessagesPage` does.
- `configure()` can stay pending forever after the port closes, because core clears
  its queue without settling the promise. `connect()` therefore races it against
  cancellation.

### Unresolved risks

- **Hung radio status, resolved 2026-11-06.** As first written, the watchdog's repeat
  requests reset the 25 second window, so the check alternated between `fail` and
  `warn`. Patrick approved amending CONTRACT-013: the window now counts from the first
  unanswered request, so the check stays `fail` until a frame arrives.
- **Packaged installer not verified.** `serialport` is now copied to
  `dist-daemon/node_modules`, but the bundler copies single packages and not their
  dependencies. `@meshtastic/transport-node-serial` already relies on the same
  package, so this should not be a new failure, but no installer was built.
  `@meshtastic/core` version shows as unknown in a bundled daemon.
- **Test timeouts.** With the new test files, `pnpm test` began failing
  `db/__tests__/open.test.ts` on the 5 second default, because all packages run at
  once. It passed alone, and with the new files removed. I raised the daemon's
  timeouts rather than dropping tests. Review should check this is acceptable.
- The DebugPage component has no automated test, because the web package has no
  component test library. Its logic is in `debugReport.ts`, which is tested, and the
  page was checked in a browser.

## Review

Not reviewed.

## Human acceptance

Pending.
