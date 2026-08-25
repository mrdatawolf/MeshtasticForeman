# TASK-039: Clear stale PGlite lock on daemon startup

Owner role: Implementer
Assigned agent: openai-coder
Proposed by: contract-architect (via Claude, orchestrating session), per CONTRACT-001's Open question #1
Proposed date: 2026-08-24
Approved by: Patrick
Approved date: 08/24/26
Related contracts: CONTRACT-001 (documents this as a known, deliberately-preserved gap under TASK-012's "pure consolidation" scope; this task is the fast-follow that closes it)
Related ADRs: None
Dependencies: TASK-012 (must land first — this task adds a `clearDbLock()` call to the *consolidated* `client.ts`, not the current duplicated one, to avoid fixing code that TASK-012 is about to delete)

## Desired outcome

Restarting the daemon after an unclean shutdown (process killed, crash, power
loss) succeeds instead of failing to start, by clearing a stale
`postmaster.pid` lock file the same way the terrain-cache scripts already do.

## Context

Found while drafting CONTRACT-001 for TASK-012 (the PGlite worker-proxy
consolidation). `packages/daemon/src/scripts/export-terrain-cache.ts` and
`import-terrain-cache.ts` both call `clearDbLock()` immediately before
`openDb()`:

```ts
clearDbLock();
const db = await openDb();
```

But `packages/daemon/src/db/client.ts` — the daemon's own singleton
initialization path, used by `index.ts` at startup — has never done this. It
calls `createDb()` (its own now-duplicated worker-init logic) directly, with
no lock-clearing step. Today this means: if the daemon is killed uncleanly
(not a graceful shutdown) and PGlite left a stale `postmaster.pid` in the
data directory, the *next* daemon startup's PGlite initialization fails or
hangs against the still-locked directory, and the daemon never comes up —
while the exact same failure mode is already handled and self-healing for
anyone running the terrain-cache scripts.

TASK-012 explicitly scopes itself as "a pure consolidation, not a redesign"
and CONTRACT-001 (`docs/contracts/CONTRACT-001-consolidated-pglite-proxy-behavior.md`)
correspondingly requires the consolidated `client.ts` to preserve this gap
exactly, rather than fix it as a side effect. This task is the deliberate,
separately-reviewable fix CONTRACT-001 recommended instead.

## Scope

### Included

After TASK-012 lands, add a `clearDbLock(DATA_DIR)` call immediately before
the `openDb(DATA_DIR)` call in the consolidated `client.ts`, mirroring the
terrain-cache scripts' existing pattern exactly. Import `clearDbLock` from
the consolidated proxy module (`open.ts` or wherever TASK-012 placed it)
alongside the existing `openDb` import.

### Excluded

Any change to `clearDbLock()`'s own implementation (its stale-lock-removal
logic is already correct and tested per TASK-007). Any change to
`openDb()`'s behavior. Any retry/wait logic beyond the single
clear-then-open sequence the scripts already use — if that single clear
isn't sufficient in some real-world case, that's a separate, later finding,
not something to speculatively build in now.

## Plan

1) Confirm TASK-012 has landed and identify the consolidated `client.ts`'s
   exact current form (its `openDb(DATA_DIR)` call site).
2) Add `import { clearDbLock } from "./open.js"` (or the actual module
   TASK-012 consolidated into) alongside the existing `openDb` import.
3) Call `clearDbLock(DATA_DIR)` immediately before `openDb(DATA_DIR)`,
   matching the terrain-cache scripts' call order exactly.
4) Manually verify: start the daemon, kill it uncleanly (`kill -9` the
   process, not a graceful `Ctrl+C`) while `pglite-data/postmaster.pid`
   exists, then start the daemon again and confirm it comes up successfully
   instead of failing/hanging — this is the actual bug being fixed and
   should be reproduced and confirmed fixed, not just inferred from reading
   the code.
5) Run `pnpm --filter @foreman/daemon test` to confirm no regression
   (TASK-007's `open.test.ts` and TASK-006's `migrations.test.ts` in
   particular, since both exercise the same startup path indirectly).

## Acceptance criteria

- [ ] The consolidated `client.ts` calls `clearDbLock(DATA_DIR)` immediately before `openDb(DATA_DIR)`.
- [ ] Reproduced manually: an unclean shutdown (`kill -9`) followed by a daemon restart succeeds, where before this task it failed/hung.
- [ ] A clean shutdown followed by a restart still works exactly as before (no regression to the common case).
- [ ] `pnpm --filter @foreman/daemon test` passes with no regressions.

## Validation requirements

Manual reproduction of the stale-lock scenario (see Plan step 4) is the
primary validation — this is an operational bug that a unit test alone
can't fully demonstrate, since it depends on real PGlite lock-file behavior
on disk. Full daemon test suite as a regression check.

## Risks and assumptions

Low risk — this is additive (one new function call in an already-correct,
already-tested code path) with a well-established precedent in the two
scripts that already do exactly this. Main risk is sequencing: if
implemented before TASK-012 lands, it would need to be redone against
`client.ts`'s pre-consolidation duplicate implementation and then redone
again after consolidation — hence the hard dependency on TASK-012 landing
first.

## Blocker

None.

## Implementation handoff

Not started.

## Review

Not reviewed.

## Human acceptance

Pending.
