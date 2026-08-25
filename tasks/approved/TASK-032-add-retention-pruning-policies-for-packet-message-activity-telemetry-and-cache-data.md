# TASK-032: Add retention/pruning policies for packet, message, activity, telemetry, and cache data

Owner role: Implementer
Assigned agent: openai-coder
Proposed by: jarvis
Proposed date: 2026-08-24
Approved by: Patrick
Approved date: 08/25/26
Related contracts: **CONTRACT-009 recommended** (ambiguous defaults, high-risk — irreversible data loss if pruning is wrong, exactly what change-classification.md flags)
Related ADRs: None
Dependencies: TASK-012 (consolidated PGlite proxy — pruning logic should live against the single db module), TASK-028 (repository modules — natural home for per-entity retention logic)

## Desired outcome

Packet, message, activity, telemetry, and cache data have defined retention or pruning policies, preventing unbounded growth without silently discarding data operators expect to keep.

## Context

No current retention/pruning mechanism exists per the roadmap's framing; this is new behavior with real consequences (data loss) if defaults are wrong, which is why a contract is strongly warranted here more than almost anywhere else in Stage 6.

## Scope

### Included

Defined retention windows (or row-count caps) per data category (packet, message, activity, telemetry, cache); a pruning mechanism (scheduled job or triggered on write); configuration (via TASK-014's config module) to let operators adjust or disable pruning; safe defaults that don't surprise existing operators upgrading into this behavior.

### Excluded

Building a full archival/export mechanism — pruning means deletion (or the contract may define an export step, if that's the direction CONTRACT-009 lands on — that's exactly the kind of question the contract should resolve, not something I should presume here).

## Plan

1) Propose retention windows/policies per data category to you as part of CONTRACT-009's design, since this is a real product/operational decision (how long is "long enough" for packet history?) that shouldn't be decided unilaterally by an implementer. 2) Once approved, implement per-category pruning against the repository modules from TASK-028. 3) Wire retention configuration through TASK-014's config module. 4) Add tests confirming pruning respects configured windows and doesn't delete data outside them.

## Acceptance criteria

- [ ] Packet, message, activity, telemetry, and cache data each have a defined, configurable retention policy per CONTRACT-009.
- [ ] Default retention windows are safe (don't silently delete data an upgrading operator would expect to keep) and are documented.
- [ ] Pruning is tested against boundary conditions (data exactly at the retention edge, data well within it, data well past it).
- [ ] Operators can adjust or disable pruning via configuration.

## Validation requirements

Tests covering retention boundary conditions per category; manual verification that a fresh install's default retention behavior matches what's documented before this ships, since silent, undocumented data loss is the primary risk.

## Risks and assumptions

This is the task most likely to cause real operator-facing harm if done wrong (irreversible data loss) — recommend this be one of the most carefully contract-reviewed items in the whole roadmap, on par with TASK-012/024/025's risk level despite being "just" Stage 6.

## Blocker

None.

## Implementation handoff

Not started.

## Review

Not reviewed.

## Human acceptance

Pending.
