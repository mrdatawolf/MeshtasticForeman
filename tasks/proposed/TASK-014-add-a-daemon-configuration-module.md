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

Not started.

## Review

Not reviewed.

## Human acceptance

Pending.
