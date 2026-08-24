# TASK-033: Add lightweight health and readiness endpoints

Owner role: Implementer
Assigned agent: openai-coder
Proposed by: jarvis
Proposed date: 2026-08-24
Approved by:
Approved date:
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

- [ ] A liveness endpoint confirms the process is running.
- [ ] A readiness endpoint confirms the PGlite worker is responsive and reports MQTT connectivity status (when configured) per CONTRACT-010's defined semantics.
- [ ] Healthy, degraded, and failed states are distinguishable in the endpoint's response, per CONTRACT-010.
- [ ] The existing systemd startup tooling is checked against the new endpoint and updated if it was relying on a less precise check.

## Validation requirements

Manual testing of each state: normal startup (healthy), PGlite worker killed externally (failed/degraded per spec), MQTT broker unreachable while configured (degraded per spec).

## Risks and assumptions

The "degraded vs. failed" distinction is the one real design question here — resolve it in CONTRACT-010 before implementation rather than letting it become an implicit implementation detail.

## Blocker

None.

## Implementation handoff

Not started.

## Review

Not reviewed.

## Human acceptance

Pending.
