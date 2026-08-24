# TASK-026: Split the analytics route file by domain

Owner role: Implementer
Assigned agent: openai-coder
Proposed by: jarvis
Proposed date: 2026-08-24
Approved by:
Approved date:
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

- [ ] The 17 analytics endpoints are organized into domain modules (signal, messages, network, telemetry, packets, positions, or the closest sensible mapping).
- [ ] SQL/query-building functions are separated from Fastify request-handling code within each module and can be unit tested directly without an HTTP request.
- [ ] TASK-005's full endpoint test suite passes unchanged against the split implementation.
- [ ] No change to any endpoint's URL, response shape, or query semantics.

## Validation requirements

TASK-005's full test suite; confirm no endpoint's route path changed by re-running any existing frontend integration against the split routes.

## Risks and assumptions

Lower risk than TASK-012/024/025 since TASK-005's tests already comprehensively pin this file's behavior — this is closer to TASK-002's mechanical-consolidation risk profile than the high-risk protocol refactors.

## Blocker

None.

## Implementation handoff

Not started.

## Review

Not reviewed.

## Human acceptance

Pending.
