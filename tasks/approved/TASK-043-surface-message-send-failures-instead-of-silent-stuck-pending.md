# TASK-043: Surface message send failures instead of leaving them stuck "pending" forever

Owner role: Implementer
Assigned agent: openai-coder
Proposed by: Claude (via investigation of reported message-sending unreliability)
Proposed date: 2026-08-26
Approved by: Patrick
Approved date: 2026-08-26
Related contracts: None
Related ADRs: None
Dependencies: None

## Desired outcome

When a `message:send` command fails on the daemon side (e.g. the radio
rejects the send, the device errors, or `meshDevice.sendText` throws for any
other reason), the sender sees that the message failed — the outgoing
bubble's ack indicator changes from the pending hourglass to an explicit
failure state — instead of the message sitting at "pending" indefinitely
with no feedback.

## Context

Found while investigating a report that messages "work sometimes" for
sending. Tracing the send path:

- `packages/daemon/src/routes/websocket.ts`'s `message:send` case (around
  line 237) calls `await device.meshDevice.sendText(...)` with no
  `try/catch` of its own. If it throws, the exception propagates up to the
  `handleClientCommand(...).catch(...)` in the `socket.on("message", ...)`
  handler (around line 194), which logs the error and sends the client a
  generic `{ type: "error", payload: { code: "COMMAND_ERROR", message } }`
  event — and nothing else. No DB row is written, no `message:sent` event is
  emitted, and no `message:ack` failure is emitted for the message.
- On the frontend, `packages/web/src/store/messages.ts`'s
  `initMessageStore()` WS listener only handles `message:received`,
  `message:sent`, `message:history`, and `message:ack` — there is no handler
  for a generic `"error"` event type. Confirmed by grepping the whole
  `packages/web/src` tree: the only consumers of `event.type === "error"`
  are `SetupWizard.tsx` and `ConfigCard.tsx`, both of which check
  specifically for `code === "SET_CONFIG_FAILED"` — nothing listens for
  `COMMAND_ERROR`.
- `packages/web/src/pages/MessagesPage.tsx`'s `sendMessage()` adds an
  optimistic `Message` with `ackStatus: "pending"` and clears the local
  `sending` UI flag after a 5-second `setTimeout` — but that timeout only
  re-enables the compose input; it does not touch the message's
  `ackStatus`. If the daemon-side send throws, the bubble's ack indicator
  stays on the pending hourglass (⏳) forever, giving no indication the
  send failed.

Net effect: any failure in `sendText` before a packet is even handed to the
radio is silently swallowed — the user sees no error, and the sent bubble
looks like it's eternally "waiting for ACK" rather than failed. This matches
"sending is broken... it works sometimes" — sends that reach `sendText`
successfully proceed normally; sends where `sendText` throws vanish with no
feedback.

## Scope

### Included

- Daemon: when `meshDevice.sendText(...)` throws inside the `message:send`
  handler, respond in a way the frontend can attribute to that specific
  send attempt (e.g. include enough correlating information — such as the
  optimistic message's identity or a request id — in the error payload, or
  emit a dedicated failure event) rather than only the generic untargeted
  `COMMAND_ERROR`.
- Frontend: handle that failure signal in `messages.ts`'s WS listener (or
  wherever the correlated command lives) by marking the corresponding
  optimistic message's `ackStatus` as `"error"` with a reasonable
  `ackError` message, so the existing ✗ UI in `MessagesPage.tsx` renders it
  correctly instead of staying pending.
- If wantAck was false (no ack expected at all) and the send itself still
  throws, the same failure surfacing should apply — this is about the send
  call failing, not about ACK timeout.

### Excluded

- Changing the underlying radio/link-layer retry behavior of
  `@meshtastic/core`'s `sendText`.
- Adding a client-side timeout that marks a message as failed purely because
  no ACK arrived within some window when `sendText` itself succeeded (that
  is a separate, and more debatable, product decision — flag it as a
  follow-up rather than folding it into this task).
- Any change to the `SET_CONFIG_FAILED` handling already present in
  `SetupWizard.tsx`/`ConfigCard.tsx`.

## Plan

1. Confirm exactly how `meshDevice.sendText` fails in practice (what it
   throws, and whether the client has already been given an optimistic
   message id it could echo back) to decide on the correlation mechanism.
2. Wrap the `message:send` handler's `sendText` call so a failure emits a
   result the frontend can tie back to the specific attempt — likely by
   including the client-supplied context or the DB message id where
   available.
3. Add a frontend handler for this failure path that flips the matching
   optimistic message's `ackStatus` to `"error"`.
4. Add tests: a daemon-side test that a `sendText` rejection produces the
   new failure signal instead of just a generic `COMMAND_ERROR`; a
   frontend test that receiving that signal updates the optimistic
   message's `ackStatus` to `"error"` and the UI reflects it.

## Acceptance criteria

- [ ] A `sendText` failure on the daemon no longer results in a message that
      stays `ackStatus: "pending"` forever with no user-visible signal.
- [ ] The frontend renders the existing ✗ failure indicator (already built
      for `ackStatus === "error"` in `MessagesPage.tsx`) when a send fails.
- [ ] Successful sends are unaffected — no regression to the existing
      pending → acked flow.
- [ ] New tests cover the failure path on both daemon and frontend sides.

## Validation requirements

New unit/integration tests simulating a `sendText` rejection on the daemon
and confirming the client-visible outcome. Manual verification if a way to
force a send failure is available (e.g. disconnecting the device mid-send);
otherwise rely on the automated tests plus code review of the correlation
logic.

## Risks and assumptions

Assumes `meshDevice.sendText` failures are the actual (or a significant)
source of the reported "sending is broken... sometimes" behavior — this
should be confirmed against real logs/reproduction during implementation,
since the daemon logs the error today (`log.error` at
`websocket.ts:194-198`) and that log history can help validate the theory
before investing in the fix. Low risk to existing functionality since this
only adds a previously-missing failure path; it does not change the
success path.

## Blocker

Awaiting Patrick's approval to move this out of `proposed/`.

## Implementation handoff

Not yet implemented.

## Review

Not reviewed.

## Human acceptance

Pending.
