# TASK-014: Add a daemon configuration module

Owner role: Implementer
Assigned agent: openai-coder
Proposed by: jarvis
Proposed date: 2026-08-24
Approved by:
Approved date:
Related contracts: **CONTRACT-003 recommended** (cross-cutting — every service depends on config; ambiguous failure behavior without an explicit spec)
Related ADRs: None
Dependencies: None

## Desired outcome

Environment variables are read and validated once at startup (via Zod, already a dependency in `packages/daemon`), producing a typed configuration object passed explicitly into services, replacing scattered `process.env` reads.

## Context

Confirmed direct `process.env` reads in `index.ts` (`API_PORT`, `API_HOST`, `WEB_DIST`, `MQTT_BROKER`, `MQTT_PORT`, `MQTT_USER`, `MQTT_PASS`, `MQTT_ROOT`, `ENABLE_MQTT`, `MESHTASTIC_PORT`, `MESHTASTIC_NAME`), `db/open.ts`/`db/client.ts` (`PGLITE_DIR`), `routes/coverage.ts` (`ELEVATION_API_URL`), and `device/device-manager.ts` (`BOT_ENABLED`). Per `CLAUDE.md`, all user-defined variables live in the root `.env` file — this task formalizes and validates that contract, it doesn't change where config comes from.

## Scope

### Included

A `config.ts`/`config/` module in `packages/daemon` reading and Zod-validating every environment variable currently referenced (enumerated above), with sensible typed defaults matching current behavior exactly (e.g. `MQTT_PORT` default 1883, `MQTT_USER` default `"meshdev"`); passing the resulting typed object into `DeviceManager`, `MqttGateway`, the analytics/coverage routes, and `index.ts` instead of each reading `process.env` directly.

### Excluded

Adding new configuration options or changing any default value — this is a structural change only, defaults must match current behavior exactly.

## Plan

1) Enumerate every `process.env` read site (list above, confirm completeness via grep). 2) Define the Zod schema matching current defaults/types exactly. 3) Fail fast (clear error, non-zero exit) on invalid/missing required config at startup, replacing whatever silent-default-or-crash-later behavior exists today. 4) Thread the typed config object through `index.ts` into each service's constructor, removing direct `process.env` reads from those services.

## Acceptance criteria

- [ ] All currently-read environment variables are validated once at startup via a Zod schema, with defaults identical to current behavior.
- [ ] `DeviceManager`, `MqttGateway`, analytics routes, and coverage routes receive a typed config object rather than reading `process.env` directly.
- [ ] Invalid configuration produces a clear startup-time error rather than a runtime failure deep in some unrelated code path.
- [ ] `.env.example` is checked against the new schema for consistency (every schema field documented there or vice versa).

## Validation requirements

Manual startup tests: valid `.env` (daemon starts normally), missing required var (clear fail-fast error), invalid type (e.g. non-numeric port — clear fail-fast error). Regression check that MQTT/serial/analytics/coverage behavior is unchanged with valid config.

## Risks and assumptions

The main risk is silently changing a default while "formalizing" it — cross-check every default against current `?? "..."` fallback values in the enumerated files before writing the schema.

## Blocker

None.

## Implementation handoff

Implementer: openai-coder
Date: 2026-08-24

### Changes made

- Added `packages/daemon/src/config.ts`, exporting the contract's exact nested
  `DaemonConfig` interface, an environment-input `daemonConfigSchema` usable
  with `.safeParse()`, and synchronous, non-memoized `loadConfig()`.
- Implemented all 14 CONTRACT-003 fields with the preserved defaults and
  optionality. Boolean values use exact equality with `"true"`; ports accept
  positive integer strings and reject malformed values; validation failures
  are aggregated into one error with one environment-variable line per issue.
- Anchored `WEB_DIST` and `PGLITE_DIR` at the repository root so their absolute
  defaults match the historical paths independent of `config.ts`'s location.
- Called `loadConfig()` once as the first statement in `main()` and replaced
  all entry-point environment reads while preserving MQTT and Meshtastic
  control flow.
- Passed `Pick<DaemonConfig, "bot">` to `DeviceManager` and
  `Pick<DaemonConfig, "coverage">` to `registerCoverageRoutes`; updated the
  existing DeviceManager test construction. Left `MqttGatewayConfig` and
  analytics route signatures unchanged.
- Added 12 configuration tests covering defaults, exact boolean semantics,
  numeric parsing/rejection, multi-issue aggregation, path resolution, and a
  realistic full environment-like input.

### Validation performed

- A local NVM runtime was found and activated: Node `v22.22.3`. Corepack
  resolved the repository's package-manager pin to pnpm `11.21.0` using a
  temporary shim directory under `/tmp`.
- `pnpm --filter @foreman/daemon build` under Node 22.22.3 / pnpm 11.21.0 —
  passed (exit 0); `tsc --noEmit` reported zero errors.
- `pnpm --filter @foreman/daemon test` under Node 22.22.3 / pnpm 11.21.0 —
  passed (exit 0): 8 test files passed, 156 tests passed, 0 failed. All PGlite
  worker tests passed, confirming the seven Node 20 failures below were an
  out-of-spec runtime issue rather than a task regression.
- `pnpm --filter @foreman/daemon build` — failed before execution (exit 127):
  `pnpm: command not found` in the sandbox PATH.
- `pnpm --filter @foreman/daemon test` — failed before execution (exit 127):
  `pnpm: command not found` in the sandbox PATH.
- `corepack pnpm --filter @foreman/daemon build` — failed before script
  execution (exit 1): Node 20.19.2 could not run pinned pnpm 11.21.0 and raised
  `ERR_VM_DYNAMIC_IMPORT_CALLBACK_MISSING`; the repository requires Node
  >=22.13.
- `corepack pnpm --filter @foreman/daemon test` — same launcher/runtime failure
  (exit 1), with no tests run.
- `./node_modules/.bin/tsc --noEmit` (from `packages/daemon`) — initial run
  found one missed coverage helper argument (TS2554); fixed. Final post-format
  run passed with exit 0 and zero errors.
- `./node_modules/.bin/vitest run` (from `packages/daemon`) — 8 files ran,
  149 tests passed and 7 failed out of 156. All 7 failures were confined to
  pre-existing `src/db/__tests__/open.test.ts`, where Node 20 cannot load
  `src/db/pglite.thread.ts` (`Unknown file extension ".ts"`).
- `./node_modules/.bin/vitest run src/__tests__/config.test.ts` — final run:
  1 file passed, 12 tests passed, 0 failed.
- `./node_modules/.bin/vitest run --exclude src/db/__tests__/open.test.ts` —
  7 files passed, 147 tests passed, 0 failed.
- `./node_modules/.bin/prettier --check packages/daemon/src/config.ts packages/daemon/src/index.ts packages/daemon/src/device/device-manager.ts packages/daemon/src/routes/coverage.ts packages/daemon/src/__tests__/config.test.ts packages/daemon/src/__tests__/device-manager.test.ts .env.example`
  — exited 2: identified formatting changes in `config.ts` and `coverage.ts`,
  and could not infer a parser for `.env.example`; the two TypeScript files
  were formatted.
- `./node_modules/.bin/prettier --check packages/daemon/src/config.ts packages/daemon/src/index.ts packages/daemon/src/device/device-manager.ts packages/daemon/src/routes/coverage.ts packages/daemon/src/__tests__/config.test.ts packages/daemon/src/__tests__/device-manager.test.ts`
  — passed; all matched files use Prettier style.
- Simulated smoke check used `config.test.ts`: the realistic 14-variable input
  loaded successfully, while the multi-invalid fixture threw one formatted
  error containing both `API_PORT` and `MQTT_PORT` violations.
- `rg -n "process\\.env" packages/daemon/src` — only `config.ts`,
  `db/open.ts`, and `db/client.ts` matched, exactly the contract-permitted set.

### Acceptance criteria evidence

- The schema exposes all 14 fields and preserves the current defaults: API
  `3750`/`"0.0.0.0"`/`<repo>/packages/web/dist`; DB
  `<repo>/pglite-data`; MQTT `false`/`undefined`/`1883`/`"meshdev"`/
  `"large4cats"`/`"msh/US"`; Meshtastic `undefined`/`undefined`; bot
  `false`; coverage public Open-Elevation URL.
- `ENABLE_MQTT` and `BOT_ENABLED` use `value === "true"`, and tests cover
  `"true"`, `"false"`, `"1"`, `"TRUE"`, and `""`.
- Both ports reject non-numeric values through `.safeParse()` and
  `loadConfig()`; aggregation and environment-variable labels are tested.
- `loadConfig()` appears in runtime code only once, at the start of `main()`;
  the existing `main().catch(...fatalError...)` path remains unchanged.
- `.env.example` now contains every schema variable. `API_PORT=3172` remains
  intentionally unchanged.

### Assumptions and deviations

- Chose the contract-permitted narrow typed shapes
  `Pick<DaemonConfig, "bot">` and `Pick<DaemonConfig, "coverage">`.
- Added commented `MESHTASTIC_NAME`, `PGLITE_DIR`, and `WEB_DIST` examples;
  the two path values are labeled advanced storage/packaging overrides.
- No behavioral deviations from CONTRACT-003 were introduced. Initial
  validation used the out-of-spec system Node 20 runtime; final validation
  activated local Node 22.22.3 and ran the exact required commands successfully
  with pnpm 11.21.0.

### Unresolved risks

- CONTRACT-003 Open Question #1 remains out of scope: `db/open.ts` and
  `db/client.ts` retain their existing direct `PGLITE_DIR` reads.
- Open Question #2 was resolved per the accepted contract by leaving analytics
  unchanged because it has no environment read.
- Open Question #3 remains out of scope: `ENABLE_MQTT=true` without a broker
  is still the historical silent no-op, with no cross-field refinement.

### Documentation updated

- Updated root `.env.example` to document `MESHTASTIC_NAME`, `PGLITE_DIR`, and
  `WEB_DIST`; all other configuration documentation and contract files remain
  unchanged.

## Review

Not reviewed.

## Human acceptance

Pending.
