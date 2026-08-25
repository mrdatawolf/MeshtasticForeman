# TASK-009: Add tests for shared WebSocket command schemas and server event payloads

Owner role: Implementer
Assigned agent: openai-coder
Proposed by: jarvis
Proposed date: 2026-08-24
Approved by: Patrick
Approved date: 08/24/26
Related contracts: None
Related ADRs: None
Dependencies: None

## Desired outcome

Every `ClientCommand` Zod schema in `packages/shared/src/ws-protocol.ts` has validation tests (extending the existing `ws-protocol.test.ts`, which currently only covers `message:send`), and every `ServerEvent` variant's payload shape has a fixture-based test guarding against drift.

## Context

Confirmed 11 command schemas exist (`sendMessageSchema`, `subscribePacketsSchema`, `requestHistorySchema`, `requestNodeListSchema`, `requestMqttNodeListSchema`, `requestPositionSchema`, `requestTracerouteSchema`, `removeNodeSchema`, `mqttToggleSchema`, `requestDeviceConfigSchema`, `setDeviceConfigSchema`), combined into `clientCommandSchema`. `ServerEvent` (21 variants) is a plain TypeScript discriminated union with **no runtime Zod validation** — it's producer-side only (daemon → client), so "testing" it means fixture/type-level tests that catch payload-shape drift, not runtime parsing tests.

## Scope

### Included

Extending `ws-protocol.test.ts` to cover all 11 command schemas' valid/invalid cases (not just `message:send`); adding fixture-based tests (or an exhaustiveness-checked type test) that construct one example of each `ServerEvent` variant and assert it type-checks against the union, catching accidental payload-shape changes.

### Excluded

Making `App.tsx`'s event handling exhaustive (that's a Stage 4 item, TASK-017) — this task only tests the shared type/schema definitions in `packages/shared`.

## Plan

1) Add valid/invalid test cases for each remaining command schema. 2) Add a fixture module listing one canonical example of every `ServerEvent` variant. 3) Add a compile-time exhaustiveness check (e.g. a `satisfies`/never-based assertion) so an unhandled new variant fails the type check, giving early warning ahead of TASK-017's runtime exhaustiveness work.

## Acceptance criteria

- [x] All 11 `ClientCommand` schemas have valid- and invalid-payload test cases. Evidence: `packages/shared/src/ws-protocol.test.ts` exercises each exported command schema with `.safeParse()`, and the shared suite passes 26/26 tests.
- [x] A fixture exists covering all current `ServerEvent` variants. Evidence: `serverEventFixtures` in `packages/shared/src/ws-protocol.test.ts` contains all 23 variants currently declared by `ServerEvent`, with a runtime assertion fixing the expected count at 23.
- [x] A compile-time exhaustiveness check fails the build if a `ServerEvent` variant is added without a corresponding fixture. Evidence: the fixture uses `satisfies Record<ServerEvent["type"], ServerEvent>`, and `pnpm --filter @foreman/shared build` passes.

## Validation requirements

`pnpm --filter @foreman/shared test` (or wherever these tests land — confirm shared package gets a test runner if it doesn't already; currently `shared/package.json` has no `test` script, only `build`/`lint` — add one as part of this task).

## Risks and assumptions

`packages/shared` currently has no test script or vitest dependency — this task must add that infrastructure, which is a small addition to scope but necessary.

## Blocker

None.

## Implementation handoff

Task: TASK-009
Implementer: openai-coder
Date: 2026-08-24

### Changes made

- Added Vitest 4.1-compatible test scripts and dev dependency to `packages/shared/package.json`.
- Added a Node-environment Vitest configuration at `packages/shared/vitest.config.ts`.
- Created `packages/shared/src/ws-protocol.test.ts` with valid and invalid `.safeParse()` cases for all 11 client command schemas, plus discriminated-union acceptance/rejection coverage.
- Kept all server-event fixtures in the test file so the compile-time and runtime drift guards are reviewed alongside the event tests. The fixture covers all 23 variants currently present in `ServerEvent`.
- Updated `pnpm-lock.yaml` through the root workspace install.
- Extended the shared formatting scripts to include `vitest.config.ts`.

### Validation performed

- `pnpm --filter @foreman/shared build` — passed (`tsc --noEmit`, exit 0).
- `pnpm --filter @foreman/shared test` — passed: 1/1 test file and 26/26 tests.
- `pnpm --filter @foreman/shared format:check` — passed: all matched files use Prettier formatting.
- `pnpm --filter @foreman/daemon test` — passed: 7/7 test files and 144/144 tests in the current concurrent workspace.

### Acceptance criteria evidence

- Each of the 11 individually exported command schemas has one valid and one invalid payload assertion; three additional tests exercise `clientCommandSchema` across all valid commands and reject unknown/malformed commands.
- `serverEventFixtures` contains a typed payload example for every current discriminator and has a runtime `toHaveLength(23)` assertion.
- `satisfies Record<ServerEvent["type"], ServerEvent>` makes a missing discriminator or invalid payload fail the shared TypeScript build.

### Assumptions and deviations

- The task repeatedly says there are 21 server-event variants, but both its explicit list and the current `ServerEvent` union contain 23. All 23 were covered, and the runtime drift assertion uses the actual count of 23.
- The task expected the daemon baseline to be 69 tests. Other agents are concurrently working under `packages/daemon`; the current suite contains 144 tests, all of which passed. No daemon file was edited for this task.
- The sandbox lacked `pnpm` on `PATH`, exposed system Node 20 instead of the repository-required Node 22, denied writes to pnpm's normal store index, and denied workspace binary execution during install lifecycle scripts. The root install was therefore completed with cached pnpm 11.21.0 and Node 22.23.2, a writable temporary store index, offline resolution, and lifecycle scripts disabled. Dependency linking and the scoped validation commands completed successfully.

### Unresolved risks

- The requested historical daemon count of 69 cannot be reproduced in the concurrently changing workspace; the current 144-test suite is green.
- Install lifecycle scripts were not run because of sandbox execution restrictions. This does not affect the shared or daemon validations, but a normal developer/CI install will run them outside this sandbox.

### Documentation updated

- Updated this task file with acceptance evidence and the implementation handoff. No product or architecture documentation changed because runtime behavior and architecture are unchanged.

## Review

Not reviewed.

## Human acceptance

Pending.
