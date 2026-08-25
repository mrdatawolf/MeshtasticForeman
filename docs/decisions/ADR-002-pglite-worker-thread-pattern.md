# ADR-002: PGlite worker-thread pattern

Status: Proposed
Date:
Decision owners:
Related tasks and contracts: TASK-034 (this ADR is retrospective documentation,
not a new decision)

## Context

The daemon persists devices, mesh nodes, messages, packets, channels, and MQTT
data in PGlite, an embedded Postgres compiled to WebAssembly
(`packages/daemon/src/db/open.ts`, `packages/daemon/src/db/pglite.thread.ts`,
`packages/daemon/src/db/client.ts`).

`open.ts`'s own header comment states the constraint plainly:

> PGlite's WASM initdb aborts when called directly on Windows, so we always
> spin it up inside a worker thread.

This ADR records that already-implemented decision — it does not propose an
alternative or reopen the choice.

## Decision

`openDb()` (`packages/daemon/src/db/open.ts`) never constructs `PGlite`
directly on the calling thread. Instead it spawns a Node.js `worker_thread`
running `pglite.thread.ts`, which owns the real `PGlite` instance, and returns
a `PGliteProxy` object that presents the same `query`/`exec`/`transaction`/
`close` surface as a real `PGlite` instance to callers. `db/client.ts` is a
thin wrapper that clears any stale `postmaster.pid` lock file
(`clearDbLock()`) and then calls `openDb()` to produce the `db` singleton used
throughout the daemon.

Concretely:

- `PGliteProxy` communicates with the worker via `postMessage`, tagging each
  request with a `randomUUID()` id and resolving/rejecting a pending promise
  when the matching response arrives.
- Calls are serialized through an internal queue (`_enqueue`/`_drain`) so only
  one query/exec/transaction is in flight against the worker's single
  `PGlite` instance at a time.
- `transaction()` is implemented as `BEGIN`/`COMMIT`/`ROLLBACK` exec calls
  sent through the same channel, wrapping the callback's queries.
- Inside the worker (`pglite.thread.ts`), if `db.waitReady` rejects with a
  WASM `RuntimeError` on first attempt, the worker wipes the data directory
  and retries once (`init(reset = true)`), treating that as a corrupted data
  directory rather than a fatal error.
- `openDb()` waits up to 30 seconds for a `{ type: "ready" }` message from the
  worker before giving up, and every open first calls `clearDbLock()` to
  remove a stale `postmaster.pid` left by an unclean previous shutdown —
  PGlite inherits PostgreSQL's lock-file behavior, and a stale lock would
  otherwise block every subsequent open.
- This applies uniformly: the worker-thread path is used unconditionally, on
  every platform, not only Windows (see open question below).

This module is shared by both the daemon process and standalone scripts, so
the same worker-thread indirection applies wherever the codebase opens the
database.

## Alternatives considered

This is a retrospective ADR; the specific alternatives weighed at
implementation time are not recorded elsewhere in the repository. The one
alternative that can be grounded directly in the code is the status quo the
comment describes as broken:

- **Open `PGlite` directly on the calling thread.** This is the simpler,
  lower-overhead approach and is presumably what an initial implementation
  looked like. It is explicitly rejected by the code comment: PGlite's WASM
  `initdb` aborts when invoked this way on Windows, which would make the
  daemon unusable on that platform.

No other alternative (e.g., a separate child process instead of a worker
thread, or a Windows-only conditional path) is evidenced in the code or
comments, so none is claimed here as having been considered.

## Consequences

### Benefits

- Works around the Windows WASM `initdb` abort, which is otherwise a hard
  blocker for running the daemon on Windows at all.
- Isolates PGlite's WASM runtime in its own thread: a worker crash or WASM
  abort terminates the worker (`worker.on("exit")` rejects any pending
  requests) rather than taking down the whole daemon process outright, and
  `pglite.thread.ts`'s single-retry-with-reset logic gives one automatic
  recovery path for a corrupted data directory.
- `PGliteProxy` presents the same interface as `PGlite` itself, so calling
  code throughout the daemon (routes, `DeviceManager`, `MqttGateway`) is
  written against the ordinary PGlite API and does not need to know it is
  talking to a worker.

### Costs and risks

- Every query, exec, and transaction step now crosses a thread boundary via
  `postMessage`/structured clone, adding serialization overhead and latency
  compared to an in-process call, and making stack traces/debugging harder to
  follow across the worker boundary.
- The internal request queue (`_enqueue`/`_drain`) serializes all DB access
  through a single logical connection; this matches PGlite's own
  single-connection nature but means the proxy adds its own queuing layer on
  top rather than relying on a connection pool.
- Startup now has a 30-second worker-ready timeout as a new failure mode
  distinct from any error PGlite itself might raise.
- This works around a bug in PGlite's WASM `initdb` path rather than fixing
  it upstream; if a future PGlite release fixes the underlying Windows issue,
  this pattern would still be applied unconditionally unless revisited.

## Open questions

- Is the worker-thread pattern still necessary on all platforms, or only on
  Windows? The code comment cites a Windows-specific WASM `initdb` abort, but
  `openDb()` applies the worker-thread indirection unconditionally on every
  platform. Whether a direct in-process path could be restored for
  non-Windows platforms — trading some of the isolation/serialization costs
  above for simplicity — without reintroducing the Windows failure is not
  something this ADR resolves. It would need to be verified against a
  current PGlite release rather than assumed from this document.

## Follow-up work

None identified by this ADR. `docs/ROADMAP.md`'s maintainability track lists
"Record architectural decisions for major choices such as PGlite worker
usage..." as the item this ADR satisfies.
