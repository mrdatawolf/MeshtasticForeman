# TASK-030: Replace broad exception suppression with boundary-scoped error handling

Owner role: Implementer
Assigned agent: openai-coder
Proposed by: jarvis
Proposed date: 2026-08-24
Approved by:
Approved date:
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

- [ ] No process-level catch-all exception suppression remains for errors that originate at the serial transport boundary.
- [ ] Serial-transport errors are caught and handled at that boundary specifically, with the daemon continuing to run (consistent with the existing auto-reconnect behavior) rather than crashing.
- [ ] A deliberately-injected fatal error (unrelated to serial transport) is confirmed to still surface rather than being silently caught by leftover broad handling.

## Validation requirements

Manual fault-injection testing: simulate a serial-transport error (disconnect mid-operation) and confirm graceful handling/reconnect; simulate an unrelated fatal error and confirm it's not silently suppressed.

## Risks and assumptions

Risk of narrowing too aggressively and losing a safety net for an error class not yet anticipated — validate against real device disconnect/reconnect scenarios, not just unit-level fault injection.

## Blocker

None.

## Implementation handoff

Not started.

## Review

Not reviewed.

## Human acceptance

Pending.
