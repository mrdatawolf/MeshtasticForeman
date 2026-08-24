# TASK-013: Introduce a typed frontend HTTP client

Owner role: Implementer
Assigned agent: openai-coder
Proposed by: jarvis
Proposed date: 2026-08-24
Approved by:
Approved date:
Related contracts: **CONTRACT-002 recommended, borderline** (cross-cutting since used everywhere, but wraps an already-contracted API per `API_PROMISES.md` — propose and let you decide per change-classification.md's "when uncertain, propose a contract")
Related ADRs: None
Dependencies: None (can proceed independently; TASK-020/TASK-021 will consume it once split, but this task itself doesn't require them)

## Desired outcome

`packages/web/src/api/` contains small, feature-specific typed HTTP modules (devices, analytics, coverage, proposals, overrides, configuration) that consistently check `response.ok`, decode structured errors, encode query parameters, support `AbortSignal`, and handle empty responses — replacing scattered direct `fetch()` calls.

## Context

Confirmed direct `apiFetch<T>()` calls exist in `AnalyticsPage.tsx` (e.g. `/api/traceroutes`, `/api/analytics/message-latency`, `/api/analytics/link-quality`) and presumably elsewhere; there's already an `apiFetch` helper in use, so this task may be formalizing/relocating an existing informal pattern rather than starting from nothing — confirm during implementation.

## Scope

### Included

The six named feature modules; consistent error decoding and `response.ok` handling; `AbortSignal` support for cancellable requests; query-parameter encoding helpers; migrating feature-by-feature (not all at once, per the roadmap's explicit instruction) starting with whichever feature is being touched by a concurrent task (e.g. analytics, to dovetail with TASK-020).

### Excluded

Migrating every single `fetch()` call in one PR — this task establishes the client and modules and does an initial migration wave; full migration may span multiple follow-up PRs under the same task or a tracked continuation, at your discretion.

## Plan

1) Locate the existing `apiFetch` helper and any other direct `fetch()` call sites to scope the real size of migration. 2) Design the shared client core (error decoding, `AbortSignal`, query encoding) once. 3) Build the six feature modules on top of it. 4) Migrate the analytics feature first (dovetails with TASK-020's page split) as the proof case; migrate remaining features incrementally.

## Acceptance criteria

- [ ] `packages/web/src/api/` contains devices, analytics, coverage, proposals, overrides, and configuration modules.
- [ ] All modules share one core client that checks `response.ok`, decodes structured errors consistently, supports `AbortSignal`, and handles empty (204/no-body) responses.
- [ ] At least the analytics feature is fully migrated to the new client as part of this task.
- [ ] Remaining direct `fetch()` call sites are enumerated (e.g. as a checklist or follow-up note) so migration progress is trackable.

## Validation requirements

TASK-010's web test infra used to unit test the client core (error decoding, abort behavior) in isolation; manual smoke test of the migrated analytics feature.

## Risks and assumptions

Flagging the contract question directly for your call: is this internal plumbing (no contract needed, acceptance criteria suffice) or does its cross-cutting reach across every feature warrant locking down its error/response conventions in a contract before implementation? I lean toward "propose, let you decide."

## Blocker

None.

## Implementation handoff

Not started.

## Review

Not reviewed.

## Human acceptance

Pending.
