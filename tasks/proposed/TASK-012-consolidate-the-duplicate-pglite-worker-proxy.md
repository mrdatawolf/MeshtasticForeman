# TASK-012: Consolidate the duplicate PGlite worker proxy

Owner role: Implementer
Assigned agent: openai-coder
Proposed by: jarvis
Proposed date: 2026-08-24
Approved by:
Approved date:
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

Not started.

## Review

Not reviewed.

## Human acceptance

Pending.
