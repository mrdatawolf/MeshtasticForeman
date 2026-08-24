# TASK-012: Consolidate the duplicate PGlite worker proxy

Owner role: Implementer
Assigned agent: openai-coder
Proposed by: jarvis
Proposed date: 2026-08-24
Approved by: Patrick
Approved date: 08/24/26
Related contracts: **CONTRACT-001 recommended** (cross-cutting — controls all persistence; high-risk per change-classification.md)
Related ADRs: None
Dependencies: **TASK-007 (hard blocker — characterization tests must exist first, per the roadmap's own explicit instruction and your framing).**

## Desired outcome

One implementation of the PGlite worker-thread proxy (lifecycle, request queue, transaction handling, error propagation) exists, living in `open.ts` or a new dedicated `pglite-proxy.ts`. `client.ts` is reduced to only creating and exporting the daemon's singleton database.

## Context

Confirmed `client.ts` (144 lines) and `open.ts` (186 lines) contain duplicated `PGliteProxy` classes with identical queueing/transaction/error-handling logic; `open.ts` additionally exports `clearDbLock()` and a general-purpose `openDb(dataDir)` used by scripts (`export-terrain-cache.ts`, `import-terrain-cache.ts` per `packages/daemon/src/scripts/`). This is the highest-risk item in the entire roadmap per its own text ("it controls all persistence").

## Scope

### Included

Moving the canonical `PGliteProxy` implementation into `open.ts` (or a new `pglite-proxy.ts` if that's cleaner); rewriting `client.ts` to import `openDb()` from that module and export only the daemon's singleton `db`; confirming both terrain-cache scripts and the daemon's main entry point (`index.ts`) still work unchanged.

### Excluded

Any behavior change to query/transaction semantics — this is a pure consolidation, not a redesign.

## Plan

1) Confirm TASK-007's characterization tests pass against `open.ts`'s current implementation (they should, since that's what they were written against). 2) Rewrite `client.ts` to call `openDb(DATA_DIR)` from `open.ts` and export the result as `db`, deleting its duplicate `PGliteProxy` class entirely. 3) Re-run TASK-007's test suite unchanged — it must pass without modification, proving no behavior drift. 4) Grep the codebase for any other consumer relying on `client.ts`-specific behavior not present in `open.ts` (there shouldn't be any, since the classes are near-identical, but confirm).

## Acceptance criteria

- [ ] `client.ts` contains no duplicate `PGliteProxy` class — it only creates/exports the singleton via `open.ts`'s `openDb()`.
- [ ] TASK-007's characterization test suite passes unchanged against the consolidated implementation.
- [ ] The daemon starts and connects to the database successfully (`pnpm --filter @foreman/daemon dev` smoke test).
- [ ] `export-terrain-cache.ts`/`import-terrain-cache.ts` scripts still function (they use `open.ts` already, so should be unaffected, but verify).

## Validation requirements

TASK-007's full test suite; a manual daemon startup/shutdown smoke test; running the terrain-cache export/import scripts against a scratch data directory.

## Risks and assumptions

This is explicitly the riskiest task in Stage 3 — recommend QualityAssurance review before you accept it, given it touches the boundary every other piece of persisted state depends on.

## Blocker

None.

## Implementation handoff

Task: TASK-012 — Consolidate the duplicate PGlite worker proxy
Implementer: openai-coder
Date: 2026-08-24

### Changes made

- Reduced `packages/daemon/src/db/client.ts` to its existing `DATA_DIR`
  computation, one top-level `await openDb(DATA_DIR)` call, and the exported
  `db` singleton.
- Removed the duplicate `PGliteProxy`, worker creation/readiness handshake,
  queue, transaction, error propagation, and worker lifecycle implementation
  from `client.ts`.
- Left `packages/daemon/src/db/open.ts` unchanged as the single source of
  `PGliteProxy`, `DEFAULT_DATA_DIR`, `clearDbLock()`, and `openDb()`.
- Did not add `clearDbLock()` to the daemon startup path.

### Validation performed

- Requested baseline command: `pnpm --filter @foreman/daemon test -- open.test.ts`.
  Could not start because `pnpm` was absent from the default `PATH` (exit 127).
  With the pinned Node 22 path, pnpm itself failed before script execution with
  `[ERROR] unable to open database file` (exit 1), including after redirecting
  XDG state to `/tmp`.
- Equivalent pre-change baseline:
  `PATH=/home/patrick/.nvm/versions/node/v22.22.3/bin:$PATH ./node_modules/.bin/vitest run src/db/__tests__/open.test.ts`
  from `packages/daemon`: passed, 1 test file and 9 tests (exit 0).
- The same equivalent command after consolidation: passed unchanged, 1 test
  file and 9 tests (exit 0).
- Requested build command:
  `pnpm --filter @foreman/daemon build`: pnpm failed before script execution
  with `[ERROR] unable to open database file` (exit 1). Exact package-script
  equivalent `./node_modules/.bin/tsc --noEmit` under pinned Node 22.22.3
  passed with no diagnostics (exit 0).
- Requested full-suite command `pnpm --filter @foreman/daemon test` could not
  start for the same pnpm database error. Exact package-script equivalent
  `./node_modules/.bin/vitest run` under pinned Node 22.22.3 passed: 7 test
  files and 144 tests (exit 0).
- Focused singleton smoke test imported `src/db/client.ts` with
  `PGLITE_DIR=/tmp/foreman-task012-smoke-20260824`, ran `SELECT 1`, closed the
  database, printed `client import/query/close smoke passed`, and exited 0.
  This validates database startup without requiring a real serial device. The
  existing close/terminate path logged `PGlite worker exited with code 1`.
- Repository-wide `rg` confirmed the only production importer of `db/client`
  is `packages/daemon/src/index.ts` (`{ db }`), while
  `export-terrain-cache.ts` and `import-terrain-cache.ts` import `openDb` and
  `clearDbLock` directly from `db/open`. The only production `PGliteProxy`
  definition is now in `packages/daemon/src/db/open.ts`.

### Acceptance criteria evidence

- CONTRACT-001 public API surface: `client.ts` is only the singleton wrapper;
  `open.ts` retains its original exports and four-method proxy surface.
- CONTRACT-001 FIFO ordering, transaction atomicity/rollback behavior, SQL
  error propagation, worker error/exit dead-flag behavior, and
  `clearDbLock()` independence: the frozen `open.test.ts` passed unchanged
  before and after consolidation (9/9 both times). `open.ts` itself was not
  edited, preserving the described COMMIT-failure and startup-handshake paths
  that are not directly characterized.
- No `clearDbLock()` call was added to `client.ts`; CONTRACT-001's intentional
  daemon-startup gap is preserved for TASK-039.
- TypeScript build-equivalent validation and the focused client singleton
  import/query/close smoke both passed.

### Assumptions and deviations

- Retained `client.ts`'s existing local `DATA_DIR` computation, one of the two
  choices expressly allowed by CONTRACT-001.
- Used direct local binaries under Node 22.22.3 because pnpm cannot open its
  state database in this sandbox. No repository configuration was changed.
- An initial direct `tsc -p tsconfig.json` check mistakenly emitted a new
  `packages/daemon/dist/` tree. Birth timestamps confirmed the entire tree was
  created by that invocation; it was moved intact to
  `/tmp/foreman-task012-accidental-dist-20260824-161225` before final
  validation. The corrected `tsc --noEmit` and clean full-suite results above
  are the final results, and no emitted artifact remains in the checkout.
- Did not run the terrain-cache import/export commands because they mutate
  cache data and require command arguments; their unchanged direct imports and
  `open.ts` API were instead confirmed by the repository scan and frozen tests.
- No git command was run.

### Unresolved risks

- The literal pnpm build/test commands remain unverified because pnpm fails
  before running package scripts in this sandbox.
- A full daemon startup/listening smoke test was not attempted because it
  requires runtime configuration and a serial device. The narrower database
  singleton startup/query/close smoke passed.

### Documentation updated

- Updated this implementation handoff only. No durable behavior or
  architecture documentation changed because this is a pure consolidation.

## Review

Not reviewed.

## Human acceptance

Pending.
