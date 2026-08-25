# TASK-026: Split the analytics route file by domain

Owner role: Implementer
Assigned agent: openai-coder
Proposed by: jarvis
Proposed date: 2026-08-24
Approved by: Patrick
Approved date: 08/24/26
Related contracts: None (TASK-005's tests already pin behavior; this is a structural split with an existing regression suite)
Related ADRs: None
Dependencies: TASK-005 (hard blocker — the 17-endpoint test suite must exist first as the regression guard for this split, same pattern as other Stage 5 refactors)

## Desired outcome

`routes/analytics.ts` (1123 lines, 17 endpoints) is split by domain — signal, messages, network, telemetry, packets, and positions — with SQL/query functions kept separate from Fastify request handling so they can be tested directly.

## Context

Confirmed the single exported `registerAnalyticsRoutes` function and the 17 endpoint list (see TASK-005). This grouping should match TASK-020's frontend tab grouping so the domain boundaries agree on both sides of the API.

## Scope

### Included

Six domain modules (or however many the actual endpoint-to-domain mapping naturally produces — confirm the grouping with TASK-020's author if that task is in flight concurrently); separating pure SQL/query-building functions from Fastify route-handler wiring within each domain module; `parseSince`/`buildFilters`/`percentile` becoming shared utilities used across domain modules rather than living once at the top of a single file.

### Excluded

Adding Zod validation (TASK-027 — sequenced after this so it applies to six smaller files, not one large one); changing any endpoint's URL, response shape, or query-parameter semantics.

## Plan

1) Map each of the 17 endpoints to one of the six domains (propose the mapping to you if any endpoint is ambiguous — e.g. `hardware-breakdown` could arguably be "network" or its own thing). 2) Extract shared helpers (`parseSince`, `buildFilters`, `percentile`) into a common module. 3) Split route registration into six domain modules, each separating SQL-building functions from Fastify handlers. 4) Confirm TASK-005's full test suite passes unchanged against the split implementation.

## Acceptance criteria

- [x] The 17 analytics endpoints are organized into domain modules (signal, messages, network, telemetry, packets, positions, or the closest sensible mapping).
- [x] SQL/query-building functions are separated from Fastify request-handling code within each module and can be unit tested directly without an HTTP request.
- [x] TASK-005's full endpoint test suite passes unchanged against the split implementation.
- [x] No change to any endpoint's URL, response shape, or query semantics.

## Validation requirements

TASK-005's full test suite; confirm no endpoint's route path changed by re-running any existing frontend integration against the split routes.

## Risks and assumptions

Lower risk than TASK-012/024/025 since TASK-005's tests already comprehensively pin this file's behavior — this is closer to TASK-002's mechanical-consolidation risk profile than the high-risk protocol refactors.

## Blocker

None.

## Implementation handoff

Task: TASK-026
Implementer: openai-coder
Date: 2026-08-24

### Changes made

- Replaced `packages/daemon/src/routes/analytics.ts` with a thin aggregator that
  calls six domain registration functions while preserving its public signature.
- Added the exact TASK-020-aligned domain modules: `signal.ts`, `messages.ts`,
  `network.ts`, `telemetry.ts`, `packets.ts`, and `positions.ts`.
- Added `analytics/shared.ts` with the single exported implementations of
  `parseSince`, `buildFilters`, and `percentile`.
- Extracted and exported a plain-argument SQL builder for each endpoint. The
  message-delivery builder returns its two related SQL statements and shared
  parameter array.

### Validation performed

- `pnpm --filter @foreman/daemon test -- analytics.test.ts`: not started, exit
  127 because pnpm is unavailable; sandbox Node is v20.19.2 versus required
  >=22.13.0.
- `./node_modules/.bin/vitest run src/__tests__/routes/analytics.test.ts` from
  `packages/daemon`: passed twice, each 1 file and 51/51 tests.
- `./node_modules/.bin/vitest run` from `packages/daemon`: 7/8 files passed,
  149/156 tests passed. All 7 failures are in `src/db/__tests__/open.test.ts`;
  Node 20 reports unknown `.ts` extension for `src/db/pglite.thread.ts`, then
  dependent worker-proxy tests fail. Analytics tests pass in this run.
- `./node_modules/.bin/tsc --noEmit` from `packages/daemon`: passed twice with
  no errors.
- Targeted Prettier check and targeted ESLint for the aggregator and new domain
  modules: passed after mechanical formatting/import-order fixes.
- Route audit found exactly 17 `app.get` registrations in the six domain files.

### Acceptance criteria evidence

- `signal.ts`: snr-history, link-quality.
- `messages.ts`: message-volume, message-delivery, busiest-nodes,
  channel-utilization, message-latency, node-activity.
- `network.ts`: hop-distribution, hardware-breakdown, neighbor-graph.
- `telemetry.ts`: telemetry-history.
- `packets.ts`: portnum-breakdown, packet-timeline, packet-log, packet-log.csv.
- `positions.ts`: position-history.
- The unchanged TASK-005 suite passes all 51 endpoint regression tests.

### Assumptions and deviations

- No endpoint mapping deviations. No SQL, response, validation, or status-code
  changes were intended.
- Used direct repository-local Vitest and TypeScript binaries because the pinned
  pnpm/Node toolchain is unavailable in the sandbox.

### Unresolved risks

- The full daemon suite needs independent rerun under Node >=22.13.0 and pnpm
  11.21.0; the unsupported Node 20 runtime prevents the worker test file from
  loading. No failure points at the analytics split.

### Documentation updated

- This implementation handoff only; no public behavior or architecture changed.

## Review

Not reviewed.

## Human acceptance

Pending.
