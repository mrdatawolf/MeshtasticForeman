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

Implemented by openai-coder on 2026-08-26.

### Changes made

- Added an optional non-empty `clientMsgId` to the shared `message:send`
  command schema and added the targeted `message:send-failed` server event
  with `clientMsgId`, `deviceId`, and the send error message.
- Updated `MessagesPage.tsx` to generate one collision-resistant optimistic
  ID (`local-<timestamp>-<random UUID>`) and use it both as the optimistic
  `Message.id` and the outgoing command's `clientMsgId`.
- Wrapped only the daemon's `meshDevice.sendText(...)` call in a local
  `try/catch`. A rejection now logs a warning, sends `message:send-failed`
  only to the requesting socket, and returns before the generic
  `COMMAND_ERROR` path. The successful DB insert and `message:sent` broadcast
  remain unchanged and outside the catch.
- Updated the message store to find the exact optimistic message across all
  conversations by `clientMsgId` and set `ackStatus: "error"` plus the daemon
  error text in `ackError`. Null or unknown IDs are ignored without fallback
  matching.
- Added daemon coverage for a rejected `sendText` with `wantAck: false`,
  proving the correlated failure event is sent and no generic
  `COMMAND_ERROR` is emitted. Added daemon/shared schema coverage and frontend
  store coverage for the correlated error update.
- Added the new message-store-owned event to `appState.ts`'s intentionally
  ignored feature-event cases so its exhaustive `ServerEvent` check remains
  valid.

### Validation performed

Commands were run under Node 22.22.3 using the repository's pinned pnpm
11.21.0 where the sandbox permitted it. Because pnpm's store database is
outside the writable sandbox, installed package binaries were reused read-only
from the main worktree and invoked directly for completed validation.

- `pnpm --filter @foreman/daemon exec vitest run
  src/__tests__/websocket-message-send-failed.test.ts
  src/__tests__/ws-protocol.test.ts && ...`: failed before tests ran with
  `pnpm: command not found` (exit 127).
- `corepack pnpm install --offline --frozen-lockfile`: failed before installing
  with `ERR_SQLITE_ERROR: unable to open database file`; pnpm's store database
  is outside the writable sandbox.
- Pinned `corepack pnpm --filter ... exec vitest ...`: failed before tests ran
  because pnpm's dependency-status check attempted the same blocked install
  and reported `ERR_SQLITE_ERROR`.
- Focused local-binary Vitest command for the daemon failure and protocol
  tests: passed — 2 files and 22 tests passed.
- Focused local-binary Vitest command for the shared protocol test: passed —
  1 file and 27 tests passed.
- Focused local-binary Vitest command for the web message-store test: passed —
  1 file and 2 tests passed.
- Focused Prettier write for the eight initially touched source/test files:
  passed; two files were formatted and the others were already formatted.
- Focused ESLint for those eight files: passed with no output.
- `git diff --check`: passed with no output.
- Full daemon local-binary `vitest run`: passed — 16 files and 227 tests
  passed.
- Full shared local-binary `vitest run`: passed — 2 files and 31 tests passed.
- Initial web build equivalent (`tsc --noEmit && vite build`): failed during
  TypeScript checking because the new server-event variant was not yet listed
  in `appState.ts`'s exhaustive intentionally-ignored feature events. That
  required case was added.
- Focused Prettier and ESLint for `appState.ts`: passed.
- Rerun web build equivalent (`tsc --noEmit && vite build`): passed — Vite
  transformed 1,892 modules and built in 6.99s. The existing advisory about
  chunks larger than 500 kB was reported.
- Final full web local-binary `vitest run`: passed — 15 files and 61 tests
  passed.
- Web local-binary `eslint .`: passed with 0 errors and 5 pre-existing
  `react-hooks/exhaustive-deps` warnings in `DeviceConfigPage.tsx`,
  `MapPage.tsx`, and `NodeDetailPanel.tsx`; none was changed by TASK-043.
- Web Prettier check equivalent for the package script: passed — all matched
  files use Prettier style.
- Daemon and shared local-binary `tsc --noEmit`: both passed with no output.
- No live radio was available to force a manual hardware send failure.

### Acceptance criteria evidence

- The daemon failure test proves a rejected `sendText` emits the targeted
  `message:send-failed` event containing the original `clientMsgId`, including
  when `wantAck` is false, and does not emit `COMMAND_ERROR`.
- The frontend store test proves the matching optimistic message transitions
  from `pending` to `error` and receives the error text in `ackError`, which
  drives the existing failure indicator in `MessagesPage.tsx`.
- Code review and the full daemon suite confirm the successful path is still
  the existing `sendText` result followed by DB persistence and the
  `message:sent` broadcast; those operations were not moved into the catch.
- Full daemon, shared, and web test suites pass after the change.

### Assumptions and deviations

- The chosen correlation mechanism is a client-generated optimistic message
  ID echoed by the daemon. It is generated once, carried as optional
  `clientMsgId`, and matched only by exact message ID. This directly identifies
  the UI object that must change, avoids timing/text fallback ambiguity, and
  remains backward-compatible for older clients because the command field is
  optional and the failure event permits a null ID.
- The ID retains the existing `local-` prefix because current optimistic
  reconciliation and history preservation depend on it; a random UUID suffix
  improves uniqueness for sends created in the same millisecond.
- This isolated worktree initially checked out
  `worktree-agent-ac5185589738740ad` at `5ccf25b`, which is a descendant of
  `code-cleanup` at `51545da`; the relevant task source files were identical
  between those commits. TASK-043 existed only as an uncommitted approved file
  in the main worktree, so its authoritative contents were copied into this
  isolated worktree before lifecycle processing.
- The sandbox exposes Git worktree metadata as read-only. `git switch
  code-cleanup` failed while creating `.git/worktrees/.../index.lock`, so the
  requested branch switch could not be performed. The approved-to-in-progress
  and in-progress-to-review lifecycle moves therefore used ordinary filesystem
  renames instead of `git mv`, following the documented TASK-041 precedent.
- No changes were made to `SET_CONFIG_FAILED`, ACK retry behavior, or
  `@meshtastic/core`.

### Unresolved risks

- A successful `sendText` that never receives a later ACK can still remain
  pending indefinitely. Client-side ACK-timeout behavior is an explicit
  follow-up product decision and was not implemented in TASK-043.
- Older clients that omit `clientMsgId` receive a failure event with a null ID,
  which the frontend intentionally ignores because no safe exact correlation
  is possible.
- Manual hardware verification was not available; automated tests use a
  deterministic rejected `sendText` mock.
- Git index writes, branch switching, staging, and committing are blocked by
  the sandbox's read-only Git metadata. The required commit must be completed
  from an environment with writable Git metadata if the final commit attempt
  fails as expected.

### Documentation updated

- Updated this implementation handoff with the protocol decision, validation
  evidence, lifecycle deviations, and remaining ACK-timeout follow-up. No
  product or architecture documentation required changes for this scoped
  failure-path addition.

## Review

Not reviewed.

## Human acceptance

Pending.
