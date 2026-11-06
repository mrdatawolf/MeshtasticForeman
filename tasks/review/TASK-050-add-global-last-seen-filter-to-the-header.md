# TASK-050: Add a global last-seen filter to the header

Owner role: interface-designer
Assigned agent: interface-designer
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

- [x] The header shows the control on every tab, with Week selected on first use.
- [x] Changing it updates Nodes, Map, Messages, and Analytics without a reload.
- [x] The choice survives a reload, and the app works when storage is unavailable.
- [x] A node's age uses the most recent of its mesh and MQTT last-heard times, so
      a node heard on either stays visible as one complete row.
- [x] All shows every node, including nodes older than a year and nodes with no
      last-heard time.
- [x] Nodes with no last-heard time are hidden under Week, Month, Quarter, and Year.
- [x] The connected radio's own node is always shown.
- [x] A hidden node that is heard again reappears without a reload.
- [x] Message threads and names still resolve for nodes the filter hides. An
      existing conversation is never removed or reduced to a raw ID.
- [x] Node counts in the header match the filtered lists, and the shown and total
      count is visible.
- [x] The control is usable at phone width and meets the text contrast target.

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

Task: TASK-050
Implementer: interface-designer
Date: 2026-11-06

**For review:** Analytics needed more than the task's "node lists" wording suggests.
See the first deviation below.

### Changes made

- Added `packages/web/src/lib/lastSeenFilter.ts` with the options, validated
  storage access, `findHiddenNodeIds`, `withoutHiddenNodes`, and `countUniqueNodes`.
- Moved the merge and last-heard logic from `NodesPage.tsx` to
  `packages/web/src/lib/mergedNodes.ts`. `NodesPage.tsx` re-exports it, so existing
  tests and imports did not change. Unparsable times now count as no time.
- Added `packages/web/src/hooks/useNow.ts`. `AppShell.tsx` uses it to re-check ages
  every 60 seconds, so nodes age out with no new data.
- Added `LastSeenFilter.tsx` and its CSS module: a labelled native select plus the
  `shown / total nodes` count, using text tokens.
- `AppShell.tsx` works out hidden IDs once from the unscoped mesh and MQTT lists,
  with each connected device's `ownNodeId` exempt. It then filters by ID, so a node
  stays or goes as one row. `gatewayRegion` and Overrides still use unfiltered data.
  Header counts, including the MQTT and map counts, use the filtered lists.
- Nodes receives filtered lists. An empty result says how many nodes are hidden
  rather than "No nodes seen yet."
- Messages keeps unfiltered `nodes` and `mqttNodes` for names, threads, and
  conversations. A new `pickerNodes` prop filters only the **+ New** picker.
- Map receives filtered lists for markers and coverage, and new `lookupNodes` and
  `lookupMqttNodes` for traceroute positions, preset buttons, and the map's initial
  view. A popup closes when its node is hidden. A hidden focused node stops being
  focused and resumes if it reappears.
- Analytics keeps unfiltered lists for names and takes `hiddenNodeIds`, which each
  tab removes from its node-level data.
- `AppShell.tsx` now wraps its `foreman_intro_seen` storage access in try/catch.
  Without this, the app crashed when storage was unavailable.
- Header rows right-align above 640px. See the second deviation below.
- Updated `docs/guide/getting-started.md`.

### Validation performed

- `pnpm lint`: exit 0. No errors, and 5 `react-hooks/exhaustive-deps` warnings in
  `DeviceConfigPage.tsx`, `MapPage.tsx`, and `NodeDetailPanel.tsx`.
- `pnpm test`: exit 0. shared 31, web 120, daemon 331. `textContrast.test.ts` passes.
- `pnpm format:check`: exit 0.
- Builds of `@foreman/shared`, `@foreman/daemon`, and `@foreman/web`: exit 0.
- `pnpm build`: exit 1, only in `@foreman/docs`, on
  `docs/contracts/CONTRACT-008-coordinated-shutdown-sequence.md` (468:33), which
  predates this work. It was left alone.
- Browser check: Chromium through Playwright against the Vite dev server, with
  `/api` and `/ws` mocked. No daemon or serial port was used. The data held recent,
  20, 40, 60, 200, and 400-day-old nodes, no-time nodes, mesh, MQTT, and matched
  nodes, plus an old connected radio. Widths were 1280px and 375px. Every check
  passed except one, whose expected value was wrong: the Network neighbor graph
  correctly dropped to 0 nodes under Week, because both of a recent node's mock
  neighbors are older than a week. The script expected 2.

### Acceptance criteria evidence

- Control on every tab, Week on first use: checked on Nodes, Map, Messages,
  Analytics, Activity, Logs, Debug, Overrides, and Config.
- Updates without a reload: Nodes rows, Map markers (6 to 12), the Messages picker,
  and Analytics tabs Messages, Signal, Network, Telemetry, Link Quality, Timeline,
  and Positions.
- Survives a reload, works without storage: reload kept All. A stored invalid value
  fell back to Week. With a throwing `localStorage` getter, the app loaded, the
  filter worked, and there were no page errors.
- Most recent of mesh and MQTT: unit tests, and in the browser a stale mesh node with
  fresh MQTT stayed visible as one row, including when its MQTT record was outside
  the region scope.
- All: showed nodes older than a year and no-time nodes, with `12 / 12 nodes`.
- No-time nodes hidden under each window: unit tests for all four, browser for Week
  through Year.
- Own node: a 400-day-old connected radio stayed visible under Week, and the MQTT
  gateway region stayed known.
- Hidden node heard again: a `node:update` over the mocked socket brought it back.
  Ageing out: a node near the limit disappeared after the clock advanced 61 seconds
  with no new data. `useNow.test.ts` also covers this.
- Threads and names: conversations with hidden and no-time nodes kept their rows and
  names, with no raw ID in the list. Analytics showed real names for those nodes
  under All.
- Header counts: `6 / 12 nodes` matched the Nodes badge of 6. The MQTT menu showed
  `3 / 4 nodes` for the same data.
- Phone width and contrast: at 375px there was no sideways scroll, the select was
  44px tall, and the arrow key changed the value. The control uses `--text-primary`,
  `--text-secondary`, and `--text-muted` on `#0f172a`, which `textContrast.test.ts`
  enforces.

### Assumptions and deviations

1. Analytics filters API data, not the node props. Those props are only used for
   names, so filtering them would have changed nothing visible except breaking names
   to raw IDs. Instead each tab removes hidden nodes from its per-node data: Busiest
   Nodes, Timeline, Signal, Link Quality, Telemetry, Positions, and the Network
   graphs. Links touching a hidden node are removed.
2. Added a header rule outside the stated file list. The new control made Settings
   wrap to the left edge at 1280px, where its panel opened off screen. Above 640px,
   wrapped header rows now right-align. This also fixes the same fault at narrower
   desktop widths.
3. The total in the count is unique nodes after MQTT region scope, so it matches what
   All would show under the current scope.
4. Analytics data for a node in neither list stays visible, because the filter has no
   record to judge it by. The task does not address this case.
5. A focused coverage node is not pinned on screen. If the filter hides it, the map
   leaves focus mode, which keeps the header count accurate.
6. Preset buttons on Map use unfiltered data, so an active preset can always be
   cleared.

### Unresolved risks

- Not filtered, because the API returns only totals or events: Hop Distance, Hardware
  Breakdown, message totals, and the Packets tab. Hop Distance and Hardware count
  nodes, so they can exceed the header count. Changing that needs daemon work, which
  this task excludes.
- A mesh node kept visible only by an out-of-scope MQTT record shows its old mesh time
  in the Last Heard column, because region scope removes the MQTT record from the row.
  It can look wrong under Week, for example "200d ago".
- A traceroute can draw a line to a hidden node's position with no marker there, by
  design. The route count stayed correct, but the line itself was not confirmed
  visually. The unfiltered position lookup is confirmed by code inspection only.
- At 1280px, Settings sits alone on a second header row.
- Not tested: Electron, a real screen reader, the native select list on phone
  hardware, and a live daemon or radio.
- With storage unavailable, the intro modal reopens on each load.

### Documentation updated

- `docs/guide/getting-started.md`: added "Hiding old nodes".

## Review

Not reviewed.

## Human acceptance

Pending.
