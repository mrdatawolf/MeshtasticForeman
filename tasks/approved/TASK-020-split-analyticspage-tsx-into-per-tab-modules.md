# TASK-020: Split AnalyticsPage.tsx into per-tab modules

Owner role: UX Specialist
Assigned agent: interface-designer
Proposed by: jarvis
Proposed date: 2026-08-24
Approved by: Patrick
Approved date: 08/24/26
Related contracts: None (TASK-005's endpoint tests already pin backend behavior; this is a frontend-only restructuring)
Related ADRs: None
Dependencies: TASK-005 (endpoint behavior already regression-tested — safe to restructure the frontend consumer), TASK-013 recommended (typed HTTP client — natural fit for the "small query hook" the roadmap asks for), not a hard blocker if you'd rather sequence them independently

## Desired outcome

`AnalyticsPage.tsx` (1749 lines) is split into one module per analytics tab (signal, messages, network, telemetry, packets, positions — matching the same domain grouping used in TASK-026's backend route split) plus shared chart components, with a small query hook handling loading/cancellation/refresh/error state.

## Context

Confirmed `AnalyticsPage.tsx` currently fetches traceroutes, message-latency, link-quality, and presumably the remaining 14 analytics endpoints inline, each apparently with its own near-identical fetch effect (e.g. lines 437, 648, 1149 show the repeated `apiFetch<T>(...).then(...).catch(...)` pattern).

## Scope

### Included

One module per tab grouping; a shared query hook (loading/cancel/refresh/error) used by all tabs instead of near-identical individual effects; shared chart components factored out (this uses `recharts`, per `web/package.json`).

### Excluded

Changing what data any chart displays or how it's visually presented — behavior-preserving restructuring.

## Plan

1) Group the 17 analytics endpoints into the six domains (matching TASK-026's backend grouping so frontend/backend domain boundaries agree). 2) Build the shared query hook (ideally reusing TASK-013's typed client and its `AbortSignal` support for cancellation). 3) Extract shared chart components. 4) Migrate tab-by-tab, replacing individual fetch effects with the query hook.

## Acceptance criteria

- [ ] Analytics tabs are organized into signal, messages, network, telemetry, packets, and positions modules (or the closest sensible grouping, confirmed against TASK-026).
- [ ] A shared query hook handles loading, cancellation, refresh, and error states consistently across tabs, replacing the near-identical repeated effects.
- [ ] Shared chart components are factored out and reused across tabs.
- [ ] No visible change to any chart's displayed data (manual comparison per tab, before/after).

## Validation requirements

Manual regression pass per analytics tab comparing displayed values before/after; query hook unit tests (TASK-010 infra) for cancellation/error/refresh behavior.

## Risks and assumptions

Second-largest split by line count (1749 lines) — same recommendation as TASK-019 to split implementation across multiple commits/PRs within this task.

## Blocker

None.

## Implementation handoff

Not started.

## Review

Not reviewed.

## Human acceptance

Pending.
