# TASK-015: Deduplicate API documentation

Owner role: Implementer
Assigned agent: openai-coder
Proposed by: jarvis
Proposed date: 2026-08-24
Approved by:
Approved date:
Related contracts: None
Related ADRs: None
Dependencies: None

## Desired outcome

`API_PROMISES.md` and `docs/api/index.md` are not maintained as two independent copies — either one is generated from the other, or one is chosen as canonical and the other links to it.

## Context

`API_PROMISES.md` (root, 28KB) currently exists; confirm whether `docs/api/index.md` already exists or needs to be created — check during implementation, since `docs/ARCHITECTURE.md` already links to `API_PROMISES.md` as "the full contract."

## Scope

### Included

A decision (for your approval, since this is a real choice with alternatives, even if lightweight) between generation vs single-canonical-with-link; implementing whichever is chosen.

### Excluded

Rewriting API documentation content — this is strictly a dedup/structure task.

## Plan

1) Confirm current state of `docs/api/index.md` (exists as a stale copy, or doesn't exist yet). 2) Recommend to you: given `API_PROMISES.md` is the established, actively-linked root file, the simplest low-risk option is likely "keep `API_PROMISES.md` canonical, make `docs/api/index.md` a thin VitePress page that includes/links to it" rather than building a generator — but this is your call to make, not mine to decide unilaterally. 3) Implement the approved approach.

## Acceptance criteria

- [ ] `API_PROMISES.md` and `docs/api/index.md` have exactly one canonical content source; the other is either generated or a clear pointer.
- [ ] `docs/ARCHITECTURE.md`'s existing link to `API_PROMISES.md` remains accurate.
- [ ] The VitePress docs site (`pnpm docs:build`) still builds successfully.

## Validation requirements

`pnpm docs:build` succeeds; manual check that both surfaces (root file, docs site) show consistent content.

## Risks and assumptions

This task's plan includes a small decision point I'm flagging for your explicit call rather than deciding myself, per my role boundaries.

## Blocker

None.

## Implementation handoff

Not started.

## Review

Not reviewed.

## Human acceptance

Pending.
