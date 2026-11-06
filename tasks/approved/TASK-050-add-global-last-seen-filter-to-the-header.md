# TASK-050: Add a global last-seen filter to the header

Owner role: interface-designer
Assigned agent: Codex
Proposed by: Claude, at Patrick Moon's request
Proposed date: 2026-11-06
Approved by: Patrick
Approved date: 2026-11-06
Related contracts: None. The human decided a contract is not needed.
Related ADRs: None
Dependencies: None. Should follow TASK-048 so the control uses its text tokens.

## Desired outcome

A single control in the header limits the app to nodes heard within the last week,
month, quarter, or year, or shows all nodes, so long-gone nodes stop cluttering
every page. The default is the last week.

## Context

The radio alone reports 80 nodes, and the app also shows nodes from MQTT. Nothing
limits node lists by age today. The existing time controls do something different:

- Map has an `Age` control (`AGE_OPTIONS` in `MapPage.tsx`) that filters
  traceroutes only.
- Analytics tabs have their own range buttons that filter events by time.

`AppShell.tsx` builds the node lists passed to Nodes, Map, Messages, and Analytics,
so most of this can be done in one place. The Electron app loads the same web UI,
so it gets the control automatically.

## Scope

### Included

- A header control in `AppShell.tsx` with the options Week (7 days, default),
  Month (30 days), Quarter (90 days), Year (365 days), and All.
- Nodes with no last-heard time are hidden, except under All.
- The choice remembered per browser in `localStorage`, falling back to Week when
  storage is unavailable or holds an invalid value.
- Filtering on Nodes and Map.
- Filtering the node picker on Messages, and node lists on Analytics.
- A visible count of nodes shown out of total, so hidden nodes do not look like
  lost data.
- A pure, tested filter function in `packages/web/src/lib`.
- An update to the user guide.

### Excluded

- Daemon or API changes, or deleting any data.
- Replacing Map's traceroute `Age` control or the Analytics range buttons.
- Filtering Activity, Logs, Overrides, or Device Config.
- An environment variable. This is a per-browser UI choice, not deployment config.

## Plan

1. Add the filter function and its tests.
2. Add the header control and remembered choice.
3. Apply the filter where `AppShell.tsx` builds node lists, keeping the unfiltered
   lists for lookups.
4. Check every affected page, including at phone width.

## Acceptance criteria

- [ ] The header shows the control on every tab, with Week selected on first use.
- [ ] Changing it updates Nodes, Map, Messages, and Analytics without a reload.
- [ ] The choice survives a reload, and the app works when storage is unavailable.
- [ ] A node's age uses the most recent of its mesh and MQTT last-heard times, so
      a node heard on either stays visible as one complete row.
- [ ] All shows every node, including nodes older than a year and nodes with no
      last-heard time.
- [ ] Nodes with no last-heard time are hidden under Week, Month, Quarter, and Year.
- [ ] The connected radio's own node is always shown.
- [ ] A hidden node that is heard again reappears without a reload.
- [ ] Message threads and names still resolve for nodes the filter hides. An
      existing conversation is never removed or reduced to a raw ID.
- [ ] Node counts in the header match the filtered lists, and the shown and total
      count is visible.
- [ ] The control is usable at phone width and meets the text contrast target.

## Validation requirements

`pnpm lint`, `pnpm build`, and `pnpm test`, plus a manual check of each affected
page with a mix of recent and old nodes.

## Risks and assumptions

- The default hides older nodes from everyone on first use, which could look like
  data loss. The visible count is the mitigation.
- Assumes "all the frontends" means every page of the shared web UI, including
  Electron.
- Filtering after the node lists are built must not change the lists used for
  lookups, or names on Map traceroutes and in Messages will break.

## Open decisions for the human

1. Should there be an "All" option? Without one, a node older than a year cannot be
   seen anywhere in these lists. Proposed: yes.
   -  Yes
2. Should nodes with no last-heard time be shown? They have no age. Proposed: hide
   them, except under "All" if it is added.
   - hide them except under all
3. Should Analytics' range buttons and Map's `Age` control stay separate? They
   filter events, not nodes. Proposed: keep them separate, as scoped above.
   - seperate as scoped above.
4. Is a separate contract required? Proposed: no, because this is frontend-only
   and these acceptance criteria cover it.
   - no

## Blocker

None.

## Implementation handoff

Not started.

## Review

Not reviewed.

## Human acceptance

Pending.
