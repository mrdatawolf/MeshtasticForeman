# TASK-028: Introduce repository modules for repeated database row mapping

Owner role: Implementer
Assigned agent: openai-coder
Proposed by: jarvis
Proposed date: 2026-08-24
Approved by: Patrick
Approved date: 08/24/26
Related contracts: None
Related ADRs: None
Dependencies: TASK-026 (route split, so repository boundaries can align with the now-separated domain modules), TASK-016 (shared formatting/domain utilities, which repository modules will call for converting raw rows to domain types)

## Desired outcome

Database row mapping repeated across route/handler code is centralized into repository modules — raw SQL stays, but column naming and conversion to domain types have one implementation per entity rather than being repeated at each call site.

## Context

Given `routes/analytics.ts` alone had 17 endpoints likely each converting raw PGlite rows to response objects somewhat independently, and `device-manager.ts`/`mqtt/gateway.ts` (per TASK-024/025) also read/write node and device state, row-mapping duplication is very likely widespread. Exact duplication sites to be enumerated during implementation.

## Scope

### Included

Repository modules for the main persisted entities (devices, nodes, messages, packets, telemetry — confirm exact entity list against `db/migrations.ts`'s schema during implementation); centralizing column-name-to-domain-type conversion in each; raw SQL remains inline in these repositories, not replaced by an ORM.

### Excluded

Introducing any ORM or query builder — the roadmap explicitly says this is about centralizing mapping, not adding a heavyweight abstraction.

## Plan

1) Enumerate the persisted entities from `db/migrations.ts`'s schema. 2) For each, find every call site currently mapping raw PGlite rows to a domain type. 3) Create a repository module per entity centralizing that mapping. 4) Update call sites (in the now-split analytics modules, device handlers, MQTT gateway modules) to use the repository instead of inline mapping.

## Acceptance criteria

- [ ] Each major persisted entity (devices, nodes, messages, packets, telemetry — confirmed list) has one repository module centralizing row-to-domain-type conversion.
- [ ] No ORM or query builder is introduced — raw SQL remains, just consolidated.
- [ ] Previously-duplicated mapping call sites now call the shared repository instead.
- [ ] TASK-005's analytics test suite and `device-manager.test.ts` continue to pass unchanged.

## Validation requirements

TASK-005's suite, `device-manager.test.ts`, and any tests added in TASK-006/007/008 that touch persisted data shape — all must pass unchanged, since this task should not alter any observable data shape, only where the mapping code lives.

## Risks and assumptions

Sequenced last in Stage 5 since it benefits from the domain boundaries TASK-024/025/026 establish — doing this first would mean repository boundaries fight the pre-split file structure.

## Blocker

None.

## Implementation handoff

Implemented by openai-coder on 2026-08-25.

### Changes made

- Added shared raw-row mappers for `devices`, `nodes`, `messages`, `packets`,
  and `mqtt_nodes` under `packages/daemon/src/db/repositories/`.
- Replaced the duplicated full-entity mappings in `device-manager.ts`,
  `node-update-handler.ts`, `raw-packet-handler.ts`, `mqtt/gateway.ts`,
  `mqtt/node-persistence.ts`, and the analytics packet-log route with those
  shared mappers. A whole-tree follow-up audit found no remaining duplicated
  full-entity mapper for an entity that now has a repository.
- Confirmed the persisted application tables in `db/migrations.ts` are
  `devices`, `nodes`, `messages`, `packets`, `channels`, `waypoints`,
  `mqtt_nodes`, `node_overrides`, `hw_models`, `traceroutes`,
  `position_history`, `elevation_cache`, `viewshed_cache`,
  `coverage_proposals`, and `mqtt_json_packets` (in addition to the internal
  `schema_migrations` table). The five repositories cover every entity with
  genuinely duplicated raw-row-to-domain mapping. Remaining mappings are
  entity-specific single-site mappings, partial lookups, or aggregate/query
  projections and therefore do not justify repositories in this task.
- Resolved the task's `telemetry` ambiguity: there is no telemetry table.
  Telemetry is stored in `packets.decoded_json` for `TELEMETRY_APP` packets and
  exposed through a telemetry-specific analytics projection. It therefore
  belongs to the existing packets persistence boundary and has no duplicated
  full-row domain mapping requiring a dedicated telemetry repository.
- Kept raw SQL inline and introduced no ORM or query builder.

### Validation performed

- `pnpm exec vitest run src/__tests__/routes/analytics.test.ts src/__tests__/device-manager.test.ts`:
  could not start because `pnpm` is absent from `PATH` (exit 127,
  `/bin/bash: pnpm: command not found`).
- `corepack pnpm --version`: failed under the sandbox's Node v20.19.2 while
  launching pinned pnpm 11.21.0 (exit 1,
  `ERR_VM_DYNAMIC_IMPORT_CALLBACK_MISSING`).
- Local-binary equivalent
  `./node_modules/.bin/vitest run src/__tests__/routes/analytics.test.ts src/__tests__/device-manager.test.ts`:
  passed, 2 files and 118 tests.
- Requested `pnpm exec tsc --noEmit`: could not start for the same missing-pnpm
  reason. Local-binary equivalent `./node_modules/.bin/tsc --noEmit` ran and
  reported one unrelated TASK-033 test-fixture diagnostic:
  `src/mqtt/__tests__/gateway.test.ts(279,15): TS2551: Property '_connected' does not exist on type 'GatewayInternals'`.
- Requested `pnpm test`: could not start for the same missing-pnpm reason.
  Local-binary equivalent `./node_modules/.bin/vitest run` completed with 12
  files passed and 1 failed; 207 tests passed and 7 failed. All seven failures
  are in `src/db/__tests__/open.test.ts` because Node v20.19.2 cannot load
  `src/db/pglite.thread.ts` (`Unknown file extension ".ts"`); the resulting
  follow-on failures read `Cannot read properties of undefined (reading 'exec')`.
- Follow-up environment discovery found nvm installations of Node v22.22.3 and
  v24.16.0. After `. /home/patrick/.nvm/nvm.sh` and `nvm use 22.22.3`, Node
  reported `v22.22.3` and Corepack resolved the pinned pnpm `11.21.0`. The nvm
  installation's standalone `pnpm` symlink failed with
  `[ERROR] unable to open database file`, so the same real pinned pnpm was
  invoked through Corepack.
- Node 22 command `corepack pnpm exec tsc --noEmit`: ran successfully but exited
  2 with the same single unrelated TASK-033 diagnostic:
  `src/mqtt/__tests__/gateway.test.ts(279,15): TS2551: Property '_connected' does not exist on type 'GatewayInternals'`.
- Node 22 command `corepack pnpm test`: passed, 13 files and 214 tests, with no
  failures (duration 74.43 seconds). This supersedes the Node 20 worker-test
  result above as the authoritative full-suite result.
- Initial package-local lint/format binary attempts failed with exit 127 because
  ESLint and Prettier are installed at the workspace root, not in the daemon's
  `node_modules/.bin`. Workspace-root scoped ESLint then passed for all TASK-028
  files; `gateway.ts` used TASK-033's documented pre-existing `import/order`
  suppression and had no other diagnostics.
- Initial scoped Prettier check found `mqtt/gateway.ts` and
  `routes/analytics/packets.ts` unformatted. After formatting those two files,
  the repeated scoped check passed: `All matched files use Prettier code style!`.
- Repository dependency scan found no ORM/query-builder references, and
  `git diff --check` passed.

### Assumptions and deviations

- Repository scope is based on duplicated full raw-row-to-domain mapping, as
  required by the desired outcome, rather than one repository per persisted
  table. Aggregate analytics result shaping and single-site mappings were left
  in place to avoid scope creep.
- The already-present TASK-033 changes in `mqtt/gateway.ts`,
  `mqtt/__tests__/gateway.test.ts`, `src/index.ts`, and `start-frontend.sh` were
  preserved. Only mechanical formatting was applied to `mqtt/gateway.ts`.
- Initial validation used installed local binaries after the default Node 20
  environment could not launch pnpm. Follow-up validation used the discovered
  nvm Node v22.22.3 and pinned pnpm 11.21.0 through Corepack.

### Unresolved risks

- The unrelated TASK-033 `GatewayInternals` fixture type mismatch currently
  prevents a clean whole-daemon typecheck under Node 22. The interface's
  `connected` field is unchanged from HEAD; only TASK-033's test assignment was
  changed to `_connected`. It was not fixed because TASK-028 explicitly
  excludes modifying that already-completed task's test fix.

## Review

Not reviewed.

## Human acceptance

Pending.
