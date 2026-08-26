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

Not yet implemented.

## Review

Not reviewed.

## Human acceptance

Pending.
