# TASK-034: Record retrospective ADRs for major existing architectural choices

Owner role: Documentation Curator
Assigned agent: librarian
Proposed by: jarvis
Proposed date: 2026-08-24
Approved by:
Approved date:
Related contracts: None (this task produces ADRs, it doesn't need one)
Related ADRs: Produces ADR-002 (PGlite worker-thread usage), ADR-003 (MQTT bridging design), ADR-004 (multi-device support stance) — **not** the WebSocket/App-state-ownership decision, which is pulled forward as ADR-001 and a prerequisite of TASK-017 rather than documented retrospectively here (see TASK-017's context note)
Dependencies: None — can proceed at any time, independent of code changes, though richer post-Stage-5 (more settled architecture to describe accurately)

## Desired outcome

Major existing architectural choices — PGlite worker-thread usage, MQTT bridging design, and current multi-device support stance — are recorded as ADRs, preventing repeated re-litigation and giving future contributors the "why," not just the "what."

## Context

These decisions already exist in the codebase (confirmed: the worker-thread pattern in `db/open.ts`/`db/client.ts` with its documented Windows-WASM-initdb rationale; the MQTT gateway's re-encryption/publishing design in `mqtt/gateway.ts` and `docs/ARCHITECTURE.md`; the current single-device-per-daemon architecture visible throughout `device-manager.ts`). This task documents decisions already made, not new ones — it's retrospective, matching the Librarian's role ("preserve approved architecture... does not invent or approve decisions").

## Scope

### Included

ADR-002 (PGlite worker-thread pattern — why, given Windows WASM initdb constraints, per the existing code comment in `db/client.ts`); ADR-003 (MQTT bridging design — re-encryption approach, topic structure, periodic re-announce, per `docs/ARCHITECTURE.md`'s existing description); ADR-004 (current multi-device support stance — single device per daemon today, with the "Multiple devices per daemon" product-roadmap idea noted as the known future direction, not yet decided).

### Excluded

WebSocket/App-state-ownership (that's ADR-001, a prerequisite decision for TASK-017, not retrospective); deciding anything new — if writing these ADRs surfaces a genuine open question (e.g. "is the worker-thread pattern still necessary on all platforms, or only Windows?"), record that as a noted open question in the ADR rather than resolving it unilaterally.

## Plan

1) Draft ADR-002 from the existing code/comments describing the PGlite worker-thread rationale. 2) Draft ADR-003 from `docs/ARCHITECTURE.md`'s existing MQTT gateway description. 3) Draft ADR-004 describing the current single-device stance and linking to the "Multiple devices per daemon" product-roadmap item as the known future direction. 4) Present all three to you for review/approval per `docs/decisions/README.md` (ADRs record accepted decisions).

## Acceptance criteria

- [ ] ADR-002, ADR-003, and ADR-004 exist under `docs/decisions/`, following `docs/decisions/ADR-TEMPLATE.md`.
- [ ] Each ADR accurately reflects the decision already implemented in the code (verified against the cited source files), not an idealized or aspirational description.
- [ ] Any open question surfaced during drafting is explicitly recorded as such, not silently resolved.

## Validation requirements

Cross-check each ADR's description against the actual current implementation (`db/open.ts`, `mqtt/gateway.ts`, `device-manager.ts`) for accuracy before presenting to you.

## Risks and assumptions

Low risk — pure documentation, no code change. Main risk is inaccuracy (describing intended rather than actual behavior) — mitigated by grounding each ADR directly in the files cited above.

## Blocker

None.

## Implementation handoff

Not started.

## Review

Not reviewed.

## Human acceptance

Pending.
