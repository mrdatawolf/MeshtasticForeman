# TASK-048: Make dark theme text readable

Owner role: interface-designer
Assigned agent: interface-designer
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
- [x] Disabled text meets at least 3:1 and is still visibly distinct.
- [ ] No text colour below 4.5:1 remains in `packages/web/src`, other than the
      disabled token.
- [x] Backgrounds, borders, and status colours are unchanged.
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

Task: TASK-048
Implementer: interface-designer
Date: 2026-11-06

**Needs a human decision:** four status colour pairs still fall below 4.5:1, so
the first and third acceptance criteria are not ticked. See "Acceptance criteria
evidence".

### Changes made

- Added `packages/web/src/styles/tokens.css`, imported in `main.tsx`. It defines
  the text tokens, a global `::placeholder` colour, and a Recharts legend label
  override.
- Replaced neutral text colours with tokens in CSS modules and TSX, including
  chart ticks, tooltips, legends, log tags, and section headers. The replacement
  was keyed by selector, not by hex value.
- Kept the light map popups dark-on-light. `#64748b` and `#334155` pass there, so
  they became `--text-on-light*` tokens with the same values.
- Fixed text colours the task table did not list: `.versionText` (1.22:1),
  white on `#3b82f6` and `#22c55e`, `#e2e8f0` on `#3b82f6`, the reply label
  `#7c3aed`, count pills on `#334155`, and browser default placeholders.
- Changed opacity: inactive config card 0.55 to 0.75, relayed bubble 0.7 to 0.75,
  inactive sort arrows 0.35 to 0.7. Removed it from relayed message text, the
  reply label, and pending ACK marks. Relayed text now uses `--text-secondary`.
- Added `packages/web/src/lib/nodeLabelColor.ts`. Map markers colour their label
  from a per-node hue, and at that lightness some hues failed (2.65:1 at worst).
  Tokens cannot express a per-node colour, so labels on dark markers use a lighter
  tint of the same hue, and labels on filled markers use black or white. Marker
  borders and fills are unchanged.
- Added `packages/web/src/styles/textContrast.test.ts`, which runs in `pnpm test`.
  It checks tokens against every surface, every literal text colour in CSS and
  TS against its background, an opacity register, and all node hues.
- `packages/web/vitest.config.ts` now processes `?raw` CSS so the test can read
  stylesheets. Other CSS imports stay stubbed.

### Validation performed

- `pnpm lint`: passes, 0 errors. 5 `exhaustive-deps` warnings, none on lines
  changed here.
- `pnpm build`: **exits 1**, in `@foreman/docs` only. VitePress fails on
  `docs/contracts/CONTRACT-008-coordinated-shutdown-sequence.md:468`, which this
  task did not change. Fixing it is out of scope. Building `@foreman/shared`,
  `@foreman/daemon`, and `@foreman/web` directly passes.
- `pnpm test`: passes. shared 31, web 82, daemon 231.
- `pnpm format:check`: passes.
- Mutation check: injecting a failing colour, a lower opacity, and a weaker token
  failed the 3 expected tests. All were reverted.
- Runtime audit: Vite dev server with `/api` and `/ws` mocked in Chromium, so no
  daemon ran and no serial port was opened. It composites each text element
  through its real ancestor backgrounds and opacity. Translucent map panels were
  measured against a white basemap, the worst case. The same harness ran on the
  original source and on this change, across 59 scenes and 6,541 elements:

| Measure | Before | After |
|---|---|---|
| Readable text measurements below 4.5:1 | 2,067 | 13 |
| Distinct failing colour and element pairs | 142 | 6 |
| Lowest disabled text ratio | 1.54 | 3.07 |

The 13 remaining measurements are the 4 status pairs below, repeated across scenes.

Screenshots are not committed. 51 before and 51 after, with matching filenames:

- `/tmp/claude-1000/-home-patrick-Documents-Github-Personal-MeshtasticForeman/1d943abf-bbce-4cfd-97f9-2cca1e9fd8b0/scratchpad/before/`
- `/tmp/claude-1000/-home-patrick-Documents-Github-Personal-MeshtasticForeman/1d943abf-bbce-4cfd-97f9-2cca1e9fd8b0/scratchpad/after/`

That is session scratch space, so copy them out if they need to be kept.

### Acceptance criteria evidence

- **All readable text meets 4.5:1: not ticked.** Met except these status pairs,
  which the task and the second-to-last criterion require to stay unchanged:

| Pair | Ratio | Where |
|---|---|---|
| `#ef4444` on `#1e3a5f` | 3.06 | Failed-send mark on outgoing bubbles |
| `#ef4444` on `#1e293b` | 3.89 | Proposal delete button on the map panel |
| `#4ade80` on `#166534` | 4.09 | "On" toggle in the MQTT menu and config editor |
| `#dc2626` on `#f1f5f9` | 4.41 | "Delete Proposal" in the map popup |

- **Disabled text meets 3:1 and is distinct: ticked.** Lowest is 3.07 (`Send`,
  `Next`). On the page, `--text-disabled` is 3.75 and `--text-muted` is 7.83.
- **No text colour below 4.5:1 remains: not ticked.** Same four pairs. They are
  listed in `KNOWN_STATUS_FAILURES`, and the test fails if one is resolved without
  removing its entry.
- **Backgrounds, borders, and status colours unchanged: ticked.** A diff against
  the base found no changed background, border, shadow, or stroke declaration and
  no removed status hex. See the opacity note under "Assumptions and deviations".
- **Every page and shell menu checked in the running app: not ticked.** Nodes, Map,
  Messages, Analytics, Activity, Logs, Overrides, Device Config, the wizard, and
  the GPS, MQTT, API, and Settings menus were all checked, with mock data only.

### Remaining for the human

- Decide whether the four status pairs stay as exceptions or get new colours.
- Check the app with the real daemon, a radio, and live data.
- Check the map on the real basemap. The harness used a flat stub style.
- Look over the before and after screenshots for visual preference, especially
  dark text on active tabs and the brighter `#94a3b8` replacement.

### Assumptions and deviations

- `#94a3b8` is not reused as a token, although the task table lists it as passing.
  It measures 4.49 on `#1e3a5f` and 4.04 on `#334155`, so `--text-secondary` is
  `#b4c0d0` and `--text-muted` is `#9fadc0`. Text that used `#94a3b8` is brighter.
- Passing neutral text was tokenised too, to meet the "defined in one place"
  outcome. `#e2e8f0` keeps its value. Other passing literals such as `#cbd5e1`,
  `#f1f5f9`, and `#f8fafc` were left alone.
- Added tokens beyond the task's examples: `--text-on-accent` and three
  `--text-on-light*` tokens.
- Active tabs and the `Add` button now use dark text on `#3b82f6`. White reaches
  only 3.68:1 there, and backgrounds are out of scope.
- The active stack button now uses `--text-on-light`. Its background string
  (`hsl(...)22`) is invalid CSS, so the button sits on the white popup. That
  invalid value is an existing defect and was left in place.
- Raising group opacity on the inactive config card and relayed bubble also makes
  their background and border render slightly stronger. Their declared colours
  are unchanged.
- `#94a3b8` stays a literal in the mesh graph canvas because canvas cannot resolve
  CSS variables. It passes on `#020617`.
- The task says Leaflet, but the map uses MapLibre. Its popups were the ones
  checked.

### Unresolved risks

- `textContrast.test.ts` is static. For a declaration with no background in its
  own rule, it assumes the panel colour unless told otherwise, so a text colour
  placed on an unusual surface can pass it. The runtime audit is not in the repo,
  because it needs a browser.
- Not measured in the app: the GPS refresh pending state. Calculated, it passes.
- Measured in Chromium only. Firefox and the packaged Electron app were not run.
- `pnpm build` will keep failing until CONTRACT-008 is fixed.

### Documentation updated

`docs/DEVELOPMENT.md`: added a "Text colours" section under Coding conventions.

## Review

Not reviewed.

## Human acceptance

Pending.
