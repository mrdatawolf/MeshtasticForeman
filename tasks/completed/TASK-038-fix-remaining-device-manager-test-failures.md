# TASK-038: Fix remaining device-manager.test.ts failures

Owner role: Implementer
Assigned agent: openai-coder
Proposed by: jarvis (via Claude, orchestrating session)
Proposed date: 2026-08-24
Approved by: Patrick
Approved date: 08/24/26
Related contracts: None
Related ADRs: None
Dependencies: TASK-037 (built on top of its mock fix; these are the 4
failures TASK-037 explicitly left unfixed as out of its scope)

## Desired outcome

`pnpm --filter @foreman/daemon test` passes 69/69 (up from 65/69 after
TASK-037), so the daemon test suite is fully green and TASK-003 (CI) can
enforce `pnpm test` without day-one failures.

## Context

Discovered while validating TASK-037. Confirmed via direct code reading (not
just the failure output) that these are 3 distinct, unrelated root causes —
not one bug:

**1. "converts latitudeI / longitudeI to decimal degrees"** — genuinely
ambiguous, needs a decision, not just a fix. The test dispatches a
`NodeInfo` packet via `onNodeInfoPacket` with a nested `position: {latitudeI,
longitudeI, altitude}` object (see `makeNodeInfo()` at
`device-manager.test.ts:448`) and expects `_handleNodeInfo` to persist that
position into the `nodes` table. But `_handleNodeInfo`
(`device-manager.ts:1035`) never reads `nodeInfo.position` at all — it only
inserts `long_name`/`short_name`/`mac_address`/`hw_model`/`public_key`/
`last_heard`/`snr`/`hops_away`, then *reads back* whatever position is
already in the DB (line 1086-1094, populated only by a separate
`_handlePosition()` triggered by `onPositionPacket`, which reads
`pkt.data.latitudeI`/`longitudeI` — a different packet shape entirely, see
`device-manager.ts:1118-1127`). Two possible fixes, and this task should not
presume which without checking the real `@meshtastic/core` protocol: (a) the
test fixture is wrong — a real `onNodeInfoPacket` never carries embedded
position data in practice, so the test should dispatch position separately
via `onPositionPacket` instead; or (b) production code has a real gap — real
NodeInfo packets from the Meshtastic protocol *do* sometimes carry embedded
position, and `_handleNodeInfo` should persist it when present, not silently
drop it. Check the actual `@meshtastic/core` `NodeInfo`/`User` protobuf
shape (via its type definitions or the upstream Meshtastic protobuf schema)
before deciding.

**RESOLVED via live device investigation (2026-08-24).** The human stopped
their running daemon (a separate checkout at `~/Scripts/MeshtasticForeman`)
to free `/dev/ttyACM0`, and the orchestrating session connected directly
with a temporary script (`MeshDevice` + `TransportNodeSerial`, same pattern
as `device-manager.ts`'s own `connect()`) to observe real mesh traffic for
60 seconds. Result, over 80 real `onNodeInfoPacket` events: every single one
that carried an embedded `position` object (62 of 80) was immediately
followed by a synthesized `onPositionPacket` carrying the *identical*
position data (62 paired position events, plus 1 extra standalone position
broadcast unrelated to any nodeinfo — 63 total). Every `onNodeInfoPacket`
*without* embedded position had no such pairing. The correlation was 100%
consistent — no exceptions across all 80 observations.

**Conclusion: direction (a) is correct — the test fixture is wrong, not
production code.** `@meshtastic/core`'s `MeshDevice` library itself
synthesizes a separate `onPositionPacket` whenever an incoming NodeInfo
protobuf carries embedded position data, in addition to firing
`onNodeInfoPacket`. `_handleNodeInfo` correctly leaves position untouched
because `_handlePosition` (triggered by the library's synthesized
`onPositionPacket`) already captures it — this is not a gap, it's working
as designed against real device behavior. The test's `makeNodeInfo()`
fixture (`device-manager.test.ts:448`) dispatches *only* via
`onNodeInfoPacket` with no accompanying `onPositionPacket`, which doesn't
match how the real library actually behaves — that mismatch, not a
production bug, is why the test fails. Fix: either have the "converts
latitudeI / longitudeI" test also dispatch a matching `onPositionPacket`
(mirroring real device behavior, exercising `_handlePosition`) after
`onNodeInfoPacket`, or move the assertion to a `_handlePosition`-focused
test dispatched purely via `onPositionPacket`. No change to
`device-manager.ts` for this issue.

**2. "emits device:status disconnected when the device reports disconnect"**
(`device-manager.test.ts:596`) — timing bug in the test, not production.
The `onDeviceStatus.subscribe` handler at `device-manager.ts:188` invokes
`_handleDeviceStatus` fire-and-forget (`void this._handleDeviceStatus(...).catch(...)`,
never awaited). `_handleDeviceStatus` (`device-manager.ts:555`) does
`await device.transport.disconnect().catch(() => {})` at line 583 *before*
calling `this._emitStatus(...)` at line 584. The test calls
`getFakeEvents().onDeviceStatus.dispatch(...)` and immediately asserts on
`emitted` with no await in between, so it checks before the async handler
has reached the emit. Note there is a *different*, currently-passing test
with an almost identical name at line 229 ("emits device:status
disconnected") that calls the public `await manager.disconnect(device.id)`
directly — that one works because it's actually awaited end-to-end. The
fix belongs in the test (await a flush, e.g. `await Promise.resolve()`
chained enough times, or a short real/fake-timer tick, before asserting) —
not in production code, which has no reason to make disconnect cleanup
synchronous.

**3 & 4. "schedules a reconnect attempt after 5 seconds" and "does not stack
multiple reconnect timers on rapid disconnect events"**
(`device-manager.test.ts:608`, `:629`) — both use `vi.runAllTimersAsync()`
after triggering a disconnect. `_startPacketWatchdog`
(`device-manager.ts:503`) sets up a legitimately-recurring `setInterval`
(45s) that keeps running for as long as `this.devices.has(deviceId)` is
true — by design, for as long as a device stays connected. `connect()`
calls `_startPacketWatchdog` again on reconnect (line 316, per the failure's
stack trace), so after these tests' simulated reconnect succeeds, there is
once again a live, intentionally-recurring interval with no reason to ever
clear itself within the test. `vi.runAllTimersAsync()` runs every pending
timer to exhaustion, including recurring intervals, and Vitest aborts with
"Aborting after running 10000 timers, assuming an infinite loop!" once it
hits its safety cap — this is a known fake-timers footgun when a
legitimately-recurring interval is in play, not evidence of an actual
infinite loop in production code. The fix is to replace
`vi.runAllTimersAsync()` in these two tests with
`vi.advanceTimersByTimeAsync(<exact ms needed>)` (e.g. `5000` for the first
reconnect attempt), which advances virtual time by a bounded amount instead
of running every timer to exhaustion.

## Scope

### Included

Fixing all 4 failures. For #1: the direction is now resolved (see Context) —
fix the test fixture to dispatch a paired `onPositionPacket` after
`onNodeInfoPacket`, matching real device behavior; no production code
change. For #2, #3, #4: test-only timing fixes as described above.

### Excluded

Any change to production code for any of the 4 issues — all are now
confirmed test-only fixes (issue #1's investigation is complete; see
Context for the resolved finding).

## Plan

1) For issue #1: update the "converts latitudeI / longitudeI to decimal
   degrees" test to dispatch a matching `onPositionPacket` (same
   `latitudeI`/`longitudeI`/`altitude` as `makeNodeInfo()`'s embedded
   `position`) immediately after `onNodeInfoPacket.dispatch(makeNodeInfo())`,
   mirroring the real device's synthesized-pairing behavior confirmed via
   live testing. Confirm the test then exercises `_handlePosition` and
   passes.
2) For issue #2: add a flush (e.g. `await Promise.resolve()` a couple of
   times, or `await vi.waitFor(...)`, whichever matches this test file's
   existing conventions for awaiting fire-and-forget handlers — check if
   other passing tests in this file already have a pattern for this) between
   `dispatch()` and the assertion.
3) For issues #3 and #4: replace `vi.runAllTimersAsync()` with
   `vi.advanceTimersByTimeAsync(5000)` (or the precise delay needed — confirm
   against `_scheduleReconnect`'s exponential backoff: 5000ms for the first
   attempt).
4) Run `pnpm --filter @foreman/daemon test` and confirm 69/69.
5) Confirm `routes/devices.test.ts` (9/9) and `ws-protocol.test.ts` (20/20)
   remain unaffected.

## Acceptance criteria

- [x] `pnpm --filter @foreman/daemon test` passes 69/69.
- [x] The latitude/longitude test dispatches a paired `onPositionPacket` matching real device behavior (confirmed via live testing 2026-08-24 — see Context), and passes by exercising `_handlePosition`.
- [x] All 4 issues are fixed in the test file only, with no changes to `device-manager.ts`.
- [x] `routes/devices.test.ts` and `ws-protocol.test.ts` remain passing unchanged.

## Validation requirements

`pnpm --filter @foreman/daemon test` full run, showing 69/69.

## Risks and assumptions

Low risk — all 4 issues are now confirmed test-only fixes with
well-understood root causes; issue #1's fix direction was resolved by live
device testing (2026-08-24, see Context) rather than left as an
implementation-time judgment call.

## Blocker

None.

## Implementation handoff

Implemented all four approved test-only fixes in
`packages/daemon/src/__tests__/device-manager.test.ts`:

1. The latitude/longitude conversion test now stores `makeNodeInfo()` in a
   local value, dispatches it through `onNodeInfoPacket`, and immediately
   dispatches the matching `onPositionPacket` using the fixture's `num`,
   `latitudeI`, `longitudeI`, and `altitude`. The existing 20 ms flush remains
   after both dispatches, so the assertions exercise `_handlePosition` after
   both fire-and-forget handlers settle.
2. The device-reported-disconnect status test now uses the file's established
   `await new Promise((r) => setTimeout(r, 20));` convention between dispatch
   and assertions, allowing the awaited transport disconnect and status emit
   to finish.
3. The single reconnect test now advances fake time by the bounded first
   reconnect delay with `await vi.advanceTimersByTimeAsync(5000);` instead of
   attempting to exhaust the recurring watchdog timer.
4. The rapid-disconnect timer-deduplication test uses the same bounded 5000 ms
   advance, verifying only one reconnect is created without exhausting the
   recurring watchdog timer.

Validation performed:

- `pnpm --filter @foreman/daemon test` could not start in the initial shell:
  exit 127, `pnpm: command not found`; no tests ran.
- `COREPACK_HOME=/tmp/meshtastic-foreman-corepack PATH=/home/patrick/.nvm/versions/node/v22.22.3/bin:$PATH corepack pnpm --filter @foreman/daemon test`
  could not download pnpm because sandbox DNS/network access returned
  `EAI_AGAIN`; no tests ran.
- `/home/patrick/.nvm/versions/node/v22.22.3/bin/node /tmp/meshtastic-foreman-corepack/pnpm/11.21.0/bin/pnpm.cjs --filter @foreman/daemon test`
  passed: 3/3 test files and 69/69 tests.
- `/home/patrick/.nvm/versions/node/v22.22.3/bin/node /tmp/meshtastic-foreman-corepack/pnpm/11.21.0/bin/pnpm.cjs --filter @foreman/daemon exec vitest run src/__tests__/routes/devices.test.ts`
  passed: 1/1 test file and 9/9 tests.
- `/home/patrick/.nvm/versions/node/v22.22.3/bin/node /tmp/meshtastic-foreman-corepack/pnpm/11.21.0/bin/pnpm.cjs --filter @foreman/daemon exec vitest run src/__tests__/ws-protocol.test.ts`
  passed: 1/1 test file and 20/20 tests.

Acceptance-criteria evidence:

- Full daemon suite: satisfied by the 69/69 passing full-suite run.
- Real-device position pairing: satisfied by the paired `onNodeInfoPacket` and
  `onPositionPacket` dispatches using the same fixture values; the full suite
  passes with the unchanged decimal-degree assertions.
- Test-only scope: satisfied; the four fixes are confined to
  `device-manager.test.ts`, with no change to `device-manager.ts` or other
  production source.
- Unaffected suites: satisfied by direct passing runs of
  `routes/devices.test.ts` (9/9) and `ws-protocol.test.ts` (20/20).

Assumptions: none beyond the resolved Context and approved Plan.

Unresolved risks: None.

## Review

Not reviewed.

## Human acceptance

Pending.
