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
| ADR-001 | WebSocket/App-state ownership (reducer vs. store) | TASK-017 (hard blocker) |
| CONTRACT-001 | Consolidated PGlite proxy behavior | TASK-012 |
| CONTRACT-002 (borderline — propose and let the human decide) | Frontend HTTP client conventions | TASK-013 |
| CONTRACT-003 | Daemon configuration module | TASK-014 |
| CONTRACT-004 | DeviceManager reduced public API/event surface | TASK-024 |
| CONTRACT-005 | Meshtastic adapter layer (unknown -> typed) | TASK-023 |
| CONTRACT-006 | MqttGateway split module boundaries | TASK-025 |
| CONTRACT-007 | REST validation/error/default behavior | TASK-027 |
| CONTRACT-008 | Graceful shutdown ordering | TASK-029 |
| CONTRACT-009 | Data retention/pruning policy | TASK-032 |
| CONTRACT-010 | Health/readiness endpoint semantics | TASK-033 |
| CONTRACT-011 (optional, Jarvis's addition) | Map coverage-math correctness | TASK-011 |
| CONTRACT-012 (optional, Jarvis's addition) | Device-config pure transform functions | TASK-021 |
| ADR-002, ADR-003, ADR-004 (retrospective, produced by TASK-034) | PGlite worker pattern, MQTT bridging, multi-device stance | Block nothing |

None of CONTRACT-001 through CONTRACT-012 have been written yet — only
ADR-001 exists so far (`docs/decisions/ADR-001-websocket-app-state-ownership.md`,
status Proposed). Route the recommended contracts to `contract-architect`
once their owning task is approved and before implementation begins, per
`docs/workflow/change-classification.md`.

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
human's direction, wrote **TASK-038** (new, proposed) to fix the remaining
4: a position/nodeinfo field-mapping question needing investigation before
deciding test-fixture-vs-production-code, plus 2 confirmed test-only timing
bugs (an unawaited disconnect handler, and two tests using
`vi.runAllTimersAsync()` against a legitimately-recurring watchdog interval
that was never meant to terminate). TASK-003 stays in `tasks/approved/`
with its blocker updated, pending TASK-038.
