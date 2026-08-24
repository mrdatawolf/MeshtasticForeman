# TASK-028: Introduce repository modules for repeated database row mapping

Owner role: Implementer
Assigned agent: openai-coder
Proposed by: jarvis
Proposed date: 2026-08-24
Approved by:
Approved date:
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

Not started.

## Review

Not reviewed.

## Human acceptance

Pending.
