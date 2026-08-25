# TASK-022: Move inline styles into feature-level CSS modules or stylesheets

Owner role: UX Specialist
Assigned agent: interface-designer
Proposed by: jarvis
Proposed date: 2026-08-24
Approved by: Patrick
Approved date: 08/24/26
Related contracts: None
Related ADRs: None
Dependencies: Loosely follows each corresponding split task (TASK-018 for shell, TASK-019 for map, TASK-020 for analytics, TASK-021 for device config) — recommend doing style extraction *as part of* or immediately after each page's split, rather than as one giant final pass, to avoid redoing work as component boundaries move. No hard blocker if you'd rather do this as one consolidated pass at the end of Stage 4

## Desired outcome

Large inline style collections and dynamically inserted style rules currently scattered across pages move into feature-level CSS modules or stylesheets.

## Context

Confirmed extensive inline `style={...}` usage and style-object helper functions (e.g. `actionBtnStyle`, `popupActionBtnStyle` in `MapPage.tsx`/`NodeDetailPanel.tsx`) throughout the large page files targeted by TASK-018–021.

## Scope

### Included

Converting inline style objects/dynamically-generated style rules in the shell, `MapPage`, `AnalyticsPage`, and `DeviceConfigPage` (and their now-extracted sub-components) into CSS modules or stylesheets scoped per feature.

### Excluded

Any visual redesign — colors, spacing, and layout must remain identical; this is purely a mechanism change (inline JS objects → CSS modules).

## Plan

Recommend running this incrementally alongside TASK-018–021 rather than as a single task spanning the whole frontend at once — propose to you whether to keep this as one umbrella task tracked across those four PRs, or split it into four sub-tasks (one per page) for cleaner independent review. I lean toward four small linked tasks given the "keep them small enough to be independently reviewable" guidance, but you may prefer one umbrella task — flagging for your call rather than deciding unilaterally.

## Acceptance criteria

- [ ] Shell, `MapPage`, `AnalyticsPage`, and `DeviceConfigPage` (and their split-out sub-components) no longer contain large inline style-object collections.
- [ ] No visible styling change anywhere in the app (pixel-level regression pass or visual diff tooling if available).

## Validation requirements

Visual regression pass (manual or tooled, if a visual diff tool is available in this repo — confirm) per page touched.

## Risks and assumptions

I'm flagging the scoping question (one task vs. four) explicitly rather than resolving it myself — this is a structural decision about task granularity, appropriate for you to make.

## Blocker

None.

## Implementation handoff

Not started.

## Review

Not reviewed.

## Human acceptance

Pending.
