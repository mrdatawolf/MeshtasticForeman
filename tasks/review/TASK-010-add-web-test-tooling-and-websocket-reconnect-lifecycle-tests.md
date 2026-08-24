# TASK-010: Add web test tooling and WebSocket reconnect lifecycle tests

Owner role: Implementer
Assigned agent: openai-coder
Proposed by: jarvis
Proposed date: 2026-08-24
Approved by: Patrick
Approved date: 08/24/26
Related contracts: None
Related ADRs: None
Dependencies: None

## Desired outcome

`packages/web` gains a test runner (it currently has none — `"lint": "echo 'no linter configured yet'"` and no `test` script at all), and `ws/client.ts`'s reconnect lifecycle and event-driven state updates are covered.

## Context

`ws/client.ts` (90 lines) is the `ForemanClient` class: `connect()`/`disconnect()`/`send()`/reconnect-on-close logic with `shouldReconnect`/`reconnectTimer`. `store/messages.ts` (203 lines) shows the event-driven state-update pattern (e.g. handling `message:ack`) that this task should also exercise.

## Scope

### Included

Adding Vitest (matching daemon's choice) to `packages/web`, with a browser-like environment (jsdom or happy-dom) sufficient for `WebSocket` mocking; tests for `ForemanClient`'s connect/disconnect/auto-reconnect-on-close/manual-disconnect-does-not-reconnect behavior; tests for at least one event-driven store update path (`store/messages.ts` handling `message:ack`) as a representative example of "event-driven state updates."

### Excluded

Component/rendering tests (out of scope for this task — pure logic and lifecycle only, per the roadmap's stated preference for behavior-focused tests over large rendered-component snapshots); full coverage of every page's WS-driven state (only the representative example above).

## Plan

1) Add `vitest` + jsdom/happy-dom + a mock `WebSocket` implementation to `packages/web`. 2) Test `ForemanClient.connect()` opening a socket, `disconnect()` preventing reconnect, and an unexpected close triggering reconnect via `reconnectTimer`. 3) Test `store/messages.ts`'s `message:ack` handling as the representative event-driven-update test. 4) Add the `test` script to `packages/web/package.json` and confirm it plugs into TASK-003's CI workflow.

## Acceptance criteria

- [x] `packages/web` has a working `pnpm test` script using Vitest.
- [x] `ForemanClient` reconnect-on-unexpected-close and no-reconnect-on-manual-disconnect are both tested.
- [x] At least one event-driven state-update path (`message:ack` in `store/messages.ts`) is tested end-to-end from a mock `ServerEvent` to updated state.
- [x] Web tests run in CI (TASK-003).

## Validation requirements

`pnpm --filter @foreman/web test`.

## Risks and assumptions

Establishing the frontend test tooling is itself part of this task's scope (not a separate prerequisite) — flag if that materially changes the estimate once you review.

## Blocker

Resolved. A network-enabled environment with Node 22.22.3 and the repository's
pinned pnpm 11.21.0 completed the root install and all required validations.

## Implementation handoff

Implementation completed:

- Added web Vitest scripts/configuration and declared Vitest plus jsdom.
- Added three `ForemanClient` tests covering socket construction/handler wiring,
  delayed reconnect after unexpected close, and no reconnect after manual
  disconnect.
- Added a mocked `message:received` then `message:ack` store test, with a minimal
  read-only imperative conversation accessor for logic-only state observation.
- Confirmed `.github/workflows/ci.yml` runs root `pnpm test`, whose root script is
  `pnpm -r test`; the new web test script is therefore included without a CI
  workflow change.
- `PATH=/home/patrick/.nvm/versions/node/v22.22.3/bin:$PATH pnpm install` — PASS
  (exit 0); pnpm 11.21.0 resolved 1,140 packages, added 1,039, and updated
  `pnpm-lock.yaml`.
- `PATH=/home/patrick/.nvm/versions/node/v22.22.3/bin:$PATH pnpm --filter @foreman/web test`
  — PASS (exit 0); Vitest 4.1.11 reported 2 test files passed and 4 tests passed
  in the configured jsdom environment.
- `PATH=/home/patrick/.nvm/versions/node/v22.22.3/bin:$PATH CI=1 NO_COLOR=1 pnpm --filter @foreman/daemon test`
  — PASS (exit 0); Vitest 4.1.11 reported 7 test files passed and 144 tests
  passed.
- No files under `packages/daemon/` or `packages/shared/` source directories
  were modified. No component or rendering tests were added.

No behavior or architecture deviations were introduced. The only environment
assumption was selecting the installed Node 22.22.3 runtime because the shell's
default Node 20 does not satisfy the repository's documented Node requirement.
The install emitted existing configuration/deprecation warnings, but no test
failures or unresolved implementation risks remain.

## Review

Not reviewed.

## Human acceptance

Pending.
