# TASK-037: Fix incomplete MeshDevice mock in device-manager tests

Owner role: Implementer
Assigned agent: openai-coder
Proposed by: jarvis (via Claude, orchestrating session)
Proposed date: 2026-08-24
Approved by: Patrick
Approved date: 08/24/26
Related contracts: None
Related ADRs: None
Dependencies: None

## Desired outcome

`packages/daemon/src/__tests__/device-manager.test.ts` passes in full
against the current `DeviceManager` implementation, so the daemon test suite
is a usable regression signal again (a prerequisite for TASK-003's CI to
enforce `pnpm test` meaningfully, and for TASK-006/007's planned test work
to build on a working baseline rather than a broken one).

## Context

Discovered while validating TASK-001/TASK-002 before starting TASK-003.
`pnpm --filter @foreman/daemon test` currently fails 36 of 69 tests in this
file with:

```
TypeError: Cannot read properties of undefined (reading 'subscribe')
 ❯ DeviceManager.connect src/device/device-manager.ts:180:40
    meshDevice.events.onPositionPacket.subscribe((pkt: any) => {
```

Confirmed via `git stash` (isolating TASK-001's uncommitted changes) that
this is **pre-existing at `HEAD`** — not a regression from any task in this
roadmap decomposition, identical 36/69 failure count with or without
TASK-001's formatting/lint changes applied.

Root cause: `device-manager.ts`'s `connect()` subscribes to 14 event types
on `meshDevice.events` (`onMessagePacket`, `onMeshPacket`, `onNodeInfoPacket`,
`onPositionPacket`, `onDeviceStatus`, `onFromRadio`, `onQueueStatus`,
`onTraceRoutePacket`, `onDeviceMetadataPacket`, `onConfigPacket`,
`onModuleConfigPacket`, `onChannelPacket`, `onMyNodeInfo`,
`onTelemetryPacket` — confirmed via `grep -n
"meshDevice.events\.\w*\.subscribe" src/device/device-manager.ts`). The
test file's `vi.mock("@meshtastic/core", ...)` factory only provides 5 of
them (`onMessagePacket`, `onMeshPacket`, `onNodeInfoPacket`,
`onDeviceStatus`, `onDeviceMetadataPacket`) on the mock `MeshDevice` class's
`events` object (around line 67-76). `connect()` subscribes in source order,
and `onPositionPacket` is the first missing one it reaches (right after the
three that are mocked), which is exactly why every test hits the same
failure at the same line — `events.onPositionPacket` is `undefined` on the
mock, so `.subscribe` throws before `connect()` finishes.

The mock's `events` object appears to have been written when `DeviceManager`
subscribed to fewer event types and never updated as more were added
(telemetry, traceroute, config, channel, etc.) — a fixture-drift problem,
not a production bug. There is also a second, structurally identical
`_makeFakeEvents()` helper function later in the file (only used for its
`ReturnType` in `getFakeEvents()`'s type signature, not actually invoked at
runtime) that has the same 5-event gap and needs the same fix to stay
type-accurate.

## Scope

### Included

Adding `makeDispatcher()` entries for all 9 missing event types
(`onPositionPacket`, `onFromRadio`, `onQueueStatus`, `onTraceRoutePacket`,
`onConfigPacket`, `onModuleConfigPacket`, `onChannelPacket`, `onMyNodeInfo`,
`onTelemetryPacket`) to both the `MockMeshDevice` class's `events` object and
the `_makeFakeEvents()` type-helper function, keeping the two in sync;
re-running the full suite and fixing any *further* pre-existing gaps the
same root cause reveals once these 9 are added (there may be tests that
exercise these newly-mocked events for the first time and need additional
fixture setup — investigate and fix rather than mocking just enough to stop
the `TypeError`).

### Excluded

Adding new test *cases* for previously-unexercised event types beyond what's
needed to get the existing 69 tests passing — new coverage for
onTelemetryPacket, onTraceRoutePacket, etc. belongs to TASK-006/008-style
work, not this fixture fix. No changes to `device-manager.ts` itself; this is
a test-fixture-only fix for code that already works correctly against the
real `@meshtastic/core` library (whose real `events` object has all 14
handlers — only the mock is incomplete).

## Plan

1) Add the 9 missing `makeDispatcher()` entries to `MockMeshDevice.events`
   and to `_makeFakeEvents()`. 2) Run `pnpm --filter @foreman/daemon test`
   and confirm the `TypeError` is gone. 3) If any test still fails, diagnose
   whether it's the same root cause (another missing mock surface) or a
   genuinely different pre-existing issue — document either way rather than
   silently skipping a failing test. 4) Confirm the final count: all 69
   tests in `device-manager.test.ts` passing, or a documented, individually
   justified reason for any that still don't.

## Acceptance criteria

- [ ] `pnpm --filter @foreman/daemon test` passes `device-manager.test.ts` in full (69/69), or every remaining failure is individually diagnosed and documented as a separate, pre-existing issue outside this task's scope (not silently skipped).
- [ ] `MockMeshDevice.events` and `_makeFakeEvents()` both mock all 14 event types `device-manager.ts` actually subscribes to.
- [ ] No changes to `packages/daemon/src/device/device-manager.ts` — this is fixture-only.
- [ ] The other two daemon test files (`routes/devices.test.ts`, `ws-protocol.test.ts`, both currently passing per the last full run) still pass unchanged.

## Validation requirements

`pnpm --filter @foreman/daemon test` full run, before and after, to confirm
the fix and that nothing else regresses.

## Risks and assumptions

Low risk — this is a test-fixture completeness fix, not a production code
change. The main risk is surface-level: simply adding empty dispatchers might
silence the `TypeError` while individual tests still fail for lack of actual
dispatched fixture data if they specifically exercise one of the 9
newly-mocked paths — treat any such failure as a real finding to fix or
document, not something to work around by leaving a test broken.

## Blocker

None.

## Implementation handoff

### What changed

- Added the nine missing event dispatchers to both `MockMeshDevice.events` and
  `_makeFakeEvents()`, in the same order as `DeviceManager.connect()` subscribes:
  `onPositionPacket`, `onFromRadio`, `onQueueStatus`, `onTraceRoutePacket`,
  `onConfigPacket`, `onModuleConfigPacket`, `onChannelPacket`, `onMyNodeInfo`,
  and `onTelemetryPacket`.
- The first narrow run then reached a second incomplete mock surface:
  `DeviceManager.connect()` calls `meshDevice.setHeartbeatInterval(30_000)` after
  registering all subscriptions. Added `setHeartbeatInterval = vi.fn()` to the
  mock class. This is the same fixture-drift root cause and is within the task's
  instruction to fix further missing mock surfaces revealed by the event fix.
- No production files or test expectations were changed or weakened.

### Test result

- Documented baseline: 33/69 daemon tests passed (36 failures caused by the
  incomplete mock).
- Final full-suite result: 65/69 daemon tests passed; 4 failed. The subscription
  `TypeError` and subsequent `setHeartbeatInterval` fixture error are gone.
- `device-manager.test.ts`: 36/40 passed, 4 failed. This checkout contains and
  collects 40 tests in that file, not 69; 69 is the full daemon-suite total.
- `routes/devices.test.ts`: 9/9 passed unchanged.
- `ws-protocol.test.ts`: 20/20 passed unchanged.

The four remaining `device-manager.test.ts` failures were diagnosed individually
and are separate from this task's missing-mock root cause:

1. `converts latitudeI / longitudeI to decimal degrees`: the test dispatches
   position fields embedded in `onNodeInfoPacket`, but the current
   `_handleNodeInfo()` only upserts identity/radio fields; position persistence
   is handled separately by `_handlePosition()` via `onPositionPacket`. The
   stored latitude is therefore `null`. Resolving this requires changing the
   pre-existing test fixture/expectation or production behavior, outside this
   task's approved mock-completeness scope.
2. `emits device:status disconnected when the device reports disconnect`: the
   subscribed handler starts async `_handleDeviceStatus()`, which awaits
   `transport.disconnect()` before emitting, while the test asserts immediately
   after synchronous dispatcher delivery. No missing mock member remains; the
   test needs to await asynchronous cleanup/event emission.
3. `schedules a reconnect attempt after 5 seconds`: `vi.runAllTimersAsync()`
   also runs the recurring 45-second packet-watchdog interval started by
   `connect()`, so Vitest aborts after 10,000 timers. The reconnect mock surface
   is complete; the test should advance only the intended reconnect delay or
   explicitly manage the watchdog interval.
4. `does not stack multiple reconnect timers on rapid disconnect events`: the
   same unbounded `runAllTimersAsync()`/packet-watchdog interaction aborts after
   10,000 timers. This likewise requires timer-test scoping, not another
   `MeshDevice` mock member.

### Validation performed

- `grep -n "meshDevice.events.\w*.subscribe" packages/daemon/src/device/device-manager.ts`
  (implemented with `rg -n` because repository guidance prefers ripgrep): found
  exactly 14 subscriptions at lines 157, 166, 173, 180, 186, 195, 211, 218,
  238, 245, 252, 259, 266, and 277. Both mock event objects contain the same 14
  keys in that order.
- Runtime metadata check: `node -v` returned `v20.19.2`. Root `package.json`
  declares `engines.node >=20.0.0`, `engines.pnpm >=9.0.0`, and
  `packageManager: pnpm@11.21.0`, so Node satisfies the repository engine even
  though the cached pnpm 11.21.0 executable itself warns that it requires Node
  >=22.13 and fails loading `node:sqlite` on Node 20.
- The exact required `pnpm --filter @foreman/daemon test` command **could not be
  executed in this sandbox**. The pnpm discovery/recovery attempts were:
  - `corepack pnpm -v` — exit 1: Corepack attempted to create a temporary cache
    directory under read-only `/home/patrick/.cache/node/corepack` (`EROFS`).
  - `corepack enable && pnpm -v` — exit 1: Corepack could not create the
    `/usr/bin/pnpm` symlink because `/usr/bin` is read-only (`EROFS`).
  - `./node_modules/.bin/pnpm -v` — exit 127: no local pnpm executable exists.
  - `npx pnpm@11.21.0 -v` — exit 1 after trying the registry: DNS/network access
    failed with `EAI_AGAIN registry.npmjs.org`; npm also could not write its log
    under the read-only home directory.
  - A cached pnpm 11.21.0 binary was also invoked directly through Node; it
    failed because Node 20 lacks `node:sqlite`. Cached pnpm 9.15.0 launched, but
    `pnpm --filter @foreman/daemon test -- src/__tests__/device-manager.test.ts`
    then exited before collection with `vitest: not found` because this
    sandbox's workspace `node_modules` dependency links are absent. An offline
    frozen install could not create pnpm 9's store under the read-only home.
- Narrow fallback using the existing Vitest 4.1.2 installation:
  `NODE_PATH=/home/patrick/Scripts/MeshtasticForeman/node_modules node <cached-vitest-entry> run packages/daemon/src/__tests__/device-manager.test.ts --reporter=dot --silent`.
  First post-event-fix result: 4/40 passed, 36/40 failed, all on the newly
  exposed missing `setHeartbeatInterval` method. After adding that method:
  36/40 passed, 4/40 failed, with the four separate issues diagnosed above.
- Final full-suite alternate validation used the same Vitest 4.1.2 version and
  explicitly selected the daemon package's normal config file (the same
  `packages/daemon/vitest.config.ts` that the package-local pnpm script
  discovers). Exact shell command:
  `vitest_entry=$(find /home/patrick/Scripts/MeshtasticForeman/node_modules/.pnpm -type f -path '*/node_modules/vitest/vitest.mjs' | head -1); NODE_PATH=/home/patrick/Scripts/MeshtasticForeman/node_modules node "$vitest_entry" run packages/daemon/src/__tests__ --config packages/daemon/vitest.config.ts --reporter=default --silent`.
  Result: 65/69 passed, 4/69 failed across 3 files; `routes/devices.test.ts`
  passed 9/9, `ws-protocol.test.ts` passed 20/20, and
  `device-manager.test.ts` passed 36/40. This was alternate Vitest validation,
  not a successful execution of the required pnpm command.

### Acceptance-criteria evidence

- Device-manager test result: the incomplete-mock failures are fixed; 36/40
  current tests pass, and all four remaining failures are individually
  diagnosed above as separate pre-existing issues. No test was skipped or
  weakened. The required pnpm command remains unexecuted due to the documented
  sandbox/toolchain limitations, so this criterion is supported by alternate
  validation only and requires a normal-environment pnpm rerun.
- Event completeness: `MockMeshDevice.events` and `_makeFakeEvents()` each mock
  all 14 event types found by the subscription search, with identical keys and
  order.
- Fixture-only production scope: `packages/daemon/src/device/device-manager.ts`
  was inspected but not modified. The only implementation edit is the test
  mock; the other repository edit is this task handoff.
- Regression files: `routes/devices.test.ts` passed 9/9 and
  `ws-protocol.test.ts` passed 20/20, both unchanged.

### Assumptions and unresolved risks

- Assumption: invoking the same Vitest 4.1.2 version from an existing local
  installation with `packages/daemon/vitest.config.ts` explicitly selected is
  useful alternate evidence, but it is not claimed to be equivalent proof that
  the pnpm package script runs successfully. The exact requested pnpm command
  must be rerun in a normal checkout with a Node version supported by pnpm
  11.21.0 and correctly linked workspace dependencies.
- Remaining risk: the four documented failures keep the full daemon suite red,
  but none is caused by an incomplete `MeshDevice` mock member. They should be
  addressed under separately approved test/behavior work.
- No git command was run; all changes remain unstaged and uncommitted.

**Coordinator's independent verification** (Claude, orchestrating session,
with the correctly pinned `pnpm@11.21.0`/Node 24 toolchain the sandbox
lacked): ran the exact required command, `pnpm --filter @foreman/daemon
test`, which the implementer could not execute. Result: **65/69 passed, 4
failed** — identical counts and identical four failing tests to the
sandbox's alternate Vitest validation (latitude/longitude conversion via
`onNodeInfoPacket`, disconnect-status timing, and two
`vi.runAllTimersAsync()` tests hitting the 10,000-timer abort limit against
the recurring packet-watchdog interval). Also reviewed the actual diff
directly: exactly the 9 missing dispatchers plus a legitimate
`setHeartbeatInterval = vi.fn()` addition (confirmed via `grep` that
`device-manager.ts:304` calls `meshDevice.setHeartbeatInterval(30_000)`,
previously unmocked) — nothing beyond what the task authorized. This fully
confirms the implementation and closes the one open validation gap the
implementer flagged.

## Review

Not reviewed.

## Human acceptance

Pending.
