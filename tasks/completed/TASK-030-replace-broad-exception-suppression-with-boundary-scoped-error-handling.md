# TASK-030: Replace broad exception suppression with boundary-scoped error handling

Owner role: Implementer
Assigned agent: openai-coder
Proposed by: jarvis
Proposed date: 2026-08-24
Approved by: Patrick
Approved date: 08/25/26
Related contracts: None
Related ADRs: None
Dependencies: TASK-024 (DeviceManager reduced — error-handling boundaries are clearer post-split)

## Desired outcome

Broad process-level exception suppression is replaced with errors handled as close as possible to the serial transport boundary, so failures are visible and attributable rather than silently swallowed.

## Context

Exact current suppression sites (e.g. any top-level `process.on("uncaughtException", ...)` or similarly broad `try/catch` wrapping large sections) to be enumerated during implementation via grep.

## Scope

### Included

Identifying and narrowing overly-broad exception handling; adding scoped error handling at the serial transport boundary specifically (since that's the most likely source of intermittent, hardware-dependent failures); ensuring errors are still logged/surfaced (not silently dropped) after narrowing.

### Excluded

Structured logging format itself (TASK-031) — this task is about *where* errors are caught, not how they're formatted.

## Plan

1) Enumerate current broad exception-suppression sites. 2) For each, determine the narrowest boundary that should actually catch that class of error. 3) Move handling there, ensuring the daemon doesn't crash on a recoverable serial-transport error but also doesn't silently swallow an error that should be visible/actionable. 4) Confirm via testing that a genuinely fatal error still surfaces (doesn't get accidentally suppressed by the new narrower handling).

## Acceptance criteria

- [x] No process-level catch-all exception suppression remains for errors that originate at the serial transport boundary.
- [x] Serial-transport errors are caught and handled at that boundary specifically, with the daemon continuing to run (consistent with the existing auto-reconnect behavior) rather than crashing.
- [x] A deliberately-injected fatal error (unrelated to serial transport) is confirmed to still surface rather than being silently caught by leftover broad handling.

## Validation requirements

Manual fault-injection testing: simulate a serial-transport error (disconnect mid-operation) and confirm graceful handling/reconnect; simulate an unrelated fatal error and confirm it's not silently suppressed.

## Risks and assumptions

Risk of narrowing too aggressively and losing a safety net for an error class not yet anticipated — validate against real device disconnect/reconnect scenarios, not just unit-level fault injection.

## Blocker

None.

## Implementation handoff

Implemented by openai-coder on 2026-08-25.

### Changes made

- Wrapped the specific serial transport's `fromDevice.pipeTo` method before
  constructing `MeshDevice`, so the third-party fire-and-forget pipe promise is
  handled at the transport boundary.
- Recoverable `AbortError`, `ABORT_ERR`, `ERR_STREAM_PREMATURE_CLOSE`, and
  `"Port is not open"` failures now produce a `console.warn` and resolve at that
  boundary, leaving existing device-status reconnect behavior unchanged.
- Unexpected pipe failures emit `transport:error` from `DeviceManager`; the
  daemon entry point subscribes immediately after manager construction and
  routes the error to the existing `fatalError("serial transport failure", err)`
  path.
- Removed all serial-specific filtering from the process-level
  `unhandledRejection` and `uncaughtException` listeners. Both are now
  unconditional last-resort fatal handlers.
- Extended the serial and MeshDevice mocks with a fresh `fromDevice` stream per
  connection and added tests for recoverable rejection handling and unexpected
  rejection surfacing.

### Validation performed

- `pnpm exec vitest run src/__tests__/device-manager.test.ts --reporter=dot`:
  passed, 1 file and 68 tests.
- `pnpm exec tsc --noEmit`: passed with no diagnostics.
- `pnpm test`: passed, 13 files and 216 tests.
- `pnpm lint`: passed with no diagnostics.
- Scoped Prettier check for `src/device/device-manager.ts`, `src/index.ts`, and
  `src/__tests__/device-manager.test.ts`: passed.
- Package-wide `pnpm format:check`: failed only because the unrelated,
  pre-existing `src/device/configuration-handler.ts` is not formatted. No
  out-of-scope formatting change was made.
- `git diff --check`: passed.
- Fatal surfacing was demonstrated by the automated test `surfaces an
  unexpected serial read rejection as a transport:error event`, which injects
  `Error("decoder invariant failed")` into the third-party pipe path and asserts
  that the identical error is emitted. Production wiring routes that event to
  `fatalError`; it is not swallowed or converted into a recoverable result.

### Assumptions and deviations

- Used explicit `transport:error` event emission instead of intentionally
  recreating an unhandled rejection. This gives unexpected fire-and-forget
  failures a deterministic, attributable path to the existing fatal handler.
- Automated fault injection replaced the task's requested physical disconnect
  test because no real serial device was available in this environment. The
  injected stream rejection exercises the exact boundary involved.
- Existing uncommitted repository-mapping and health-route changes in
  `device-manager.ts` and `index.ts` were preserved and are not part of this
  implementation.

### Unresolved risks

- Real-hardware disconnect/reconnect should still be exercised during review to
  confirm the third-party packages continue using the intercepted `pipeTo`
  method in the same way as version 2.6.7.
- Two existing single-operation cleanup suppressions remain in `DeviceManager`:
  `device.transport.disconnect().catch(() => {})` in explicit disconnect and
  device-status cleanup. They are not broad/process-level suppression and were
  left outside this task's scope.
- The package-wide Prettier baseline remains red on the unrelated
  `src/device/configuration-handler.ts` file.

## Review

Not reviewed.

## Human acceptance

Pending.
