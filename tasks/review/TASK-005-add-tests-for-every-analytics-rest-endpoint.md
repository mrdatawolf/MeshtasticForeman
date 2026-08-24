# TASK-005: Add tests for every analytics REST endpoint

Owner role: Implementer
Assigned agent: openai-coder
Proposed by: jarvis
Proposed date: 2026-08-24
Approved by: Patrick
Approved date: 08/24/26
Related contracts: None
Related ADRs: None
Dependencies: TASK-003 recommended (so new tests are enforced by CI immediately), not a hard blocker

## Desired outcome

All 17 analytics endpoints in `packages/daemon/src/routes/analytics.ts` have regression coverage for query validation, time/device filters, empty results, limits, and row-to-response conversion.

## Context

`routes/analytics.ts` is 1123 lines and registers: `snr-history`, `message-volume`, `message-delivery`, `busiest-nodes`, `portnum-breakdown`, `packet-timeline`, `hop-distribution`, `hardware-breakdown`, `channel-utilization`, `message-latency`, `telemetry-history`, `link-quality`, `node-activity`, `neighbor-graph`, `position-history`, `packet-log`, `packet-log.csv`. `registerAnalyticsRoutes` is the single export; existing test conventions use Fastify's `inject()` (see `__tests__/routes/devices.test.ts`) against a real in-memory PGlite instance (see `__tests__/device-manager.test.ts`'s pattern of running migrations against `new PGlite()`).

## Scope

### Included

One test suite per endpoint (or grouped logically) covering: valid/invalid query params, `since`/time-range filtering, device-ID filtering, empty-result behavior, limit/pagination behavior, and correct mapping from DB row shape to API response shape. Uses a real in-memory PGlite database with migrations applied, per the existing `device-manager.test.ts` pattern.

### Excluded

Splitting the route file itself (TASK-026); adding Zod schema validation (TASK-027) — these tests characterize *current* behavior first.

## Plan

1) Stand up a shared test fixture (in-memory PGlite + migrations + seed helpers) reusable across all 17 endpoint suites. 2) Write tests per endpoint following `buildFilters`/`parseSince` behavior already in the file. 3) Deliberately include malformed/missing query param cases even though there's no schema validation yet, to document current (possibly inconsistent) behavior as a baseline.

## Acceptance criteria

- [ ] All 17 analytics endpoints have at least one test covering success, empty-result, and one filter/validation edge case each.
- [ ] Tests run against a real PGlite instance with migrations applied, not mocked SQL.
- [ ] `percentile()` and other pure helper functions in the file have direct unit tests.
- [ ] Test suite passes in CI (TASK-003).

## Validation requirements

`pnpm --filter @foreman/daemon test`; review that tests assert on response *shape* (not just status 200) so they'd catch a row-mapping regression.

## Risks and assumptions

Largest single test-authoring task in Stage 2 by endpoint count — consider whether to split across two PRs (e.g. signal/message endpoints vs network/telemetry/packet endpoints) for reviewability; that split is fine within this one task's scope.

## Blocker

None.

## Implementation handoff

Implemented analytics REST regression coverage with a real migrated PGlite database.

### Files added

- `packages/daemon/src/__tests__/routes/analytics-fixtures.ts` creates an in-memory
  `PGlite`, applies `runMigrations`, registers the real analytics routes on Fastify,
  and provides schema-accurate seed helpers for devices, nodes, messages, packets,
  and position history.
- `packages/daemon/src/__tests__/routes/analytics.test.ts` contains 51 tests: three
  for each of the 17 endpoints (seeded success mapping, no-match/empty behavior,
  and a filter or validation edge). It covers signal and telemetry null handling,
  numeric coercion, aggregates and pivots, device/node/time filtering, invalid
  buckets and node IDs, limit/offset clamping, hardware fallback names, neighbor
  flattening, packet JSON mapping, and CSV headers/filename/field order/values.

### Acceptance evidence

- [x] All 17 endpoints have success, empty-result, and filter/validation edge
  coverage. The suite has 17 endpoint `describe` blocks and 51 passing tests.
- [x] Tests use `new PGlite()` plus the complete `runMigrations(db)` path; SQL and
  route registration are real and no database layer is mocked.
- [x] `percentile()`, `parseSince()`, and `buildFilters()` behavior is covered.
  `message-latency` uses the hand-computed sorted latency set
  `[100, 1000, 5000, 30000, 70000]` and asserts exact nearest-rank results of
  `medianMs: 5000` and `p95Ms: 70000`. HTTP tests cover shorthand, ISO, `all`,
  missing, and garbage `since` behavior, plus combined `since` + `deviceId`
  filtering.
- [x] The complete daemon test suite passes: 7 files and 144 tests. This shared
  working tree currently has 93 tests outside this new 51-test suite, rather than
  the task's stated 69-test baseline; all 93 passed, so no existing regression was
  observed.

Response assertions check exact field names, values, numeric conversions, nulls,
aggregate shapes, and CSV order rather than only HTTP status codes.

### Validation

- `pnpm --filter @foreman/daemon test -- analytics.test.ts` — did not start
  (exit 127): `pnpm` was not initially on this sandbox shell's `PATH`.
- `corepack pnpm --filter @foreman/daemon test -- analytics.test.ts` — did not
  start (exit 1): Corepack attempted to create a cache directory on the read-only
  home filesystem.
- `node /tmp/task-036-corepack/pnpm/11.21.0/bin/pnpm.cjs --filter
  @foreman/daemon test -- analytics.test.ts` — did not start (exit 1): system Node
  20 lacks `node:sqlite`, required by pnpm 11.21.0.
- `/home/patrick/.nvm/versions/node/v22.22.3/bin/node
  /tmp/task-036-corepack/pnpm/11.21.0/bin/pnpm.cjs --filter @foreman/daemon test
  -- analytics.test.ts` — did not start (exit 1): pnpm's dependency status check
  attempted to spawn `pnpm install`, but no `pnpm` executable was on `PATH`; no
  install ran and no dependency files were changed.
- `PATH=/home/patrick/.nvm/versions/node/v22.22.3/bin:/usr/bin:/bin
  ./node_modules/.bin/vitest run src/__tests__/routes/analytics.test.ts` — first
  successful narrow run: 1 file passed, 51 tests passed. Repeated after making
  seed timestamps deterministic: 1 file passed, 51 tests passed.
- `PATH=/home/patrick/.nvm/versions/node/v22.22.3/bin:/usr/bin:/bin
  ./node_modules/.bin/vitest run` — first parallel full run: 136 passed, 8 failed.
  One new assertion exposed a five-minute seed-boundary flake and was corrected;
  seven existing PGlite migration/worker failures were timeouts under parallel
  resource contention.
- `PATH=/home/patrick/.nvm/versions/node/v22.22.3/bin:/usr/bin:/bin
  ./node_modules/.bin/vitest run --maxWorkers=1` — passed: 7 files, 144 tests,
  duration 91.17s.
- `PATH=/home/patrick/.nvm/versions/node/v22.22.3/lib/node_modules/corepack/shims:
  /home/patrick/.nvm/versions/node/v22.22.3/bin:/usr/bin:/bin
  pnpm_config_verify_deps_before_run=warn pnpm --filter @foreman/daemon test` —
  passed: 7 files, 144 tests, duration 55.22s. The environment setting prevented
  pnpm's automatic dependency-install action and emitted only the existing
  node_modules/lockfile-settings warning.
- `PATH=/home/patrick/.nvm/versions/node/v22.22.3/bin:/usr/bin:/bin
  ./node_modules/.bin/prettier --check ...` — did not start (exit 127): Prettier is
  not installed in the daemon package's local `.bin`; no formatting command ran.

### Deviation, assumptions, and remaining risks

The task's original acceptance wording asks for direct imports of module helpers,
but `percentile()`, `parseSince()`, and `buildFilters()` are intentionally
unexported and modifying `routes/analytics.ts` was explicitly out of scope. Per
the human's direction, their behavior is therefore tested indirectly through the
real HTTP endpoints as detailed above. This is the only deliberate deviation.

Tests assume PostgreSQL's ordering of equal-count portnum groups is not stable;
where ties exist, assertions use order-independent matching. The parallel full
run showed that multiple PGlite/worker suites can exceed their existing five-
second timeouts under contention, but the required pnpm run subsequently passed
in full and the serial diagnostic passed. No unresolved product or test failures
remain.

## Review

Not reviewed.

## Human acceptance

Pending.
