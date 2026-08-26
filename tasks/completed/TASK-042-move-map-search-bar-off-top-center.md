# TASK-042: Move map search bar off top-center so it stops overlapping the filter controls

Owner role: Implementer
Assigned agent: interface-designer
Proposed by: Claude (via investigation of reported map UI overlap)
Proposed date: 2026-08-26
Approved by: Patrick
Approved date: 2026-08-26
Related contracts: None
Related ADRs: None
Dependencies: None

## Desired outcome

The map's node search box no longer overlaps the traceroute/coverage/proposal
filter control panels. The search box moves to the top-right area of the map,
clear of the top-left control row.

## Context

`packages/web/src/pages/MapPage.tsx` renders two independently-positioned
floating overlays on the map:

- `.topControlsRow` (`packages/web/src/pages/MapPage.module.css:9-18`) —
  pinned `top-left`, holding the Traceroute, Coverage, and Proposal control
  panels side by side. This row grows wider as panels expand (e.g. the
  Coverage panel's advanced row) or as more modem presets are available.
- `.searchBar` (`packages/web/src/pages/MapPage.module.css:57-71`) — pinned
  `top: 0.75rem; left: 50%; transform: translateX(-50%)`, i.e. horizontally
  centered over the map regardless of viewport width.

Because the control row is left-anchored and can grow, and the search bar is
centered independent of the control row's actual width, the two overlap on
narrower viewports or when the control panels are expanded — the search
bar visually sits on top of part of the filter selectors. The right side of
the map currently has no floating overlay (confirmed by inspecting
`mapStyles.module.css` and `MapPage.module.css` for any `right:`-positioned
UI), so moving the search bar there is a clean fix with no new collisions.

## Scope

### Included

- Reposition `.searchBar` in `MapPage.module.css` from top-center to the
  top-right corner of the map (mirroring `.topControlsRow`'s left-side
  anchoring, e.g. `top: 1rem; right: 1rem;` with no `transform`).
- Adjust the search bar's internal layout only as needed to read well
  anchored right instead of centered (e.g. drop the centering transform).
- Verify the search input, count pill, and clear button still fit and don't
  clip against the map edge at common viewport widths, including when the
  input is focused and the "N shown" count/clear button appear.

### Excluded

- Any change to search matching logic (`filteredMesh`/`filteredMqtt` in
  `MapPage.tsx`), placeholder text, or icon.
- Any change to the `.topControlsRow` panels themselves (Traceroute,
  Coverage, Proposal controls) or their layout/expansion behavior.
- Any change to the bottom-left `.legend` overlay.

## Plan

1. Move `.searchBar` from centered top to `top: 1rem; right: 1rem;` in
   `MapPage.module.css`, removing the `left`/`transform` centering.
2. Manually check the map at a range of window widths (including a narrow
   width where the control row is at its widest, e.g. all three panels
   expanded) to confirm no overlap with `.topControlsRow` and no clipping
   against the map's right edge.
3. Confirm the search bar's dropdown-adjacent elements (count pill, clear
   button) still render correctly when search text is present.

## Acceptance criteria

- [ ] The search bar renders in the top-right area of the map, not
      overlapping `.topControlsRow` at any viewport width down to a
      reasonable minimum (e.g. 1024px wide), including when all three
      top-left control panels are expanded.
- [ ] The search bar does not clip off the right edge of the map container.
- [ ] Search behavior (filtering markers, count display, clear button) is
      unchanged.

## Validation requirements

Manual verification in a browser: load the Map tab, expand each of the
Traceroute/Coverage/Proposal panels, and confirm the search bar stays clear
of them at both a wide and a narrow (~1024px) window width. Type a search
query and confirm the count/clear button render correctly in the new
position.

## Risks and assumptions

Low risk — this is a CSS-only positioning change to a single overlay with no
logic changes. Main assumption is that top-right is an acceptable resting
place from a UX standpoint (no other planned overlay is expected to land
there); flag during implementation if that assumption turns out to be wrong.

## Blocker

Awaiting Patrick's approval to move this out of `proposed/`.

## Implementation handoff

Implemented by interface-designer on 2026-08-26.

### Changes made

- `packages/web/src/pages/MapPage.module.css`: repositioned `.searchBar` from
  centered-top (`top: 0.75rem; left: 50%; transform: translateX(-50%);`) to
  top-right (`top: 1rem; right: 1rem;`), removing the `left`/`transform`
  centering entirely so the search bar now anchors to the top-right corner of
  the map, mirroring `.topControlsRow`'s top-left anchoring (`top: 1rem; left:
  1rem;`). Updated the adjacent comment to describe the new placement and the
  reason for it. No other rule in `.searchBar` (padding, background, gap,
  z-index, box-shadow) or any child class (`.searchIcon`, `.searchInput`,
  `.searchCount`, `.searchClearBtn`) was changed — the internal layout already
  reads fine anchored right, since it's a `display: flex` row with a
  fixed-width (`14rem`) input, so no additional adjustment was needed beyond
  dropping the centering transform.
- No changes were made to `MapPage.tsx` (search matching logic, placeholder
  text, icon), to `.topControlsRow` or its panels, or to `.legend`.

### Validation performed

All commands run from `packages/web` in this worktree, Node v24.16.0, pnpm
11.21.0:

- `pnpm build` (`tsc --noEmit && vite build`): passed — no TypeScript
  diagnostics; Vite build completed in 6.14s. The pre-existing "chunks larger
  than 500 kB" advisory was reported and is unrelated to this change.
- `pnpm lint` (`eslint .`): passed with 0 errors, 5 warnings. All 5 warnings
  are pre-existing `react-hooks/exhaustive-deps` warnings in
  `DeviceConfigPage.tsx`, `MapPage.tsx` (lines 362/372/655, unrelated to the
  `searchBar` styles), and `NodeDetailPanel.tsx` — none introduced by this
  change.
- `pnpm format:check` (`prettier --check ...`): passed — "All matched files
  use Prettier code style!". Note: this script's glob covers
  `.ts`/`.tsx`/`package.json`/`index.html`/`vite.config.ts` only, not `.css`
  files, so it does not lint `MapPage.module.css` directly; the CSS edit was
  formatted by hand to match the file's existing 2-space-indent style.
- `pnpm test` (`vitest run`): passed — 15 test files, 60 tests, no
  regressions. No test in the suite exercises `.searchBar` positioning (the
  suite does not do visual/layout assertions), so this run confirms no
  behavioral regression in search filtering logic but is not a substitute for
  visual verification.
- No automated visual/browser test exists for this overlay. See "Unresolved
  risks" below for what still needs manual visual confirmation.

### Acceptance criteria evidence

- "The search bar renders in the top-right area of the map, not overlapping
  `.topControlsRow` at any viewport width down to ~1024px, including when all
  three top-left control panels are expanded." — Addressed by the CSS change:
  `.searchBar` is now `position: absolute; top: 1rem; right: 1rem;` with no
  `left`/`transform`, so it is pinned to the map's top-right corner
  independent of `.topControlsRow`'s width, eliminating the geometric overlap
  that existed when the centered search bar and the growing left-anchored
  control row could occupy the same horizontal space. This is a structural
  fix (the two overlays now anchor to opposite corners and no longer share a
  positioning axis), but it has **not** been visually confirmed in a running
  browser — see "Unresolved risks."
- "The search bar does not clip off the right edge of the map container." —
  `.wrap` (the map container) is `position: relative; overflow: hidden;` and
  `.searchBar` is `right: 1rem` with a `14rem`-wide `.searchInput` plus small
  icon/padding, well within any viewport at or above the 1024px minimum
  called out in the task. Not visually confirmed in-browser.
- "Search behavior (filtering markers, count display, clear button) is
  unchanged." — No JS/TSX logic was touched; `pnpm test` (60/60 passing)
  confirms no regression in the automated suite, and the DOM structure/class
  names for `.searchInput`, `.searchCount`, and `.searchClearBtn` are
  unchanged, only their containing `.searchBar`'s position moved.

### Assumptions and deviations

- **Task-file lifecycle move deviation**: this agent runs in an isolated git
  worktree (`.claude/worktrees/agent-ab36ae595d5b6d518`) whose checked-out
  branch (`worktree-agent-ab36ae595d5b6d518`) did not contain
  `tasks/approved/TASK-042-move-map-search-bar-off-top-center.md` in its
  tracked tree (the file exists in the separate shared checkout at
  `/home/patrick/Documents/Github/MeshtasticForeman/tasks/approved/`, on the
  `code-cleanup` branch, but the harness blocks git operations from this
  worktree against that shared checkout path). Because there was no tracked
  copy of the file in this worktree to `git mv` from `approved/` to
  `in-progress/`, the task file was instead created directly at
  `tasks/in-progress/TASK-042-move-map-search-bar-off-top-center.md` in this
  worktree (content copied verbatim from the approved version) and will be
  moved from there to `tasks/review/` as a plain filesystem rename plus `git
  add`, matching the sandbox-limitation precedent documented in
  `tasks/completed/TASK-041-correlate-device-set-config-completion-events.md`'s
  handoff (which used a plain rename instead of `git mv` for a different but
  related reason — a read-only `.git`). No file in `tasks/approved/` or
  `tasks/in-progress/` in the shared checkout was modified by this agent.
- Assumed top-right is an acceptable resting place per the task's own stated
  assumption; nothing in the codebase or task file contradicted this, and no
  other overlay currently occupies that corner.
- Did not add a responsive breakpoint or media query — the task's scope asked
  for a static reposition ("top: 1rem; right: 1rem") and explicitly scoped
  internal-layout changes to "only as needed"; since the existing flex layout
  already fits at the top-right without modification, none was added.

### Unresolved risks

- **No live browser/visual verification was performed** by this agent (no
  interactive browser available in this environment). The task's own
  "Validation requirements" section calls for manually loading the Map tab,
  expanding each of the Traceroute/Coverage/Proposal panels, and confirming
  the search bar stays clear of them at both a wide and a ~1024px-wide window,
  then typing a search query to confirm the count/clear button render
  correctly in the new position. **A human should still perform this manual
  check before acceptance** — specifically:
  1. Load the Map tab at a wide viewport (e.g. 1920px) and at ~1024px.
  2. Expand all three of the Traceroute, Coverage, and Proposal panels
     simultaneously (their combined widest state) and confirm `.topControlsRow`
     does not visually reach or overlap the top-right `.searchBar`.
  3. Type a search query long enough to show the "N shown" count pill and the
     clear button, and confirm neither clips against the map's right edge or
     looks visually broken in the new top-right position.
  4. Confirm no other overlay (e.g. any future map controls) has since been
     added to the top-right corner that would newly collide with the moved
     search bar.
- The task-file lifecycle deviation above means the `tasks/approved/` copy in
  the shared checkout was left in place untouched; a human/orchestrator should
  reconcile that shared-checkout copy (e.g. remove or mark it superseded) once
  this worktree's branch is merged, to avoid two divergent lifecycle copies of
  TASK-042.

## Documentation updated

None — this is a scoped CSS positioning fix with no durable architecture,
contract, or ADR impact requiring documentation changes.

## Review

Not reviewed.

## Human acceptance

Pending.
