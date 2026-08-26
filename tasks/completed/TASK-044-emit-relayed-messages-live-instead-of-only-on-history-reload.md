# TASK-044: Emit relayed messages live instead of only surfacing them on the next history reload

Owner role: Implementer
Assigned agent: openai-coder
Proposed by: Claude (via investigation of reported message-receiving unreliability)
Proposed date: 2026-08-26
Approved by: Patrick
Approved date: 2026-08-26
Related contracts: None
Related ADRs: None
Dependencies: None

## Desired outcome

Relayed mesh traffic (text messages between two other nodes that this
device overhears but isn't the sender or intended recipient of) appears in
the Messages UI live, the same way direct/broadcast messages already do,
instead of only becoming visible after the conversation is reloaded (e.g.
switching threads or reloading the page).

## Context

Found while investigating a report that message receiving "works
sometimes." Two decode paths exist on the daemon for incoming mesh packets:

- `packages/daemon/src/device/message-handler.ts`'s `handleMessage()`,
  wired to `meshDevice.events.onMessagePacket` in
  `packages/daemon/src/device/device-manager.ts:195-206`. This only fires
  for text packets the mesh library has decoded as addressed to this node
  (direct messages to me, or broadcast). It inserts a `role: 'received'`
  row and calls `deps.emit({ type: "message:received", ... })` —
  the frontend gets it immediately over the WebSocket.
- `packages/daemon/src/device/raw-packet-handler.ts`'s `handleRawPacket()`,
  wired to `meshDevice.events.onMeshPacket` (`device-manager.ts:218-227`).
  This fires for every packet the radio hears, including encrypted traffic
  between two other nodes that this device is not a party to. For that
  case (`packages/daemon/src/device/raw-packet-handler.ts:214-246`), it
  inserts a `role: 'relayed'` row into the `messages` table — but **does
  not call `deps.emit(...)` for it**. No WS event is sent for relayed
  messages at all.

The frontend (`packages/web/src/pages/MessagesPage.tsx`'s `ThreadView`)
already has full rendering support for `role === "relayed"` bubbles
(dimmed opacity, "relayed" label) — so relayed messages do show up, but
only whenever `loadConversation`/`loadRecentMessages` re-fetches
`message:history` from the DB (e.g. opening a thread, switching devices,
reloading the page). Between those refreshes, relayed traffic silently
accumulates in the database with no live UI update — which is exactly the
"works sometimes" pattern: direct/broadcast messages always appear live,
relayed messages only appear after the next reload.

## Scope

### Included

- After the `role: 'relayed'` insert in `raw-packet-handler.ts` (around
  line 226-245), emit a `message:received`-shaped event (or an equivalent
  the frontend already handles) carrying the fields needed to render it
  correctly (`role: "relayed"`, `fromNodeId`, `toNodeId`, `packetId`, etc. —
  matching what the frontend's `renderBubble`/`otherNodeId` logic expects).
- Confirm `otherNodeId()` in `packages/web/src/store/messages.ts` correctly
  buckets a relayed message under the right conversation when delivered
  live (it currently assumes `role !== "sent"` implies bucketing by
  `fromNodeId`, which should hold for relayed messages too, but confirm
  during implementation rather than assuming).

### Excluded

- Any change to which packets get persisted as `relayed` (the existing
  filter conditions in `raw-packet-handler.ts:218-225` are out of scope).
- Any change to how relayed bubbles are rendered/styled in
  `MessagesPage.tsx`.
- The separate `message:send` failure-surfacing issue (tracked as
  TASK-043).

## Plan

1. Confirm what payload shape the frontend needs for a `role: "relayed"`
   message to render/bucket correctly without additional changes (check
   `otherNodeId()` and `renderBubble()` in `MessagesPage.tsx`/`messages.ts`).
2. Add the missing `deps.emit(...)` call in `raw-packet-handler.ts` right
   after the relayed-message DB insert, reusing the same `id`/fields
   already computed for the insert.
3. Add a daemon-side test asserting that a relayed packet (from/to neither
   this node nor broadcast) produces both the DB row and the WS event.
4. Add/extend a frontend test confirming a live `message:received` event
   with `role: "relayed"` populates the correct conversation without
   requiring a history reload.

## Acceptance criteria

- [x] A relayed packet (decoded-elsewhere text traffic between two other
      nodes) results in a WS event the connected frontend receives
      immediately, not just on the next `message:history` fetch. Verified by
      the daemon handler test asserting both the DB row and emitted event.
- [x] The relayed message appears in the correct conversation thread live,
      styled the same way it already is after a reload (dimmed, "relayed"
      label). The frontend store test covers live sender-thread bucketing,
      and the unchanged renderer displays the decoded text with its existing
      relayed styling.
- [x] No duplicate row/bubble appears once the conversation is later
      reloaded from history (dedup via existing `messageSignature`/`id`
      logic in `packages/web/src/store/messages.ts` should already cover
      this — confirmed by the added frontend store test.
- [x] Direct and broadcast message delivery is unaffected. The direct and
      broadcast handler was not modified, the existing node/destination
      exclusions were retained, and daemon boundary tests cover both cases.

## Validation requirements

New daemon test covering the relayed-packet emit path; new or extended
frontend store test covering live relayed-message delivery and dedup
against a subsequent history load. Manual verification with a live mesh
that has relay traffic, if available.

## Risks and assumptions

Low-to-moderate risk — this adds a previously-missing emit call using data
already computed for the existing DB insert, so it shouldn't affect any
other code path. Main risk is a mismatch between the emitted payload shape
and what the frontend's dedup/bucketing logic expects, which the added
tests are meant to catch.

## Blocker resolution

Implementation discovered that the original relayed condition was unreachable:
encrypted packets have no known application port, so `portnum` is `0`, while
the condition required both `portnum === TEXT_MESSAGE_APP` and `isEncrypted`.
This was escalated without changing classification outside the then-approved
scope.

Patrick explicitly expanded TASK-044 and resolved the design on 2026-08-26:
"if it is encrypted with a key we do not know let's just drop it on the
frontend? It is not meant for us." The relayed path now accepts decoded text
packets between two other nodes. `isDecoded` proves the mesh library decrypted
the payload with a channel key held by this device, making both the port number
and UTF-8 text trustworthy. Genuinely encrypted unknown-key packets remain in
the raw packet log/inspector but are intentionally excluded from the messages
table and `message:received` events.

## Implementation handoff

Implemented by openai-coder on 2026-08-26 after Patrick resolved the escalated
classification blocker and expanded TASK-044's scope.

### Changes made

- Changed the relayed-message classification in
  `packages/daemon/src/device/raw-packet-handler.ts` from `isEncrypted` to
  `isDecoded`. Decoded text packets between two other nodes can now enter the
  messages domain; unknown-key encrypted packets are intentionally omitted.
  The existing sender, local-node, destination, and broadcast exclusions remain
  unchanged, as do the general packets-table insert and `packet:raw` emit.
- Added a `message:received` emit immediately after the relayed-message insert.
  It reuses the inserted message ID and all persisted packet/node/channel,
  receive-time, signal, hop, acknowledgement, MQTT, and reply values with
  `role: "relayed"`.
- Decodes the successfully decrypted text payload bytes as UTF-8 once and uses
  that same text for both the DB row and live event. `decodePayload()` does not
  handle `TEXT_MESSAGE_APP`; it is for structured protobuf ports. The frontend
  already renders non-null relayed text normally with its existing dimmed
  relayed styling.
- Replaced the daemon characterization test with real handler coverage proving
  decoded traffic between two other nodes creates both the relayed DB row and
  full live event with matching ID and fields; genuinely encrypted traffic
  creates neither; and decoded direct/broadcast traffic remains excluded from
  the relayed path.
- Extended `packages/web/src/store/messages.test.ts` with coverage showing a
  live relayed `message:received` event is bucketed under `fromNodeId`, not
  `toNodeId`, and remains a single message when history later supplies the same
  row.
- Verified by inspection that `MessagesPage.tsx` renders actual relayed text and
  applies the existing relayed label and styling. No renderer or store
  production logic was changed.

### Validation performed

- Toolchain investigation found Node `v22.22.3` under
  `/home/patrick/.nvm/versions/node/v22.22.3/bin` and the pinned pnpm `11.21.0`
  under `/home/patrick/.cache/node/corepack/pnpm/11.21.0`. Pnpm itself could
  report its version but every package script triggered an automatic install
  check that failed with `unable to open database file`. Validation therefore
  invoked the equivalent already-installed package binaries directly under
  Node 22, using temporary dependency links from the primary worktree.
- Daemon focused `vitest run src/device/raw-packet-handler.test.ts`: passed — 1
  test file and 4 tests passed (duration 4.87s).
- Web focused `vitest run src/store/messages.test.ts`: passed — 1 test file and
  2 tests passed (duration 742ms).
- Daemon full `vitest run`: passed — 16 test files and 229 tests passed
  (duration 90.65s). This retry did not reproduce the earlier database-worker
  failures or hang.
- Web full `vitest run`: passed — 15 test files and 61 tests passed (duration
  2.19s).
- Web build equivalent, `tsc --noEmit && vite build`: passed — 1,892 modules
  transformed and the production build completed in 7.29s. Vite reported the
  existing advisory for chunks larger than 500 kB.
- Web lint equivalent, `eslint .`: passed with 0 errors and 5 warnings. The
  warnings are unrelated `react-hooks/exhaustive-deps` warnings in
  `DeviceConfigPage.tsx`, `MapPage.tsx`, and `NodeDetailPanel.tsx`.
- Web format-check equivalent, `prettier --check package.json index.html
  vite.config.ts "src/**/*.{ts,tsx}"`: passed — `All matched files use Prettier
  code style!`
- Daemon `tsc --noEmit`: passed with no output.
- Focused daemon ESLint for `raw-packet-handler.ts` and its new test: initially
  found one import-group blank-line error in the new test; after correction,
  the rerun passed with no output.
- Focused daemon Prettier check for the same files: passed — `All matched files
  use Prettier code style!`
- Repository `git diff --check`: passed with no output.
- No live mesh hardware verification was available.

### Acceptance criteria evidence

- Production live delivery is covered by the daemon handler test: a decoded
  text packet between two other nodes produces the relayed row and matching
  `message:received` payload immediately.
- Frontend live bucketing is implemented by the existing `otherNodeId()` rule
  for non-sent messages and covered by the added test using a relayed event.
- History deduplication is implemented by the existing `messageSignature()`
  logic and covered by the same test with a subsequent history event.
- Direct and broadcast delivery remains unaffected because
  `message-handler.ts` and the relayed UI renderer were not changed, the
  existing local/broadcast exclusions remain, and boundary tests verify them.

### Assumptions and deviations

- UTF-8 text decoding is deliberate: in the corrected `isDecoded` branch the
  mesh library has already decrypted the text-app payload, while
  `decodePayload()` does not decode text ports. The same decoded string is
  persisted and emitted.
- Patrick explicitly decided unknown-key encrypted traffic is not part of the
  messages domain. It remains available through the unchanged raw packet
  inspector path.
- The requested task file was absent from this worktree and from the local
  `main` ref (`git show main:...` failed), so it was recreated from the exact
  human-provided fallback content before entering the lifecycle.
- The first `git mv` from `approved` to `in-progress` failed because the linked
  worktree Git directory could not create `index.lock`; the lifecycle move was
  performed as a plain filesystem rename. Earlier staging attempts while the
  task was blocked failed for the same read-only linked-worktree index.
- The final `git mv` from `in-progress` to `review` was retried after validation
  and failed with the same read-only `index.lock`; that lifecycle move was also
  performed as a plain filesystem rename.
- The final `git add -A` and commit attempt failed before staging with `Unable
  to create .../.git/worktrees/agent-ac131af1ce1323f72/index.lock: Read-only
  file system`. All changes remain unstaged and no commit was created.
- The normal pnpm command wrapper could not execute package scripts because its
  automatic install-state check failed with `unable to open database file`.
  Equivalent installed binaries were used under the discovered Node 22.22.3
  toolchain instead.

### Unresolved risks

- Live hardware behavior remains unverified.

### Documentation updated

- Updated this task with Patrick's blocker resolution, expanded-scope design,
  implementation evidence, validation results, and lifecycle deviations.
- No separate architecture or user documentation was needed; this task records
  the approved classification decision and no general raw-inspector behavior
  changed.

## Review

Not reviewed.

## Human acceptance

Pending.
