# TASK-046: Make dark theme text readable

Owner role: interface-designer
Assigned agent: Codex
Proposed by: Claude, at Patrick Moon's request
Proposed date: 2026-11-04
Approved by: Patrick
Approved date: 2026-11-06
Related contracts: None
Related ADRs: None
Dependencies: None

## Desired outcome

Text on every page is comfortably readable on the dark theme, and text colours
are defined in one place so they cannot drift apart again.

## Context

The human reports that most pages are very hard to read. The web app has no
theme system: it is dark-only, and colours are hardcoded across CSS modules and
TSX. Measured contrast of the common text colours:

| Text colour | On `#0f172a` (page) | On `#1e293b` (panel) | WCAG AA (4.5:1) |
|---|---|---|---|
| `#334155` | 1.7 | 1.4 | Fails |
| `#475569` | 2.4 | 1.9 | Fails |
| `#64748b` | 3.8 | 3.1 | Fails |
| `#7a8fa6` | 5.4 | 4.4 | Fails on panels |
| `#94a3b8` | 7.0 | 5.7 | Passes |
| `#e2e8f0` | 14.5 | 11.9 | Passes |

The three failing slate colours account for about 128 text colour declarations
across 33 files. `opacity` reductions on some states dim text further.

## Scope

### Included

- A global stylesheet defining text colour tokens on `:root`, for example
  `--text-primary`, `--text-secondary`, `--text-muted`, `--text-disabled`.
- Replacing failing text colours with those tokens in CSS modules and TSX.
- Fixing `opacity` values that push readable text below the target.
- Readable text on the Leaflet map popups and in chart labels and tooltips.

### Excluded

- Adding a light theme or theme switcher.
- Tokenising backgrounds, borders, or status colours (green, red, amber).
- Layout or font size changes.

## Plan

1. Add the tokens and import the stylesheet in `packages/web/src/main.tsx`.
2. Replace `color:` declarations only. These hex values are also used for
   borders and backgrounds, which must not change.
3. Audit each page and shell menu in the running app.

## Acceptance criteria

- [ ] All readable text meets 4.5:1 on the background it actually sits on.
- [ ] Disabled text meets at least 3:1 and is still visibly distinct.
- [ ] No text colour below 4.5:1 remains in `packages/web/src`, other than the
      disabled token.
- [ ] Backgrounds, borders, and status colours are unchanged.
- [ ] Nodes, Map, Messages, Analytics, Activity, Logs, Overrides, Device Config,
      the wizard, and all shell menus were checked in the running app.

## Validation requirements

`pnpm lint`, `pnpm build`, and `pnpm test`, plus before and after screenshots of
each page in the acceptance list.

## Risks and assumptions

- Assumes "dark mode" means the app's only theme.
- Muted text keeps some hierarchy, but the gap to primary text gets smaller.

## Blocker

None.

## Implementation handoff

Not started.

## Review

Not reviewed.

## Human acceptance

Pending.
