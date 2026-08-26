# TASK-045: Fix Nodes tab "Last Heard" sort so the displayed column matches the sort key

Owner role: Implementer
Assigned agent: interface-designer
Proposed by: Claude (via investigation of reported strange Nodes-tab sorting, confirmed against a screenshot)
Proposed date: 2026-08-26
Approved by: Patrick
Approved date: 2026-08-26
Related contracts: None
Related ADRs: None
Dependencies: None

## Desired outcome

Sorting the Nodes tab by "Last Heard" produces a list where the visible
"Last Heard" column values are actually in order — a row showing "56s ago"
does not sit above a row showing "48d ago" while another "45m ago" row sits
below it, the way the reported screenshot shows today.

## Context

Confirmed via a screenshot of the "MESH + MQTT" (matched) section sorted by
"Last Heard" descending: the visible column reads 56s, 45m, 45m, 48d, 48d,
41m, 48d, 23m, 45m — not remotely monotonic, all within a single section.
This rules out the cross-section stacking theory from the original draft of
this task (that would only explain jumps *between* section boundaries, not
within one). The real bug is a mismatch between the sort key and the
displayed value for any node that has both mesh and MQTT data:

- **Sort key** — `lastHeardMs()` (`packages/web/src/pages/NodesPage.tsx:230-234`)
  computes `Math.max(meshMs, mqttMs)`: whichever of the two sources is more
  recent.
- **Displayed value** — the "Last Heard" cell
  (`packages/web/src/pages/NodesPage.tsx:694`,
  `formatLastHeard(primary.lastHeard)`) uses `primary = mesh ?? mqtt`
  (line 667) — for any matched node (has both), this is **always the mesh
  timestamp**, never MQTT's, regardless of which is more recent.

MQTT gateways report far more often than actual RF mesh hops, so a matched
node's `mesh.lastHeard` is frequently stale (hours/days) while its
`mqtt.lastHeard` is fresh (seconds/minutes) — visible in the screenshot's
own "↳ MQTT · Xs/Xm ago" sub-row, which *is* monotonically increasing as
you read down the list. That sub-row value is effectively what the sort is
ordering by; the bold "Last Heard" column above it is a different, unsorted
value. The two disagree, so the table looks scrambled even though the
sort itself is doing exactly what its comparator says.

The previously-identified issue — that `matched`/`meshOnly`/`mqttOnly`/
`unknownNodes` are four independently-sorted, fixed-order sections
(`NodesPage.tsx:397-400`) — is real and still worth fixing for consistency
(a very-recently-heard mesh-only node still can't outrank an
hours-stale matched node under the current stacking), but it is secondary
to, and independent of, the column/sort-key mismatch that's actually
visible in the reported screenshot.

## Scope

### Included

- Make the displayed "Last Heard" value and the sort key agree for every
  row: the column should show the same "true last heard" time that
  `lastHeardMs()` computes (i.e. `Math.max(mesh, mqtt)`), not just
  `primary.lastHeard`. Concretely, compute a single resolved last-heard
  timestamp per merged node and use it for both display and sorting.
- Apply the same fix consistently regardless of whether the more-recent
  source is mesh or MQTT, so the visible column is always self-consistent
  with the sort order for every sort direction.
- As a secondary fix, make sorting apply across the full visible list
  rather than independently within each of the four fixed sections, so a
  more-recently-heard node in one category isn't stuck below an
  older node in another category purely due to section stacking order
  (see prior investigation in this task's history) — implement this only
  if it doesn't require a separate product-design conversation; if in
  doubt, ship the column/sort-key fix first and flag the section-ordering
  question for Patrick separately rather than blocking this task on it.

### Excluded

- Any change to how `matched`/`meshOnly`/`mqttOnly`/`unknownNodes` are
  categorized (the filter predicates themselves) or to the MQTT sub-row's
  own display.
- Any change to other sortable columns (SNR, model, distance, etc.) beyond
  what naturally falls out of resolving the "Last Heard" display/sort
  mismatch.

## Plan

1. Introduce a single `resolvedLastHeard(merged)` (or equivalent) that
   returns the more-recent of `mesh.lastHeard`/`mqtt.lastHeard` as an ISO
   string (not just a millisecond number), reusing the existing
   `lastHeardMs()` comparison logic.
2. Use that resolved value both in `sortMerged()`'s `"lastHeard"` case and
   in the displayed cell (`NodesPage.tsx:694`), replacing
   `formatLastHeard(primary.lastHeard)` for that column specifically.
   (Leave `primary.lastHeard`/`primary` as used for Name/Model/etc. — those
   aren't part of this bug.)
3. Confirm the MQTT sub-row's own "↳ MQTT · Xs ago" line is unaffected
   (it should keep showing `mqtt.lastHeard` specifically, since that's
   correct there).
4. Add a test: a matched node with a stale `mesh.lastHeard` but fresh
   `mqtt.lastHeard` must display and sort using the fresh value.
5. If time permits without a separate design conversation, apply sorting
   before the matched/meshOnly/mqttOnly/unknown split so ordering holds
   across categories; otherwise leave that as a follow-up and say so
   explicitly in the handoff.

## Acceptance criteria

- [ ] For a matched node, the "Last Heard" column displays the more recent
      of its mesh and MQTT timestamps — not unconditionally the mesh one.
- [ ] Sorting by "Last Heard" (either direction) produces a visible column
      that is actually monotonic, reproducing the screenshot's scenario
      (a node with a fresh MQTT time but stale mesh time) correctly.
- [ ] The MQTT sub-row's own displayed time is unchanged.
- [ ] A test demonstrates the fixed display/sort-key agreement for a node
      where mesh and MQTT last-heard values disagree.

## Validation requirements

New unit test around the resolved last-heard value and `sortMerged`
demonstrating the display/sort-key now agree. Manual verification in the
browser against a mesh with the same matched-node pattern shown in the
reported screenshot (stale mesh last-heard, fresh MQTT last-heard).

## Risks and assumptions

Low technical risk — this narrows down to computing one resolved timestamp
and using it in two places that currently disagree. The secondary
cross-section ordering item is lower-priority and may be deferred to a
follow-up task if it turns out to need a product decision (e.g. whether
section headers still make sense once sorting spans categories) — note
that explicitly in the handoff rather than guessing at UX intent.

## Blocker

Awaiting Patrick's approval to move this out of `proposed/`.

## Implementation handoff

Not yet implemented.

## Review

Not reviewed.

## Human acceptance

Pending.
