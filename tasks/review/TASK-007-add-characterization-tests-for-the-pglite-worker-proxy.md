# TASK-007: Add characterization tests for the PGlite worker proxy

Owner role: Implementer
Assigned agent: openai-coder
Proposed by: jarvis
Proposed date: 2026-08-24
Approved by: Patrick
Approved date: 08/24/26
Related contracts: None
Related ADRs: None
Dependencies: TASK-006 recommended (shares fixtures/patterns), not a hard blocker

## Desired outcome

The current behavior of the duplicated `PGliteProxy` implementation (in both `db/client.ts` and `db/open.ts`) — query, exec, transaction, error propagation, worker lifecycle — is pinned by tests *before* TASK-012 consolidates the two copies into one.

## Context

This is the explicit ordering constraint called out in the roadmap: "Add tests before changing this code because it controls all persistence." I confirmed `db/client.ts` (144 lines) and `db/open.ts` (186 lines) contain near-identical `PGliteProxy` classes — same queueing, draining, transaction BEGIN/COMMIT/ROLLBACK, and worker error/exit handling logic, duplicated almost verbatim. `db/open.ts`'s version additionally exports `clearDbLock()` for stale `postmaster.pid` handling, which `client.ts` lacks.

## Scope

### Included

Tests exercising: `query()` success and error propagation from the worker; `exec()` behavior; `transaction()` commit and rollback-on-throw behavior; queueing/draining order (sequential execution guarantee); worker `error`/`exit` event handling (pending requests reject, `dead` flag prevents further use); `clearDbLock()`'s stale-lock-file removal behavior.

### Excluded

Any code consolidation itself (that's TASK-012). This task only adds tests against current behavior.

## Plan

1) Write tests against `openDb()` in `db/open.ts` (the more complete of the two) covering the behaviors above, using a real worker thread against a temp data directory (not mocked, since the worker-thread boundary itself is part of what's being characterized). 2) Confirm the same test suite would pass unchanged against `db/client.ts`'s singleton export, to document that the two are indeed behaviorally identical before merging them.

## Acceptance criteria

- [x] Tests cover query success/error, exec, transaction commit, transaction rollback-on-error, and sequential queueing order.
- [x] Tests cover worker `error` and `exit` handling (pending promises reject; further calls reject once `dead`).
- [x] Tests cover `clearDbLock()` removing a stale `postmaster.pid` and being a no-op when absent.
- [x] Test suite is written against the module that TASK-012 will keep (`open.ts` or a new `pglite-proxy.ts`), so it survives the consolidation unchanged and immediately proves no regression.

## Validation requirements

`pnpm --filter @foreman/daemon test`, including at least one real (not mocked) worker-thread round trip, since that's the actual risk surface (Windows-specific WASM initdb behavior can't be characterized with a mock).

## Risks and assumptions

Worker-thread tests are slower and slightly more fragile than pure unit tests (real filesystem, real thread startup) — acceptable given this is explicitly the highest-risk boundary in the codebase per the roadmap's own framing.

## Blocker

None.

## Implementation handoff

Added `packages/daemon/src/db/__tests__/open.test.ts`, containing nine
characterization tests against `openDb()` and real PGlite worker threads. The
suite covers successful queries and worker-propagated SQL errors, `exec()`
effects, transaction commit and rollback-on-throw, FIFO queue draining for
unawaited submissions, pending-request rejection on worker `error` and `exit`,
dead-proxy rejection after exit, and both stale-file and absent-file behavior
for `clearDbLock()`.

The worker lifecycle tests access the proxy's TypeScript-private `worker` field
through a narrowly scoped test-only cast. The error case emits an `error` event
on a real, initialized Worker while a request is pending; the exit case calls
`Worker.terminate()` during a pending `pg_sleep` query, producing an actual
worker exit and exercising the `dead` flag. The tests add the already-installed
`tsx/esm` loader to `process.execArgv` for their duration because `openDb()`
forwards that array to its TypeScript worker and Vitest itself is not launched
under tsx. The original arguments are restored after the file.

The test file documents that `db/client.ts`'s eager singleton prevents clean
per-test instantiation, while its proxy query/exec/transaction, queue/drain,
pending-request, and error/exit logic is structurally identical to `open.ts` at
the time of characterization. No duplicate singleton suite was added.

Validation:

- `pnpm --filter @foreman/daemon test` was invoked, but the pnpm launcher could
  not open its metadata database in the sandbox's read-only user area and
  exited before Vitest (`[ERROR] unable to open database file`). Redirecting
  XDG cache/data paths to `/tmp` produced the same launcher error.
- The identical package test payload was then run directly with the installed
  Vitest entry point under the repository-required Node 22 runtime:
  `PATH=/home/patrick/.nvm/versions/node/v22.22.3/bin:$PATH node node_modules/vitest/vitest.mjs run`
  from `packages/daemon`. Result: 6 test files passed, 93 tests passed, 0
  failed, duration 59.10s. The focused new suite also passed 9/9 tests in one
  file. The total exceeds the task's 69-test baseline because concurrent tasks
  added tests to the shared working tree.

No production code, manifests, lockfiles, or dependencies were changed.

Remaining risk: real WASM-backed worker startup and filesystem activity make
these tests slower and potentially more timing-sensitive than unit tests. The
`pg_sleep` requests are terminated immediately and do not add their nominal
30-second delay, but worker startup dominates the suite runtime.

## Review

Not reviewed.

## Human acceptance

Pending.
