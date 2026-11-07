# TASK-053: Show not-responding in the app header

Owner role: interface-designer
Assigned agent: Claude (main session)
Proposed by: Claude, at Patrick Moon's request
Proposed date: 2026-11-06
Approved by: Patrick
Approved date: 2026-11-06
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

- [x] A radio that is not responding is visible in the header on every page.
- [x] The indicator links to the Debug page.
- [x] It clears without a reload when the radio answers.
- [x] With several radios, it is clear which one is affected.
- [x] A healthy radio shows no indicator.
- [x] It fits at phone width and meets the text contrast target.

## Validation requirements

`pnpm lint`, `pnpm build`, and `pnpm test`, plus a browser check at desktop and phone
widths. Run heavy commands under a memory cap.

## Risks and assumptions

- The header is already crowded and wraps at some widths, so placement needs care.

## Blocker

None.

## Implementation handoff

Task: TASK-053
Implementer: Claude (main session)
Date: 2026-11-06

### Changes made

- `NotRespondingIndicator.tsx`: a red header button reading "Not responding: <names>",
  shown only while a radio has `notResponding` set. It opens the Debug page.
- `AppShell.tsx`: places it just before the GPS menu, so it shows on every page.
- `docs/guide/getting-started.md`: explains the indicator.

### Validation performed

- `pnpm test`, `pnpm lint` and `pnpm build`, all under a memory cap. See the final
  report for this change.
- 5 new component tests cover empty, named, clearing, Debug link and `role="alert"`.
- A built app with mocked `/api` and `/ws` passed 18 of 18 browser checks at 1440, 1280,
  768 and 375px: visible, named, no sideways scroll, inside the viewport. At 1440px it
  also opened the Debug page, named two radios, and cleared without a reload.
- Contrast is 8.13:1.

### Assumptions and deviations

- Plan step 1 asked to agree placement and wording first. Patrick said to go ahead, so
  these are defaults for him to confirm: the wording, a position before the GPS menu,
  and listing every affected radio by name.

### Unresolved risks

- Not seen with a real hung radio, for the same reason as TASK-049.
- While it shows, it wraps the MQTT, API and Settings menus to a second row at 1280 and
  1440px. With no radio affected, the header is unchanged.
- Very long radio names wrap rather than truncate.

### Documentation updated

`docs/guide/getting-started.md`.

## Review

Not reviewed.

## Human acceptance

Pending.
