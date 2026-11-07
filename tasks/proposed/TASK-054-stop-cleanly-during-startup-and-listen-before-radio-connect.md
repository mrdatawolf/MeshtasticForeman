# TASK-054: Stop cleanly during startup and listen before radio connect

Owner role: Implementer
Assigned agent:
Proposed by: Claude, at Patrick Moon's request
Proposed date: 2026-11-06
Approved by:
Approved date:
Related contracts: CONTRACT-008, CONTRACT-010
Related ADRs: None
Dependencies: None

## Desired outcome

Stopping the daemon while it starts up is an ordinary clean stop, and the API is
available while a slow radio is still connecting.

## Context

On 2026-11-06 the service was stopped about 10 seconds after it started. Shutdown finished
with exit 0, but the log also showed `FATAL — startup failure` from
`throwIfAlreadyStarted`.

`main()` in `packages/daemon/src/index.ts` connects the radio before it registers routes.
A stop during that wait closes the server, then startup carries on and registers routes on
it. Shutdown won that race, but `fatalError()` could win a different one and exit before
shutdown finishes.

The same order means nothing listens until the radio connection finishes. In a real radio
run on 2026-11-06, the API took about 60 seconds to come up.

## Scope

### Included

- `main()` stops its remaining startup steps once a shutdown has begun.
- A stop during startup logs no `FATAL` line and completes the shutdown.
- Routes are registered and the server listens before the radio connection finishes.
- A real startup failure still reports through `fatalError()`.

### Excluded

- Changing the shutdown order, the timeout, or the second-signal behavior.
- Changing what a radio connection does.
- `start-api.sh` and the service units.

## Plan

1. Record that a shutdown has begun where `main()` can check it.
2. Move the radio connection after `app.listen`, without awaiting it for startup.
3. Check that health and readiness still follow CONTRACT-010 during the connection.
4. Test a stop at each startup stage.

## Acceptance criteria

- [ ] A stop during the radio connection logs `shutdown complete` and no `FATAL` line.
- [ ] A stop before the server listens does the same.
- [ ] The API answers while the radio is still connecting.
- [ ] The WebSocket client gets correct device status during and after the connection.
- [ ] A real startup failure, such as a bad `API_PORT`, still exits 1 through `fatalError()`.
- [ ] A failed radio connection does not stop the API from running.

## Validation requirements

`pnpm lint`, `pnpm build`, and `pnpm test`, plus a run on a real radio that stops the
service during startup and checks the journal. Run heavy commands under a memory cap.

## Risks and assumptions

- Requests can now arrive before a device is connected, so routes must handle that.
- CONTRACT-010 may define readiness in a way that depends on the old order, and it may
  need an amendment. That decision is Patrick's.

## Blocker

None.

## Implementation handoff

Not started.

## Review

Not reviewed.

## Human acceptance

Pending.
