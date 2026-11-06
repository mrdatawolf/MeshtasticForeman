# TASK-053: Show not-responding in the app header

Owner role: interface-designer
Assigned agent:
Proposed by: Claude, at Patrick Moon's request
Proposed date: 2026-11-06
Approved by:
Approved date:
Related contracts: CONTRACT-013
Related ADRs: ADR-004
Dependencies: TASK-049

## Desired outcome

Someone using the app notices a radio that has stopped responding without opening the
device menu.

## Context

TASK-049 shows "Not Responding" only inside the device menu and GPS menu. The API
button's dot reports the API connection, not the radio, so a hung radio is invisible
until someone opens a menu, usually after they have already noticed a problem.

## Scope

### Included

- A visible header indicator when any connected radio has `notResponding` set.
- A link from it to the Debug page.
- Clearing without a reload when the radio answers again.

### Excluded

- Changing the Radio responding rule or its timing.
- Notifications outside the app.
- Automatic recovery.

## Plan

1. Agree the indicator's placement and wording with Patrick.
2. Add it to the header, reading `notResponding` from existing device state.
3. Check it at desktop and phone widths.

## Acceptance criteria

- [ ] A radio that is not responding is visible in the header on every page.
- [ ] The indicator links to the Debug page.
- [ ] It clears without a reload when the radio answers.
- [ ] With several radios, it is clear which one is affected.
- [ ] A healthy radio shows no indicator.
- [ ] It fits at phone width and meets the text contrast target.

## Validation requirements

`pnpm lint`, `pnpm build`, and `pnpm test`, plus a browser check at desktop and phone
widths. Run heavy commands under a memory cap.

## Risks and assumptions

- The header is already crowded and wraps at some widths, so placement needs care.

## Blocker

None.

## Implementation handoff

Not started.

## Review

Not reviewed.

## Human acceptance

Pending.
