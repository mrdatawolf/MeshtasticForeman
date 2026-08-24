# CONTRACT-001: Consolidated PGlite Proxy Behavior

Status: Proposed
Approved by:
Approved date:
Related tasks: TASK-012

## Purpose

`packages/daemon/src/db/client.ts` and `packages/daemon/src/db/open.ts`
currently contain two independently-maintained copies of `PGliteProxy`, the
worker-thread proxy that every daemon feature and both terrain-cache scripts
use to reach PGlite. TASK-012 consolidates these into a single implementation.
Because this proxy "controls all persistence" (TASK-012's own words) and has
no architectural redundancy — a bug introduced during consolidation is a
silent data-loss or data-corruption risk across the whole daemon — this
contract pins down the exact observable behavior the consolidated module must
preserve, and resolves the specific ambiguities left open by TASK-012's task
description before implementation begins.

## Scope

### Included

- The public export surface of the consolidated proxy module (`open.ts`, per
  TASK-012's stated preference over a new `pglite-proxy.ts`) and of the
  reduced `client.ts`.
- Query, exec, and transaction semantics: ordering guarantees, atomicity, and
  error propagation at each API boundary.
- Worker lifecycle behavior: startup readiness handshake, and the `error` /
  `exit` event handling that determines what happens to in-flight and future
  requests.
- `clearDbLock()`'s stale-lock-file removal behavior and its relationship (or
  lack of one) to daemon startup and to `openDb()`.
- Confirmation of which existing call sites this contract requires to keep
  working unchanged.

### Excluded

- Any change to SQL semantics, migrations, or schema.
- Any change to the underlying `pglite.thread.ts` worker script's protocol
  (message shape, `ready`/`query`/`exec`/`close` message types) — this
  contract covers the proxy that talks to that protocol, not the protocol
  itself.
- Graceful shutdown ordering (daemon-wide `SIGINT`/`SIGTERM` handling) —
  tracked separately as CONTRACT-008 / TASK-029. This contract only defines
  what `db.close()` does when called directly.
- Redesigning the queue/worker pattern itself. Per TASK-012's explicit scope
  boundary, this is "a pure consolidation, not a redesign": the retained
  implementation's behavior is normative here, not a newly designed one.

## Actors

- **Daemon process** (`packages/daemon/src/index.ts`): imports the singleton
  `db` from `client.ts` at startup and passes it to `DeviceManager`,
  `MqttGateway`, migrations, and all REST/WebSocket route handlers.
- **Terrain-cache scripts** (`export-terrain-cache.ts`, `import-terrain-cache.ts`):
  call `openDb()` and `clearDbLock()` directly from `open.ts`, independent of
  the daemon's singleton.
- **PGlite worker thread** (`pglite.thread.ts`): the counterparty the proxy
  communicates with via `postMessage`/`message` events.
- **Human operator**: starts/stops/restarts the daemon and runs the scripts;
  experiences lock-file and startup failures directly.

## Inputs and outputs

- **`openDb(dataDir = DEFAULT_DATA_DIR): Promise<PGlite>`** — input: an
  optional data directory path. Output: a proxy object satisfying the
  four-method surface described in Interfaces, resolved once the worker
  reports readiness, or rejected on worker startup failure/timeout (30s).
- **`clearDbLock(dataDir = DEFAULT_DATA_DIR): void`** — input: an optional
  data directory path. Output: none (side effect only — see Required
  behavior).
- **`db` (from `client.ts`)** — no inputs; a module-level singleton, the
  resolved value of one `openDb()` call made at import time, exported for
  direct use.
- **`query(sql, params?)`** → `Promise<Results<T>>`; resolves with the
  worker's result rows, or rejects with the worker's reported SQL error.
- **`exec(sql)`** → `Promise<void>`; resolves once the worker confirms
  execution, or rejects with the worker's reported error.
- **`transaction(callback)`** → `Promise<T>`; resolves with the callback's
  return value on commit, rejects with the callback's thrown error (or a
  `COMMIT`/`BEGIN` failure) otherwise.

## Preconditions

- A worker script exists at `db/pglite.thread.ts` implementing the expected
  message protocol (`ready`, `query`, `exec`, `close`, and error/result
  response messages keyed by request `id`).
- The target data directory is writable by the daemon process (or, for
  `clearDbLock`, at least writable enough to delete `postmaster.pid` if
  present).
- For `client.ts`'s singleton: `DATA_DIR` (`process.env.PGLITE_DIR` or the
  repo-relative default) resolves to the same value it does today, since
  `client.ts` and `open.ts` share the same `__dirname`-relative default.

## Required behavior

This section states the behavior the consolidated implementation MUST
exhibit. Where `packages/daemon/src/db/__tests__/open.test.ts` (committed
under TASK-007) already characterizes a case with an executable assertion,
that test is the authoritative, executable specification for that case, and
is referenced here rather than re-derived in prose. The consolidated
implementation must pass that suite unmodified, per TASK-012's own acceptance
criteria.

### Public API surface (resolves TASK-012's stated ambiguity)

- `open.ts` remains the single source of the `PGliteProxy` class and is the
  only module that exports `openDb()`, `clearDbLock()`, and
  `DEFAULT_DATA_DIR`. These names are not duplicated anywhere else.
- `client.ts` is reduced to: computing `DATA_DIR` (or reusing
  `DEFAULT_DATA_DIR` from `open.ts` — either is acceptable since they resolve
  identically today; see Open questions), calling `openDb(DATA_DIR)` once at
  module load via top-level `await`, and exporting the result as `db`.
  `client.ts` contains no `PGliteProxy` class, no re-implementation of
  queueing/transaction/error-handling logic, and no worker-lifecycle code.
- `client.ts` is **not required** to re-export `openDb`, `clearDbLock`, or
  `DEFAULT_DATA_DIR`. A repository-wide grep confirms the only consumer of
  `client.ts` is `index.ts`, which imports only `{ db }`; the two scripts
  already import `openDb`/`clearDbLock` directly from `open.ts`. No existing
  call site needs `client.ts` to change its import path or add new imports.
- `index.ts`'s `import { db } from "./db/client.js"` must continue to work
  unchanged — `db` is a ready-to-use object exposing `query`, `exec`,
  `transaction`, and `close`, matching current behavior exactly.

### Query / exec semantics

- `query()` and `exec()` calls submitted on the same proxy instance are
  processed strictly in FIFO submission order, one at a time — a later call
  never starts its worker round-trip before an earlier one has settled. See
  `open.test.ts`, "drains calls sequentially in submission order."
- `query()` resolves with the worker's returned `Results<T>` on success, and
  rejects with an `Error` (constructed from the worker's reported
  `message`/`code`) on SQL failure. See `open.test.ts`, "executes query and
  propagates SQL errors from the worker."
- `exec()`'s effects are immediately visible to a subsequently-queued
  `query()` against the same proxy instance. See `open.test.ts`, "executes
  SQL and makes its effects observable by query."

### Transaction semantics

- `transaction(callback)` is atomic: it wraps the callback in `BEGIN` /
  `COMMIT`, and issues `ROLLBACK` if the callback throws, before rethrowing
  the callback's original error to the `transaction()` caller. See
  `open.test.ts`, "commits a successful transaction" and "rolls back a
  transaction when its callback throws."
- The `tx` object passed to the callback exposes only `query` and `exec`;
  callers cannot nest `transaction()` calls through it.
- If the `ROLLBACK` statement itself fails after a callback throw, that
  rollback failure is swallowed and the original callback error is still the
  one that propagates to the `transaction()` caller (not the rollback
  failure). This is existing, preserved behavior, not a new decision.
- If `COMMIT` itself fails (e.g., the worker or connection fails between a
  successful callback and the `COMMIT` message), the implementation attempts
  a best-effort `ROLLBACK` and then rejects `transaction()` with the
  `COMMIT` failure's error. This case is not currently covered by an
  `open.test.ts` assertion; it is existing code-path behavior being
  preserved unchanged by this consolidation, not a behavior newly specified
  here.
- The entire `transaction()` call (including callback execution) is one
  queue entry: no other `query()`/`exec()`/`transaction()` call on the same
  proxy instance can interleave between the transaction's `BEGIN` and its
  `COMMIT`/`ROLLBACK`.

### Worker lifecycle

- On worker `error`: every currently in-flight request (one that has already
  been sent to the worker and is awaiting a reply) is rejected with the
  emitted error object. See `open.test.ts`, "rejects a pending request when
  the worker emits an error." An `error` event alone does not mark the proxy
  permanently dead — only `exit` does (see below); this is existing,
  preserved behavior, not a new decision made by this contract.
- On worker `exit`: the proxy is marked permanently dead. Every currently
  in-flight request is rejected with an error whose message matches `/PGlite
  worker exited with code \d+/`, and every request submitted afterward
  (including ones already queued but not yet dispatched, and any new
  `query()`/`exec()`/`transaction()` call) is rejected with `"PGlite worker
  is not running"`. See `open.test.ts`, "rejects pending and subsequent
  requests after the worker exits." This dead state is not reversible; a new
  proxy requires a new `openDb()` call.
- Invariant: no promise returned by `query()`, `exec()`, or `transaction()`
  is ever left permanently unsettled by a worker `error` or `exit` event,
  regardless of whether the request was in-flight or still queued at the
  time of the event.
- `openDb()`'s startup handshake (waiting for a `ready` message) still times
  out after 30 seconds and rejects on worker `error`/`exit` during startup,
  unchanged from both current implementations.

### `clearDbLock()`

- `clearDbLock(dataDir)` removes `postmaster.pid` from `dataDir` if present,
  and is a no-op (does not throw) if the file is absent. See `open.test.ts`,
  "removes a stale postmaster.pid" and "does not throw when postmaster.pid is
  absent."
- `clearDbLock()` is independent of `openDb()` — calling `openDb()` never
  implicitly calls `clearDbLock()`, and vice versa. This matches today's
  `open.ts` and is unchanged by consolidation (see Open questions for the
  daemon-startup implication of this).

## Postconditions and invariants

- After a successful `openDb()` call, the returned proxy's `query`, `exec`,
  and `transaction` methods behave as specified above until either `close()`
  is called or the underlying worker exits/errors terminally.
- After `db.close()` resolves, the worker has been sent a `close` message
  (best-effort — failures are swallowed) and then terminated; the proxy is
  not required to be usable afterward.
- The proxy object returned by `openDb()` is cast to the `PGlite` type but
  only implements `query`, `exec`, `transaction`, and `close`. This is
  existing behavior (not introduced by this consolidation): a repository-wide
  check confirms no current call site invokes any other `PGlite` method
  (e.g., `.live`, `.dumpDataDir`) on `db`. The consolidated module must not
  expand or narrow this method surface as a side effect of consolidation.
- Sequential FIFO draining, transaction atomicity, and the `error`/`exit`
  dead-flag behavior above are invariants of every `PGliteProxy` instance,
  not just the daemon singleton — they must hold identically for proxies
  returned to the terrain-cache scripts.

## Failure behavior

- **Worker fails to start / times out**: `openDb()` rejects; for the daemon
  singleton, this rejection surfaces as an unhandled top-level `await`
  failure during `client.ts` module evaluation, which is expected to
  propagate up through `index.ts`'s `main().catch(...)` → `fatalError(...)`
  path (visible to the operator, process exits after prompting). This is
  existing behavior; the consolidation must not change how a startup failure
  surfaces to the operator.
- **Stale `postmaster.pid` from an unclean previous shutdown (Windows and
  other platforms)**: `clearDbLock()` exists specifically to clear this.
  Today, the two terrain-cache scripts call `clearDbLock()` before
  `openDb()` and are therefore resilient to this condition. The daemon's
  `client.ts` singleton path does **not** call `clearDbLock()` today, and per
  TASK-012's "pure consolidation, not a redesign" scope boundary, the
  consolidated `client.ts` likewise must not call `clearDbLock()` unless the
  human explicitly directs otherwise (see Open questions — this is a real
  gap worth the human's attention, not one this contract resolves
  unilaterally).
- **Daemon restarted before the previous process's worker/lock has fully
  released** (e.g., process killed, OS hasn't released the file handle yet):
  today's behavior is that `openDb()`'s underlying PGlite initialization
  fails or hangs against the still-locked directory, and — absent a
  `clearDbLock()` call on the daemon path — that failure propagates as a
  startup failure per the bullet above. The consolidation must preserve this
  observable behavior exactly; it must not silently add retry, wait, or
  lock-clearing logic on the daemon startup path, since that would be a
  behavior change outside TASK-012's stated scope.
- **Mid-operation worker crash**: covered under Worker lifecycle above — all
  pending work is rejected, the proxy becomes permanently unusable, and every
  daemon feature holding a reference to `db` will see every subsequent
  `query`/`exec`/`transaction` call reject with `"PGlite worker is not
  running"`. The consolidation must not add automatic worker restart; none
  exists today.

## Interfaces

```ts
// open.ts (or pglite-proxy.ts, per TASK-012's stated naming option)
export const DEFAULT_DATA_DIR: string;
export function clearDbLock(dataDir?: string): void;
export function openDb(dataDir?: string): Promise<PGlite>;
// PGliteProxy class itself is not exported (implementation detail).

// client.ts
export const db: PGlite; // singleton, resolved via top-level await openDb(...)
```

The effective shape callers rely on for any `PGlite`-typed value returned by
this module (whether `db` or an `openDb()` result):

```ts
interface UsedPGliteSurface {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<Results<T>>;
  exec(sql: string): Promise<void>;
  transaction<T>(
    callback: (tx: { query: UsedPGliteSurface["query"]; exec: UsedPGliteSurface["exec"] }) => Promise<T>,
  ): Promise<T>;
  close(): Promise<void>;
}
```

## UX expectations

N/A. This contract covers an internal backend persistence boundary with no
direct end-user-facing surface. The only human-visible effects are indirect
(daemon startup success/failure messaging via `index.ts`'s existing
`fatalError` path, and console log lines such as `[db] PGlite ready at
{dataDir}` and `[db] Removing stale lock file: {lockFile}`), and this
contract requires those existing messages to be preserved, not redesigned.

## Validation requirements

- `packages/daemon/src/db/__tests__/open.test.ts` (TASK-007) must pass
  unmodified against the consolidated implementation, per TASK-012's own
  acceptance criteria. This is the primary executable validation for query,
  exec, transaction, queue-ordering, worker-lifecycle, and `clearDbLock`
  behavior.
- Daemon startup smoke test (`pnpm --filter @foreman/daemon dev`): confirms
  `client.ts`'s reduced singleton still initializes and the daemon reaches a
  listening state.
- `export-terrain-cache.ts` and `import-terrain-cache.ts` run successfully
  against a scratch data directory, confirming `open.ts`'s exported surface
  (`openDb`, `clearDbLock`) is unaffected for direct consumers.
- A repository-wide grep for `PGliteProxy`, `db/client`, and `db/open`
  import sites (as performed in drafting this contract) should be re-run
  after implementation to confirm no other consumer depended on
  `client.ts`-specific behavior not present in `open.ts`.
- No new automated test is required beyond the above unless implementation
  reveals a behavior this contract did not anticipate, in which case that
  gap should be raised to the human rather than silently resolved.

## Open questions

1. **Should the consolidated daemon startup path call `clearDbLock()`?**
   Today it does not (only the scripts do), which means an unclean daemon
   shutdown followed by a restart currently fails to start rather than
   self-healing. TASK-012 frames this task as pure consolidation with "no
   behavior change," which would mean this gap is preserved as-is. But this
   contract's own brief specifically named "what should happen if the daemon
   starts while the previous process's worker/lock hasn't fully released" as
   a risk to pin down — and the honest answer under a strict no-behavior-
   change reading is "it still fails to start." The human should confirm
   whether that's acceptable for this task, or whether adding a
   `clearDbLock()` call to the daemon startup path should be a fast-follow
   task (recommended: a new small task, not folded into TASK-012, to keep
   TASK-012's diff minimal and reviewable given its risk level).
2. **Module location**: `open.ts` vs. a new `pglite-proxy.ts`. TASK-012
   allows either. This contract does not mandate one over the other since
   both satisfy every behavioral requirement above; the choice has no
   observable effect on any consumer as long as `open.ts`'s current export
   names (`openDb`, `clearDbLock`, `DEFAULT_DATA_DIR`) remain resolvable from
   wherever the scripts and `client.ts` import them from. Human/implementer
   discretion.
3. **`DATA_DIR` computation in `client.ts`**: acceptable either to keep
   `client.ts`'s own `DATA_DIR` constant (as today) or to have it import and
   use `DEFAULT_DATA_DIR` from the consolidated module — both resolve
   identically today since the two files share `__dirname`. Flagging only so
   the implementer doesn't treat this as an open behavioral question; it is
   not one.
4. **COMMIT-failure path** (see Transaction semantics) has no current
   characterization-test coverage. This contract preserves existing code
   behavior by description rather than by pinning it with a new test. If the
   human wants this path executable-test-covered before/after TASK-012, that
   should be scoped explicitly (likely as a small addition to TASK-007's
   suite) rather than assumed as part of TASK-012.
