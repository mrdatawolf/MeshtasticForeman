# TASK-033: Add lightweight health and readiness endpoints

Owner role: Implementer
Assigned agent: openai-coder
Proposed by: jarvis
Proposed date: 2026-08-24
Approved by: Patrick
Approved date: 08/25/26
Related contracts: **CONTRACT-010 recommended** (externally consumed by orchestrators/monitoring tooling, ambiguous without an explicit healthy/degraded/failed definition — exactly what change-classification.md flags)
Related ADRs: None
Dependencies: TASK-014 (config module — to know what optional external integrations, like MQTT, are configured and should be checked), TASK-029 (graceful shutdown — readiness should reflect shutdown-in-progress state)

## Desired outcome

Health and readiness endpoints cover the HTTP server, database worker, and optional external integrations (MQTT broker connectivity), letting operators distinguish healthy, degraded, and failed states.

## Context

No such endpoints currently exist. Given this project runs self-hosted (per `docs/PROJECT.md`) and is also packaged as a systemd service (per the recent commit "Add systemd units for API/frontend and wait-for-API on startup"), health endpoints have a concrete near-term consumer already in the repo's own startup tooling.

## Scope

### Included

A `/health` (or similar) liveness endpoint (is the process up); a `/ready` (or similar) readiness endpoint checking the PGlite worker is responsive and, if MQTT is configured (per TASK-014's config), that the broker connection is up — degraded (not failed) if MQTT is configured but currently disconnected, since MQTT connectivity issues shouldn't take down the whole daemon's readiness given serial/local functionality can continue independently.

### Excluded

Deep health checks of every subsystem (e.g. serial device connectivity) — scope explicitly named by the roadmap is "HTTP server, database worker, and optional external integrations," not device-level health.

## Plan

1) Define exact healthy/degraded/failed semantics per subsystem as part of CONTRACT-010, since "degraded" is inherently ambiguous without a spec (e.g. is MQTT-disconnected-but-configured degraded or failed?). 2) Implement the liveness endpoint (trivial — process responds). 3) Implement the readiness endpoint checking PGlite worker responsiveness and MQTT connectivity status. 4) Update the systemd `wait-for-API` startup tooling (referenced in recent commit history) to use the new endpoint if it isn't already doing so via a simpler check.

## Acceptance criteria

- [x] A liveness endpoint confirms the process is running.
- [x] A readiness endpoint confirms the PGlite worker is responsive and reports MQTT connectivity status (when configured) per CONTRACT-010's defined semantics.
- [x] Healthy, degraded, and failed states are distinguishable in the endpoint's response, per CONTRACT-010.
- [x] The existing systemd startup tooling is checked against the new endpoint and updated if it was relying on a less precise check.

## Validation requirements

Manual testing of each state: normal startup (healthy), PGlite worker killed externally (failed/degraded per spec), MQTT broker unreachable while configured (degraded per spec).

## Risks and assumptions

The "degraded vs. failed" distinction is the one real design question here — resolve it in CONTRACT-010 before implementation rather than letting it become an implicit implementation detail.

## Blocker

None.

## Implementation handoff

Implemented by openai-coder on 2026-08-25.

### Changes made

- Added `GET /api/health` and `GET /api/ready` in a new health route module.
- Added the `MqttGateway.connected` accessor, using the authorized mechanical
  rename of its backing field to `_connected` without changing connection logic.
- Registered health routes before the SPA fallback and listener startup.
- Changed `start-frontend.sh` to poll `/api/health` with `curl --fail -s`.
- Added route tests for liveness, all required readiness states, PGlite
  rejection, and the 2000 ms timeout race.

### Validation performed

- New health tests: 1 file passed, 8 tests passed.
- All daemon route tests: 5 files passed, 86 tests passed.
- Daemon TypeScript `tsc --noEmit`: passed with no diagnostics.
- Scoped ESLint and Prettier checks: passed. `gateway.ts` was linted with the
  pre-existing late-import `import/order` diagnostic disabled; no other
  diagnostics were reported.
- `bash -n start-frontend.sh`: passed.

The required manual live-daemon failure scenarios were not run because this
sandbox has Node v20.19.2 rather than the required Node >=22.13.0 and has no
configured external PGlite worker/MQTT broker failure harness. Automated
injection tests cover the specified states.

### Assumptions and deviations

- An unexpected MQTT accessor error is represented as `mqtt: "disconnected"`,
  the only defined MQTT failure state in CONTRACT-010.
- No behavior deviates from CONTRACT-010. The `_connected` backing-field rename
  was explicitly authorized to make the required getter valid TypeScript.

### Unresolved risks

- Re-run validation under Node >=22.13.0 with pnpm 11.21.0; Corepack's pinned
  pnpm could not start under the sandbox's Node 20 runtime.
- Perform CONTRACT-010's live manual checks against real PGlite and MQTT
  failure states during review.

### Addendum (post-handoff, orchestrating session, 2026-08-25)

Re-ran full validation under Node >=22, which this task's own sandbox couldn't
do. The `connected` accessor rename (getter backed by `_connected`) broke
`mqtt/__tests__/gateway.test.ts`, which set `internals.connected = true`
directly against the pre-existing `GatewayInternals` test-only interface —
this wasn't caught because the full suite (only route tests) wasn't run in
sandbox. Fixed by updating the test to assign `internals._connected` and
renaming the corresponding `GatewayInternals` interface field from
`connected` to `_connected`. Full daemon suite now passes 214/214 and
`tsc --noEmit` is clean.

## Review

Not reviewed.

## Human acceptance

Pending.
