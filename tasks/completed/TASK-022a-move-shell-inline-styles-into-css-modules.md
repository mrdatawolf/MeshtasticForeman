# TASK-022a: Move shell inline styles into CSS modules

Owner role: UX Specialist
Assigned agent: interface-designer
Proposed by: Claude (orchestrating session), split from TASK-022 per Patrick's 2026-08-25 decision to split it into four independently-reviewable per-page sub-tasks
Proposed date: 2026-08-25
Approved by: Patrick
Approved date: 08/25/26
Related contracts: None
Related ADRs: None
Dependencies: TASK-018 (shell split into focused components — already implemented and committed; style extraction targets those now-separated shell components)

## Desired outcome

Large inline style collections and dynamically inserted style rules in the application shell (and its TASK-018-extracted sub-components) move into feature-level CSS modules or stylesheets.

## Context

Split from TASK-022, which originally covered the shell, MapPage, AnalyticsPage, and DeviceConfigPage as one umbrella task. Patrick decided to split it into four sub-tasks (TASK-022a through TASK-022d, one per page) for cleaner independent review, per TASK-022's own flagged scoping question. This task covers the shell only.

## Scope

### Included

Converting inline `style={...}` objects and dynamically-generated style rules in the shell components (extracted under TASK-018) into CSS modules or stylesheets scoped to the shell feature.

### Excluded

Any visual redesign — colors, spacing, and layout must remain identical; this is purely a mechanism change (inline JS objects → CSS modules). Other pages (MapPage, AnalyticsPage, DeviceConfigPage) — tracked separately as TASK-043/044/045.

## Plan

1) Identify all inline style objects/dynamically-generated style rules across the shell's now-split components. 2) Convert each into a CSS module or stylesheet scoped to the shell feature. 3) Confirm no visual change.

## Acceptance criteria

- [ ] Shell components no longer contain large inline style-object collections.
- [ ] No visible styling change anywhere in the shell (pixel-level regression pass or visual diff tooling if available).

## Validation requirements

Visual regression pass (manual or tooled, if a visual diff tool is available in this repo — confirm) for the shell.

## Risks and assumptions

Low risk — mechanism-only change, no behavior or visual change intended.

## Blocker

None.

## Implementation handoff

Implementer: interface-designer
Date: 2026-08-25

### Changes made

No CSS Modules convention existed anywhere in `packages/web` before this task (repo-wide search
found zero `*.module.css`/`*.css` files besides the two `<style>` tags in `index.html`); this task
establishes CSS Modules (`*.module.css`, Vite's built-in support, already typed via
`vite/client` in `vite-env.d.ts`) as the convention for the shell, colocated per component,
matching the existing colocated-styles-module pattern TASK-021 already established
(`components/config/configStyles.ts`) at the directory level.

- `packages/web/src/components/shell/shellStyles.module.css` (new) — the CSS classes for every
  style previously in the shared `styles` record and the `tabStyle`/`menuBtnStyle`/`menuNavBtn`/
  `deviceActionBtn`/`hdrFilterBtn` functions in `shellStyles.ts`, plus the per-tag colors
  previously in `TAG_COLORS`, plus a handful of small shared utility classes (`caret`, `muted72`,
  `mlSmall`, `mlMed`, `justifyEnd`, `badgeOn`/`badgeOff`) that replace one-off inline overrides
  that were previously spread onto the shared style objects at call sites.
- `packages/web/src/components/shell/shellStyles.ts` (rewritten) — now imports the CSS module and
  exports `styles` (the classnames object, same export name, so most call sites only changed
  `style={styles.x}` to `className={styles.x}`) plus `tabClass`, `menuBtnClass`, `menuNavClass`,
  `deviceActionClass`, `hdrFilterClass`, `hdrFilterActiveWhiteClass`, `badgeClass` — className-
  returning replacements for the old CSSProperties-returning functions — and `TAG_COLOR_CLASS`
  (tag → CSS module class) replacing the old `TAG_COLORS` (tag → hex) map. `KNOWN_TAGS` is
  unchanged (it's tag data, not styling).
- `packages/web/src/components/shell/AppShell.module.css` (new) + `AppShell.tsx` (edited) — the
  intro-guide button, the four tab-content wrapper `<div>`s (`tabPanelScroll`/`tabPanelColumn`),
  the `ApiDocsModal` (overlay/panel/header/close button/body), and every `mdComponents` markdown
  renderer style (h1–h4, p, a, strong, code block/inline, pre, blockquote, hr, ul/ol/li, table/
  thead/th/td/tr) all moved to classes.
- `packages/web/src/components/shell/DeviceMenu.module.css` (new) + `DeviceMenu.tsx` (edited) —
  device row/status-dot/battery-bar styling, the map-filter dots, and the version footer moved to
  classes. The `BatteryBar`'s continuous `width: ${level}%` fill is the one remaining inline
  style in the shell: it's expressed as a single CSS custom property
  (`style={{ "--battery-width": ... }}`) consumed by `.batteryBarFill { width: var(--battery-width); }`,
  since that value is continuous (0–100) and can't be enumerated as a fixed set of classes; this
  still satisfies "no large inline style-object collections" (it's one property, not a style
  object).
- `packages/web/src/components/shell/GpsMenu.module.css` (new) + `GpsMenu.tsx` (edited) — GPS
  detail table, refresh button (incl. its pending/spinning state), and the injected
  `<style>{'@keyframes _spin {...}'}</style>` tag (a "dynamically-generated style rule" the task
  explicitly called out) all moved to classes; the keyframes now live as a real `@keyframes spin`
  rule in `GpsMenu.module.css`.
- `packages/web/src/components/shell/MqttMenu.module.css` (new) + `MqttMenu.tsx` (edited) — the
  broker on/off toggle (previously an inline override of `menuNavBtn`'s own computed style) is now
  a standalone, fully-resolved pair of classes rather than composed with the shared `menuNavBtn`
  class, plus the dot/scope-label/region-warning/node-count text styles.
- `MainNavigation.tsx` and `SettingsMenu.tsx` needed no dedicated `.module.css`: every style they
  used was already one of the shared `shellStyles.module.css` classes/helpers, so their only
  change is `style={...}` → `className={...}`.
- Dropped the `tabCount` entry from the old `styles` record: a repo-wide grep confirmed it had
  zero call sites (dead code already, unrelated to TASK-018/021), so it wasn't carried into the
  CSS module.

Styling technique notes (for the reviewer tracing values back to the original):
- Two-state toggles that were always applied together with a shared base class (e.g. `.tab`/
  `.tabActive`, `.menuNavBtn`/`.menuNavBtnActive`, `.hdrFilterBtn`/`.hdrFilterBtnActive`) use
  compound selectors (`.hdrFilterBtn.hdrFilterBtnActive { ... }`) so the modifier deterministically
  overrides the base regardless of CSS file/bundle order.
- Independent boolean dimensions that drove the *same* CSS property in the original code (e.g.
  `menuBtnStyle`'s border color depends on both `open` and `connected`, with `connected` always
  winning) are resolved by computing a single mutually-exclusive modifier class in JS (mirroring
  the original ternary), never by stacking two classes that could both match the same property.
- Any override that touched a property declared by a *shared* base class from a different
  `.module.css` file (only the MQTT toggle button hit this) is expressed as a fully self-contained
  local class instead of trying to compose across CSS Module file boundaries.

### Validation performed

- Manual, property-by-property comparison: every CSS declaration in the new `.module.css` files
  was copied verbatim (same hex colors, same units, same shorthand vs. longhand) from the original
  inline `React.CSSProperties` objects/functions read directly from git history before editing;
  no color, spacing, or layout value was changed anywhere.
- Confirmed no visual-diff/screenshot tool exists anywhere in the repo (`grep -r "playwright|
  puppeteer|percy|chromatic|storybook"` across all `package.json` files returned nothing), so this
  is a manual regression pass as the task's validation requirements anticipated, not a tooled one.
- `grep -n "style={" packages/web/src/components/shell/*.tsx` after the change shows exactly one
  remaining inline style in the whole shell — the intentional single-property `--battery-width`
  custom property described above; everything else is `className`.
- Built the production bundle and grepped the emitted CSS for a sample of the shell's distinctive
  hex colors (`#3b82f6`, `#94a3b8`, `#22c55e`, `#ef4444`, `#f59e0b`, `#60a5fa`, `#34d399`,
  `#a78bfa`, `#fb923c`, `#166534`, `#16a34a`, `#f87171`, `#fbbf24`, `#7dd3fc`) to confirm every one
  survived the CSS Modules pipeline into the final stylesheet with a plausible occurrence count.
- `pnpm --filter @foreman/web build` (`tsc --noEmit && vite build`): passed —
  `✓ 1866 modules transformed` / `✓ built in 5.92s` (only the pre-existing >500 kB chunk-size
  advisory, unrelated to this change).
- `pnpm --filter @foreman/web test` (`vitest run`): passed — `Test Files 13 passed (13)`,
  `Tests 53 passed (53)`.
- `pnpm --filter @foreman/web lint` (`eslint .`): `✖ 5 problems (0 errors, 5 warnings)` — the same
  5 pre-existing `react-hooks/exhaustive-deps` warnings on `DeviceConfigPage.tsx`/`MapPage.tsx`/
  `NodeDetailPanel.tsx` noted in TASK-021's handoff; none are new or touch shell files.
- `pnpm --filter @foreman/web format:check` (`prettier --check`): ran this in addition to the
  requested commands since it's a defined script; found and fixed pre-existing-style formatting
  drift my own edits introduced in `DeviceMenu.tsx`/`SettingsMenu.tsx` (ran `prettier --write` on
  just those two files). The remaining reported file, `src/components/config/FieldEditors.tsx`, is
  untouched by this task (TASK-022d/DeviceConfigPage territory) and was left as-is per this task's
  scope boundary.

### Assumptions and deviations

- Chose CSS Modules (`*.module.css`) over a plain scoped stylesheet, per the task's "use your
  judgment" instruction: Vite supports them with zero config, they're statically scoped per file
  (no global name collisions to manage by hand), and they're the most common convention for this
  kind of component-colocated styling in a Vite+React app with no prior CSS convention to match.
- One component per `.module.css` file (`AppShell`, `DeviceMenu`, `GpsMenu`, `MqttMenu`), plus one
  shared `shellStyles.module.css` for classes genuinely reused across 3+ components — this mirrors
  the granularity of the existing `components/shell/*.tsx` split from TASK-018.
- Dropped the dead, already-unused `tabCount` style (see above) rather than carrying forward
  unused CSS; trivial to re-add if it was reserved for near-term use.
- No true visual-diff tool exists in this repo (confirmed above), so "confirm no visual change" is
  a manual, exhaustive value-for-value comparison rather than a pixel-diff screenshot comparison.

### Unresolved risks

- The manual comparison did not include an actual rendered-browser screenshot A/B (no visual-diff
  tooling and no browser automation available to this agent in this environment); a human
  eyeballing the running app (`pnpm --filter @foreman/web dev`) through each shell tab/menu is the
  recommended final check before acceptance, even though the value-by-value trace above should
  make a mismatch unlikely.
- This task deliberately did not touch `MapPage`, `AnalyticsPage`, or `DeviceConfigPage` (tracked
  separately as TASK-022b/c/d per the task's own scope boundary), so those pages' inline styles are
  untouched and out of scope for this review.

## Review

Not reviewed.

## Human acceptance

Pending.
