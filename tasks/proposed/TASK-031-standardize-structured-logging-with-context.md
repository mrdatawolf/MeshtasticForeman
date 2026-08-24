# TASK-031: Standardize structured logging with context

Owner role: Implementer
Assigned agent: openai-coder
Proposed by: jarvis
Proposed date: 2026-08-24
Approved by:
Approved date:
Related contracts: None
Related ADRs: None
Dependencies: None (benefits from following TASK-024/025's splits for natural per-module logger injection points, but not a hard blocker)

## Desired outcome

Logging is structured (not ad hoc `console.log`) and attaches useful context — device ID, packet ID, operation, error cause — consistently across the daemon.

## Context

Confirmed current logging is via plain `console.log`/`console.error` with manually-formatted prefixes (e.g. `[db]`, `[mqtt]`, `[bot]` seen throughout `db/open.ts`, `mqtt/gateway.ts`, `device-manager.ts`).

## Scope

### Included

Choosing a structured logging approach (Fastify already has a built-in logger — evaluate reusing it daemon-wide vs. a separate structured logger, propose to you if there's a real tradeoff); replacing ad hoc `console.log`/`console.error` calls with structured log calls carrying device ID, packet ID, operation name, and error cause where applicable.

### Excluded

Log aggregation/shipping infrastructure (out of scope — this is about structuring what the daemon emits, not where it goes).

## Plan

1) Evaluate Fastify's built-in logger (already a dependency) as the daemon-wide logging mechanism vs. introducing a separate one — recommend to you based on findings. 2) Define the standard context fields (device ID, packet ID, operation, error cause) and a consistent log-call convention. 3) Migrate `console.log`/`console.error` call sites incrementally, prioritizing the highest-value areas first (device connection lifecycle, MQTT gateway, error paths).

## Acceptance criteria

- [ ] A single structured logging approach is used consistently across the daemon, replacing ad hoc `console.log`/`console.error`.
- [ ] Log entries related to device/packet operations include device ID, packet ID, operation name, and error cause where applicable.
- [ ] No decrypted MQTT payloads or PSKs appear in log output (per `docs/DEVELOPMENT.md`'s existing security requirement) — explicitly verify this isn't regressed by adding more context to logs.

## Validation requirements

Manual review of log output during a representative daemon run (device connect, message send/receive, MQTT publish) confirming structured, contextual entries and confirming no secret material leaks into logs.

## Risks and assumptions

The security constraint (never log decrypted payloads/PSKs) is the main risk here — adding "more context" to logs could accidentally violate it if not carefully scoped; treat this as a hard constraint on the acceptance criteria, not just a nice-to-have.

## Blocker

None.

## Implementation handoff

Not started.

## Review

Not reviewed.

## Human acceptance

Pending.
