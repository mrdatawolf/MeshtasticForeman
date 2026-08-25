# Task Board

Task plan files move through the directories below. Their directory is the
authoritative status; do not add a redundant status field to task files.

See `docs/workflow/lifecycle.md` for transition authority and
`docs/templates/task.md` for the task format.

```text
proposed -> approved -> in-progress -> review -> completed
```

## Roadmap decomposition (2026-08-24)

`docs/ROADMAP.md`'s "Maintainability roadmap" (Stages 1-6) was decomposed by
Jarvis into TASK-001 through TASK-035, all currently in `tasks/proposed/`.
See `docs/decisions/PRODUCT-ROADMAP-ASSESSMENT.md` for why the roadmap's
separate "Product roadmap" section was deliberately *not* forced into tasks
yet, and the contract/ADR numbering table below for what needs approval
before which task can move to `tasks/approved/`.

### Contract and ADR dependencies

| ID | Subject | Blocks |
|---|---|---|
| ADR-001 (**Accepted** — reducer, `docs/decisions/ADR-001-websocket-app-state-ownership.md`) | WebSocket/App-state ownership | TASK-017 (unblocked) |
| CONTRACT-001 (**Accepted**, `docs/contracts/CONTRACT-001-consolidated-pglite-proxy-behavior.md`) | Consolidated PGlite proxy behavior | TASK-012 (unblocked) |
| CONTRACT-002 (**Accepted**) | Frontend HTTP client conventions | TASK-013 (unblocked) |
| CONTRACT-003 (**Accepted**) | Daemon configuration module | TASK-014 (unblocked) |
| CONTRACT-004 (drafted, Proposed) | DeviceManager reduced public API/event surface | TASK-024 |
| CONTRACT-005 (drafted, Proposed) | Meshtastic adapter layer (unknown -> typed) | TASK-023 |
| CONTRACT-006 (drafted, Proposed) | MqttGateway split module boundaries | TASK-025 |
| CONTRACT-007 (drafted, Proposed) | REST validation/error/default behavior | TASK-027 |
| CONTRACT-008 (drafted, Proposed) | Graceful shutdown ordering | TASK-029 |
| CONTRACT-009 (drafted, Proposed) | Data retention/pruning policy | TASK-032 |
| CONTRACT-010 (drafted, Proposed) | Health/readiness endpoint semantics | TASK-033 |
| CONTRACT-011 (not yet drafted, optional) | Map coverage-math correctness | TASK-011 |
| CONTRACT-012 (**Accepted**) | Device-config pure transform functions | TASK-021 (contract unblocked; task itself explicitly held for Patrick) |
| ADR-002, ADR-003, ADR-004 (retrospective, produced by TASK-034) | PGlite worker pattern, MQTT bridging, multi-device stance | Block nothing |

CONTRACT-004 through CONTRACT-010 were drafted 2026-08-24 in one batch, all
`Status: Proposed` and awaiting Patrick's review/acceptance — see each file
under `docs/contracts/` for the specific open questions each one flagged for
human decision (several are genuinely undecided product/architecture
questions, not just characterization, most notably CONTRACT-009's retention
windows and CONTRACT-008's shutdown-order/rework-risk tradeoff).

A few decisions Jarvis flagged for explicit human judgment rather than
resolving unilaterally: TASK-004's version-of-truth choice, TASK-013 /
CONTRACT-002's borderline call, TASK-015's API-doc dedup approach, TASK-022's
one-task-vs-four split, TASK-031's logger choice, CONTRACT-009's retention
windows, and CONTRACT-010's degraded-vs-failed semantics.

## Implementation progress (2026-08-24)

TASK-004, TASK-002, and TASK-001 are implemented and committed (`3f17743`,
`e0b9bdb`, `ed325a2` on branch `code-cleanup`), each moved to
`tasks/review/`. All three git-mv/commit steps were performed by the
orchestrating session directly rather than inside the `openai-coder`/Codex
sandbox — that sandbox mounts `.git` read-only, so Codex can only edit the
working tree; git operations for any task implemented this way need to be
done outside the sandbox.

Validating TASK-001/TASK-002 surfaced two pre-existing problems (present at
`HEAD` before any of this work, confirmed via `git stash` isolation — not
regressions) that block TASK-003 (CI) from ever passing as written:

- **TASK-036** (new, proposed) — `pnpm install` fails from a clean checkout:
  `@electron/rebuild@^3.7.2` pulls in a git-hosted `@electron/node-gyp` fork
  that trips pnpm's `blockExoticSubdeps` supply-chain policy. Fix is to
  upgrade to `@electron/rebuild@^4.2.0`, which resolves `node-gyp` via the
  registry instead.
- **TASK-037** (new, proposed) — 36/69 tests fail in
  `device-manager.test.ts`: the mocked `MeshDevice.events` object only
  provides 5 of the 14 event types `device-manager.ts` actually subscribes
  to (stale test fixture, not a production bug).

Update: TASK-036 (`a9a46d7`) and TASK-037 (`ea5b822`) are both implemented
and committed on `code-cleanup`, moved to `tasks/review/`. Also fixed
directly (not a task, a one-line accuracy correction the human approved
inline): `package.json`'s stale `engines.node >=20.0.0` field, corrected to
`>=22.13.0` to match what the pinned `pnpm@11.21.0` and `@electron/rebuild@4.2.0`
actually require (`1e03e42`).

TASK-037 explicitly left 4 `device-manager.test.ts` failures unfixed as
out of its scope (pre-existing, unrelated to the mock gap it fixed) — daemon
suite is at 65/69, not 69/69, so `pnpm test` still isn't green. Per the
human's direction, wrote **TASK-038** to fix the remaining 4: a
position/nodeinfo field-mapping question resolved by connecting to a real
Meshtastic device (see its Context — the test fixture was wrong, not
production code, confirmed empirically), plus 2 confirmed test-only timing
bugs (an unawaited disconnect handler, and two tests using
`vi.runAllTimersAsync()` against a legitimately-recurring watchdog interval
that was never meant to terminate). TASK-038 implemented and committed
(`9c2153a`) — daemon suite reached 69/69, unblocking TASK-003, which was
then implemented and committed (`3ae76ad`).

**Stage 1 complete.** TASK-001-004, TASK-036-038 all implemented, committed,
and moved to `tasks/review/` (13 commits total on `code-cleanup`, pushed to
origin — open a PR at
https://github.com/mrdatawolf/MeshtasticForeman/pull/new/code-cleanup to
trigger the new CI workflow, since GitHub Actions can't be triggered from a
sandbox).

**Stage 2 (TASK-005-010) also complete** — all six approved, implemented,
and committed: analytics endpoint tests, migration tests, PGlite proxy
characterization tests, MQTT gateway tests, shared WebSocket schema tests,
and web test tooling. Daemon suite now 144/144, shared 26/26, web 4/4, all
independently verified. `tasks/approved/` and `tasks/in-progress/` are both
empty as of this writing; 13 tasks sit in `tasks/review/` awaiting human
acceptance.

**CONTRACT-001** was drafted for TASK-012 (docs/contracts/CONTRACT-001-...)
at the human's request, since TASK-012 is the highest-risk item in the
roadmap. It surfaced a real gap: the daemon's startup path never calls
`clearDbLock()` (only the terrain-cache scripts do), so an unclean shutdown
followed by a restart currently fails rather than self-healing. Per the
human's direction this is *not* being folded into TASK-012 — **TASK-039**
(new, proposed, depends on TASK-012) is the fast-follow fix.

## Session update (2026-08-24, continued)

**CONTRACT-012** was drafted for TASK-021 (device-config transform behavior)
at Patrick's request and is now **Accepted**. Its four open questions are
resolved: (1) payload-comparison granularity — deep equality, not strict
serialization; (2) wizard's missing `SET_CONFIG_FAILED` handling — real gap,
follow-up is **TASK-040** (new, proposed, depends on TASK-021); (3) unscoped
completion-event correlation (multi-device false-positive) — also a real
gap, follow-up is **TASK-041** (new, proposed, depends on TASK-021); (4)
`ConfigCard` test-file gap — folded directly into TASK-021's own scope and
acceptance criteria rather than tracked separately. **TASK-021 itself is
explicitly held pending Patrick's go-ahead** despite its contract being
accepted — do not dispatch to `openai-coder` until he says so.

**CONTRACT-004 through CONTRACT-010** were all drafted in this session (see
table above) for the Stage-5/6 daemon tasks still in `tasks/proposed/` that
recommended a contract but didn't have one yet. All `Status: Proposed`,
awaiting review. Notably: CONTRACT-009 (retention) found that TASK-032's
"activity" and "telemetry" categories don't map to real tables the way the
task assumed, and surfaced 3 more unbounded tables not named in the task's
title — flagged for Patrick's scoping decision. CONTRACT-008 (shutdown)
flags a real rework-risk tradeoff: drafted against the current pre-split
`MqttGateway`, may need revision once TASK-025 lands.

**TASK-035** (dependency/runtime review cadence) implemented by `librarian`
— `docs/DEVELOPMENT.md` now documents a quarterly cadence. Not yet
committed.

**TASK-039** (clear stale PGlite lock) implemented — `client.ts` now calls
`clearDbLock(DATA_DIR)` before `openDb(DATA_DIR)`, matching the terrain-cache
scripts' precedent exactly; full daemon suite (156/156) passes. **Important
finding from independent manual verification**: the specific failure this
task set out to fix — a stale `postmaster.pid` blocking/hanging a restart
after an unclean (`kill -9`) shutdown — did **not** reproduce against the
currently pinned `@electric-sql/pglite@0.4.6` in two independent manual
trials; `openDb()` succeeded immediately every time even without
`clearDbLock()`, and a clean `close()` afterward removed the lock file on its
own. The fix is still safe, cheap, and matches an established precedent
(explicitly recommended to keep), but TASK-039's acceptance criterion of
*reproducing* the original failure could not be honestly checked off in this
environment/version — flagged for Patrick rather than silently marked done.
Not yet committed.

**TASK-026** (split `routes/analytics.ts` by domain) dispatched to
`openai-coder`, in progress as of this writing.
