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

Implemented by interface-designer on 2026-08-26.

### Changes made

- `packages/web/src/pages/NodesPage.tsx`:
  - Added `resolvedLastHeard(merged)`, which returns the ISO string of
    whichever of `mesh.lastHeard`/`mqtt.lastHeard` is more recent (the same
    max-of-both-sources comparison `lastHeardMs()` already used for
    sorting), or `null` if neither source has a value.
  - Replaced the displayed "Last Heard" cell's
    `formatLastHeard(primary.lastHeard)` with
    `formatLastHeard(resolvedLastHeard(merged))`, so the column always shows
    the same value the `lastHeard` sort key is computed from. `lastHeardMs()`
    (the sort comparator) was already computing `Math.max(meshMs, mqttMs)`
    correctly — the bug was entirely on the display side (it used
    `primary = mesh ?? mqtt`, which is unconditionally the mesh value for any
    matched node) — so no change was needed to `sortMerged`'s `"lastHeard"`
    case itself.
  - Left `primary`/`primary.lastHeard` untouched everywhere else (Name,
    Model, SNR, coordinates, etc.), and left the MQTT sub-row's own
    `formatLastHeard(mqtt.lastHeard)` line untouched, per the task's
    explicit scope.
  - Exported `MergedNode`, `buildMergedNodes`, `resolvedLastHeard`,
    `SortCol`, and `sortMerged` (previously module-private) so they are
    directly unit-testable without needing to mount the full component tree
    (which would otherwise require mocking `fetch("/api/hw-models")`).
- Added `packages/web/src/pages/NodesPage.test.tsx`: unit tests covering
  `resolvedLastHeard` (fresher-MQTT case, fresher-mesh case, single-source
  fallback, both-null case) and a `sortMerged` test that reproduces the
  reported screenshot's scenario — a matched node with a mesh time ~48 days
  stale but an MQTT time 56s old, sorted alongside two mesh-only nodes at
  45m and 23m ago — asserting descending sort order `[100, 300, 200]` and
  that the top row's `resolvedLastHeard` (used for display) equals the
  value actually used to rank it, not its stale `mesh.lastHeard`.

### Deferred (secondary scope item)

Per the task's own guidance ("if in doubt, ship the column/sort-key fix
first and flag the section-ordering question for Patrick separately rather
than blocking this task on it"), the secondary cross-section ordering
item was **not** implemented. Making sort apply "across the full visible
list" as literally described would require interleaving nodes from the
`matched`/`meshOnly`/`mqttOnly`/`unknownNodes` categories by last-heard
time, which conflicts with the current fixed-category accordion sections
(each section's rows are still rendered together under its own header).
Doing this "for real" needs a product decision on what the sections mean
once sort order can cross them (e.g., do headers disappear when sorting by
"Last Heard"? Do they stay but just reorder internally, which is already
what today's per-section sort does?) — exactly the ambiguity the task's own
"Risks and assumptions" section anticipated. Flagging this for Patrick as a
follow-up rather than guessing at UX intent.

### Validation performed

All commands run from `packages/web` under Node with the repository's
pinned pnpm (11.21.0):

- `pnpm exec vitest run src/pages/NodesPage.test.tsx`: passed — 1 test file,
  5 tests passed.
- `pnpm build` (`tsc --noEmit && vite build`): passed — no TypeScript
  diagnostics; Vite transformed 1,892 modules and completed the production
  build in 6.38s. The pre-existing advisory about chunks larger than 500 kB
  was reported (unrelated, unchanged).
- `pnpm test` (full `vitest run`): passed — 16 test files, 65 tests passed.
- `pnpm lint` (`eslint .`): passed — 0 errors, 5 warnings. All 5 warnings
  are pre-existing `react-hooks/exhaustive-deps` warnings in
  `DeviceConfigPage.tsx`, `MapPage.tsx`, and `NodeDetailPanel.tsx`, none of
  which were touched by this task.
- `pnpm format:check`: passed — `All matched files use Prettier code style!`
  (initially flagged the new test file for formatting; fixed with
  `prettier --write` before the final check, then reran the test file's
  vitest suite to confirm the reformat didn't change behavior).
- No live/manual browser verification against a real mesh with the
  reported stale-mesh/fresh-MQTT pattern was performed in this session;
  the automated test reproduces the same data pattern shown in the
  screenshot (fresh MQTT, ~48-day-stale mesh) as a substitute.

### Acceptance criteria evidence

- [x] For a matched node, the "Last Heard" column displays the more recent
      of its mesh and MQTT timestamps — not unconditionally the mesh one.
      `NodesPage.tsx`'s displayed cell now calls
      `formatLastHeard(resolvedLastHeard(merged))` instead of
      `formatLastHeard(primary.lastHeard)`.
- [x] Sorting by "Last Heard" (either direction) produces a visible column
      that is actually monotonic, reproducing the screenshot's scenario
      (a node with a fresh MQTT time but stale mesh time) correctly.
      Demonstrated by the `sortMerged` test in `NodesPage.test.tsx`, which
      asserts the stale-mesh/fresh-MQTT node sorts to the top in descending
      order and that its resolved (displayed) value matches the value used
      to rank it.
- [x] The MQTT sub-row's own displayed time is unchanged. The sub-row still
      calls `formatLastHeard(mqtt.lastHeard)` directly; not modified.
- [x] A test demonstrates the fixed display/sort-key agreement for a node
      where mesh and MQTT last-heard values disagree. See
      `NodesPage.test.tsx`.
- [ ] Secondary (optional) cross-section ordering fix — deliberately
      deferred; see "Deferred" section above.

### Assumptions and deviations

- The task file `tasks/approved/TASK-045-...md` existed only in the shared
  checkout's working tree, not in this worktree's git history (confirmed
  via `git log --all` finding no commit referencing TASK-045) and not in
  this isolated worktree's working directory at all. Since this agent is
  restricted to editing files inside its own worktree, the task file's
  exact content (read directly from the shared-checkout path) was
  recreated verbatim in this worktree's `tasks/approved/` directory before
  moving it through the lifecycle, so the lifecycle transitions
  (`approved` → `in-progress` → `review`) happen on a real, trackable copy
  of the task inside this worktree. This mirrors, in spirit, the
  TASK-041 precedent of documenting a sandbox-driven deviation rather than
  silently working around it; unlike TASK-041, `git mv` itself worked fine
  in this worktree (its `.git` is writable here), so no fallback to a plain
  filesystem rename was needed for the lifecycle moves themselves.
- Chose to export the previously-private `buildMergedNodes`,
  `resolvedLastHeard`, `sortMerged`, `SortCol`, and `MergedNode` from
  `NodesPage.tsx` to enable direct, fast unit tests instead of full-DOM
  component rendering (which would need extra scaffolding to stub
  `fetch("/api/hw-models")` and would test the same logic more indirectly).
  This is a minimal, additive visibility change with no behavioral effect.
- Interpreted "the same value ... for both the displayed column and the
  sort key" as requiring only that both be derived from one shared
  resolution function, not that `sortMerged`'s comparator needed to change
  its numeric logic — since `lastHeardMs()` already computed the same
  max-of-both-sources value; the actual defect was the display side only.

### Unresolved risks

- The secondary cross-section sort-ordering behavior (matched/meshOnly/
  mqttOnly/unknown stacking) is unchanged and still has the previously
  known limitation that a very-recently-heard node in one category cannot
  outrank an older node in a different, higher-stacked category. This is
  explicitly deferred per the task's own guidance; recommend a short,
  separate product conversation with Patrick on whether/how section
  headers should behave once cross-category ordering is introduced.
- No live hardware/browser verification was performed against an actual
  mesh exhibiting the stale-mesh/fresh-MQTT pattern; validation is
  automated-test-only for this session.

### Documentation updated

None — this is a display/sort-key bugfix with no external-facing
documentation or contract implications.

## Review

Not reviewed.

## Human acceptance

Pending.
