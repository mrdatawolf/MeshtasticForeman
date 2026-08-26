# TASK-032: Add retention/pruning policies for packet, message, activity, telemetry, and cache data

Owner role: Implementer
Assigned agent: openai-coder
Proposed by: jarvis
Proposed date: 2026-08-24
Approved by: Patrick
Approved date: 08/25/26
Related contracts: **CONTRACT-009 recommended** (ambiguous defaults, high-risk — irreversible data loss if pruning is wrong, exactly what change-classification.md flags)
Related ADRs: None
Dependencies: TASK-012 (consolidated PGlite proxy — pruning logic should live against the single db module), TASK-028 (repository modules — natural home for per-entity retention logic)

## Desired outcome

Packet, message, activity, telemetry, and cache data have defined retention or pruning policies, preventing unbounded growth without silently discarding data operators expect to keep.

## Context

No current retention/pruning mechanism exists per the roadmap's framing; this is new behavior with real consequences (data loss) if defaults are wrong, which is why a contract is strongly warranted here more than almost anywhere else in Stage 6.

## Scope

### Included

Defined retention windows (or row-count caps) per data category (packet, message, activity, telemetry, cache); a pruning mechanism (scheduled job or triggered on write); configuration (via TASK-014's config module) to let operators adjust or disable pruning; safe defaults that don't surprise existing operators upgrading into this behavior.

### Excluded

Building a full archival/export mechanism — pruning means deletion (or the contract may define an export step, if that's the direction CONTRACT-009 lands on — that's exactly the kind of question the contract should resolve, not something I should presume here).

## Plan

1) Propose retention windows/policies per data category to you as part of CONTRACT-009's design, since this is a real product/operational decision (how long is "long enough" for packet history?) that shouldn't be decided unilaterally by an implementer. 2) Once approved, implement per-category pruning against the repository modules from TASK-028. 3) Wire retention configuration through TASK-014's config module. 4) Add tests confirming pruning respects configured windows and doesn't delete data outside them.

## Acceptance criteria

- [ ] Packet, message, activity, telemetry, and cache data each have a defined, configurable retention policy per CONTRACT-009.
- [ ] Default retention windows are safe (don't silently delete data an upgrading operator would expect to keep) and are documented.
- [ ] Pruning is tested against boundary conditions (data exactly at the retention edge, data well within it, data well past it).
- [ ] Operators can adjust or disable pruning via configuration.

## Validation requirements

Tests covering retention boundary conditions per category; manual verification that a fresh install's default retention behavior matches what's documented before this ships, since silent, undocumented data loss is the primary risk.

## Risks and assumptions

This is the task most likely to cause real operator-facing harm if done wrong (irreversible data loss) — recommend this be one of the most carefully contract-reviewed items in the whole roadmap, on par with TASK-012/024/025's risk level despite being "just" Stage 6.

## Blocker

None.

## Implementation handoff

Implemented by openai-coder on 2026-08-26.

### Changes made

- Extended the existing daemon configuration schema and `DaemonConfig` with the
  exact CONTRACT-009 retention switch, sweep interval, packet cap, telemetry
  window, and cache window fields/defaults. Retention values use the existing
  `exactTrue` and `positiveInteger` validation path, so failures remain part of
  the aggregated startup configuration error.
- Added migration 019 with a `portnum_name`/`rx_time` packet index and
  `cached_at`-only indexes for both terrain cache tables.
- Added `db/repositories/retention.ts` with an opt-in scheduled sweep. Packet
  pruning retains the newest configured number of rows per device; telemetry
  independently deletes only `TELEMETRY_APP` rows strictly older than its
  cutoff; cache pruning deletes elevation and viewshed rows strictly older than
  their shared cutoff. Messages and activity are not queried or modified.
- Isolated each packet device, telemetry, and cache category in the existing
  database transaction pattern. Failures are logged with structured context and
  do not prevent later devices/categories from being attempted. Successful
  zero-row outcomes are logged per device and category.
- Started the interval only when retention is enabled and added a retention
  sweep step to coordinated graceful shutdown before the PGlite worker closes.
- Documented all five environment variables in `.env.example` and added config,
  migration, retention-boundary, scheduler, no-op logging, disabled-switch,
  message/activity preservation, and shutdown tests.

### Validation performed

Validation ran from `packages/daemon` with Node 22.22.3 and pnpm 11.21.0.

- Initial direct `pnpm ...` narrow-validation invocation: exit 127 because
  `pnpm` was not on the non-login shell PATH (`/bin/bash: line 1: pnpm: command
  not found`). The pinned pnpm was then invoked through Corepack with the Node
  22 installation on PATH.
- First narrow run of config/migrations/retention/shutdown tests: exit 1, 2
  failures and 24 passes. It exposed an incomplete legacy migration-1 fixture
  (missing the migration-1 `packets` table) and the required 300k-row boundary
  test exceeding Vitest's default 5-second timeout. The fixture was corrected
  and that single test received a 30-second timeout.
- Corrected narrow run: exit 0; `Test Files 4 passed (4)`, `Tests 26 passed
  (26)`, duration 12.79s.
- Final focused retention run: exit 0; `Test Files 1 passed (1)`, `Tests 7 passed
  (7)`, duration 14.55s.
- `pnpm exec tsc --noEmit`: exit 0, no diagnostics.
- `pnpm test`: exit 0; `Test Files 15 passed (15)`, `Tests 225 passed (225)`,
  duration 97.81s.
- `pnpm lint`: exit 0; ESLint reported no diagnostics.
- `pnpm format:check`: exit 0; `All matched files use Prettier code style!`.
- `git diff --check`: exit 0, no whitespace errors.

### Assumptions and deviations

- No deviation from CONTRACT-009 was made. A timestamp exactly equal to a
  telemetry/cache cutoff is retained; only timestamps strictly less than the
  cutoff are deleted.
- Packet ties at the same `rx_time` use `id DESC` as a deterministic secondary
  retention order; this does not change oldest-`rx_time`-first behavior.
- The timer begins after the HTTP server starts and waits for its first configured
  interval tick, matching the contract's scheduled-periodic mechanism; no
  immediate startup sweep was added because the contract does not require one.
- The substantial unrelated dirty-worktree changes, including the pre-existing
  modification to CONTRACT-009, were preserved and not edited by this task.

### Unresolved risks

- The packet-cap test validates the required production-sized boundaries but
  adds roughly 15 seconds to a focused test run and contributes to the full
  suite's runtime.
- Scheduled pruning is intentionally process-local and missed ticks are not
  backfilled, as specified by CONTRACT-009.

## Review

Not reviewed.

## Human acceptance

Pending.
