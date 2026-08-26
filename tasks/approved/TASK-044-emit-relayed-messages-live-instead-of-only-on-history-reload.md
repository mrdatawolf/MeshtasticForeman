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

- [ ] A relayed packet (decoded-elsewhere text traffic between two other
      nodes) results in a WS event the connected frontend receives
      immediately, not just on the next `message:history` fetch.
- [ ] The relayed message appears in the correct conversation thread live,
      styled the same way it already is after a reload (dimmed, "relayed"
      label).
- [ ] No duplicate row/bubble appears once the conversation is later
      reloaded from history (dedup via existing `messageSignature`/`id`
      logic in `packages/web/src/store/messages.ts` should already cover
      this — confirm with a test).
- [ ] Direct and broadcast message delivery is unaffected.

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

## Blocker

Awaiting Patrick's approval to move this out of `proposed/`.

## Implementation handoff

Not yet implemented.

## Review

Not reviewed.

## Human acceptance

Pending.
