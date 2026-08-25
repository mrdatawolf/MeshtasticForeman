# CONTRACT-008: Coordinated Shutdown Sequence

Status: Accepted
Approved by: Patrick
Approved date: 08/24/26
Related tasks: TASK-029

## Rework-risk note — read before approving

This contract is written and designed against the **current, pre-split**
`DeviceManager` (`packages/daemon/src/device/device-manager.ts`, 1332 lines,
still owning connection lifecycle *and* message/telemetry/config/bot-command
handling) and `MqttGateway` (`packages/daemon/src/mqtt/gateway.ts`, still a
single class covering transport, codec, topic parsing, inbound handling,
publishing, and node persistence). TASK-029's own "Dependencies" line
recommends — "not strictly required" — waiting for TASK-024 (DeviceManager
reduction) and TASK-025 (MqttGateway split) to land first, "since each
subsystem's shutdown hook is easier to define with clear post-split
ownership boundaries," and warns that doing this earlier "risks rework."

That risk is real and specific, not hypothetical:

- TASK-024 keeps `DeviceManager` as the connect/disconnect/lifecycle owner
  (its own Scope says extraction covers message/node-update/telemetry/config/
  bot-command/traceroute handling — lifecycle stays put), so the
  `DeviceManager.shutdown()` hook this contract defines (Interfaces, below)
  is **likely** to survive TASK-024 mostly intact. Lower risk.
- TASK-025 explicitly splits `MqttGateway` into transport, codec,
  topic-parsing, inbound-handling, publishing, and node-persistence pieces.
  The single `MqttGateway.stop()`/new `shutdown()` hook this contract
  defines assumes one class owns the MQTT client connection and the
  per-device self-announce timers together. After TASK-025, "stop the MQTT
  client" and "clear the self-announce timers" may belong to two different
  modules with their own hook, requiring this contract's MQTT shutdown
  section to be revised, not just re-pointed at a renamed method. Higher
  risk.

This contract does not resolve that risk — it surfaces it so the human can
choose, with full information, between:

1. **Approve now**, accept that the MQTT shutdown section (and, to a lesser
   extent, the DeviceManager section) may need a follow-up revision once
   TASK-025 (and TASK-024) land, or
2. **Wait**, and have this contract re-drafted against the post-split module
   boundaries once TASK-024/025 are implemented.

Everything below is drafted as if option 1 is chosen, since that is what was
requested. It defines real, implementable behavior against the code that
exists today — it does not hide behind the pending split.

## Purpose

No coordinated shutdown exists today. Confirmed by reading
`packages/daemon/src/index.ts` in full: there is no `process.on("SIGTERM",
...)` or `process.on("SIGINT", ...)` anywhere in the file or the rest of
`packages/daemon/src`. The two `process.on(...)` handlers that do exist
(`unhandledRejection`, `uncaughtException`, `index.ts:54-73`) exist to
*suppress* known serial-disconnect noise and route unexpected errors through
`fatalError()` — neither participates in shutdown. Today, `SIGTERM`/`SIGINT`
fall through to Node's default behavior: immediate process termination, with
no attempt to stop accepting new HTTP/WS traffic, close WS connections
cleanly, stop the MQTT gateway, close serial ports, clear timers, or
terminate the PGlite worker/release its lock file. This is genuinely new
behavior to design, not existing behavior to characterize — there is nothing
to characterize.

This matters because an unclean stop can leave real, externally-visible
damage: a stale `postmaster.pid` in the PGlite data directory blocking the
next startup (mitigated today only by `db/client.ts:9`'s unconditional
`clearDbLock()` call *at the next startup*, not at shutdown), an orphaned
serial port handle that (per `device-manager.ts:583-585`'s own comment)
"races the stale handle" on Windows and leaves the port unavailable, WS
clients left on a dead socket with no explanation, and an MQTT client that
either lingers (if not force-closed) or drops mid-publish with no
unsubscribe.

This contract defines the exact shutdown order, the per-subsystem hook each
piece of the sequence must expose, the shutdown-timeout/force-exit
behavior, and the WS close semantics clients can rely on — so
implementation has a single, reviewable design to build against rather than
inventing ordering ad hoc.

## Scope

### Included

- The `SIGTERM`/`SIGINT` handler registration in `index.ts` and the shutdown
  coordinator function it calls.
- The exact shutdown order across: HTTP/WS accept-new-connections cutoff,
  existing WS connection closure (close code/reason), the MQTT gateway, the
  DeviceManager's serial device connections, background timers (the MQTT
  15-minute self-announce timer and DeviceManager's watchdog/reconnect
  timers — the only background timers a repository-wide grep for
  `setInterval`/`setTimeout` in `packages/daemon/src` found outside
  short-lived, self-clearing, request-scoped uses; see Required behavior),
  the PGlite worker, then process exit.
- The new per-subsystem hook signatures this sequence requires
  (`DeviceManager.shutdown()`, `MqttGateway.shutdown()`, a WS-route close
  handle), including which are genuinely new methods vs. which reuse
  existing ones (`PGliteProxy.close()`, `clearDbLock()`).
- The shutdown-timeout duration, what "hangs" means, and the force-exit
  behavior (exit code, what happens to in-flight work).
- Re-entrancy: what happens if a second `SIGTERM`/`SIGINT` arrives while
  shutdown is already in progress.
- The interaction between this new coordinator and the two existing
  `process.on("unhandledRejection"/"uncaughtException", ...)` handlers and
  `fatalError()` (`index.ts:19-73`).

### Excluded

- Health/readiness endpoint semantics — explicitly deferred to TASK-033 per
  TASK-029's own Scope/Excluded.
- Any change to `DeviceManager`'s or `MqttGateway`'s *non-shutdown* behavior.
  In particular, this contract does not fix the pre-existing watchdog-timer
  gap it identifies in Required behavior for the general (non-shutdown)
  `disconnect()` call path — only `DeviceManager.shutdown()`'s new,
  shutdown-scoped cleanup is required to be defensive against it.
- Changing `MqttGateway.stop()`'s existing behavior or its existing caller
  (`routes/websocket.ts`'s `mqtt:toggle` command). A new `shutdown()` method
  is added alongside it; `stop()` is not renamed, removed, or altered.
- Changing `start-api.sh`'s unconditional restart loop (`while true; do pnpm
  ... dev || true; ...; done`) or the systemd units in `Samples/`. See Open
  questions #4 for why this interaction still needs the human's attention
  even though it's out of this contract's editable scope.
- Any change to how `.env`/config is loaded, or to `clearDbLock()`'s
  existing startup-time call in `db/client.ts:9` (CONTRACT-001/CONTRACT-003
  territory).

## Actors

- **Daemon process entry point** (`packages/daemon/src/index.ts`):
  registers the `SIGTERM`/`SIGINT` handlers and owns the shutdown
  coordinator function and its timeout.
- **HTTP/WS server** (Fastify instance `app`, `@fastify/websocket`): stops
  accepting new connections; its existing WS clients are closed explicitly
  by the coordinator before `app.close()` runs.
- **WS route module** (`packages/daemon/src/routes/websocket.ts`,
  `registerWsRoute`): gains a new returned handle exposing the currently
  connected client set so the coordinator can close them (see Interfaces —
  today `clients` is a function-local `Set<WebSocket>` with no external
  handle; this is a genuine interface gap this contract closes).
- **`MqttGateway`** (`packages/daemon/src/mqtt/gateway.ts`): gains a new
  `shutdown()` method; existing `stop()` (`gateway.ts:159-170`) is reused
  internally, unchanged.
- **`DeviceManager`** (`packages/daemon/src/device/device-manager.ts`):
  gains a new `shutdown()` method that disconnects every device and clears
  all reconnect/watchdog timer state, including state not reachable through
  the existing per-device `disconnect()` method alone.
- **PGlite worker proxy** (`packages/daemon/src/db/open.ts`): its existing
  `close(): Promise<void>` (`open.ts:145-150`) and `clearDbLock()`
  (`open.ts:166-172`) are both reused, unchanged, called in sequence by the
  coordinator.
- **Operator** (systemd, a manual `Ctrl-C`, or `start-api.sh`'s process
  supervision): sends `SIGTERM`/`SIGINT` and observes either a clean exit
  within the timeout or a force-exit if something hangs.
- **Connected WS/frontend clients**: receive a defined close code/reason
  instead of an unexplained dropped connection.

## Inputs and outputs

- **Input**: `SIGTERM` or `SIGINT` delivered to the daemon process.
- **Output (success path)**: every subsystem below reports its teardown
  complete (or is force-timed-out — see Failure behavior), the process logs
  a shutdown summary, and `process.exit(0)` is called.
- **Output (timeout path)**: a logged warning identifying which stage the
  sequence was in when the timeout fired, followed by `process.exit(124)`
  (see Required behavior/timeout for why this specific code is proposed,
  and Open questions #2 for confirming it).
- **Side effects observed externally**: connected WS clients receive a
  close frame with code `1001` and reason `"server shutting down"` (see
  Required behavior); the MQTT broker sees the client disconnect; any
  connected serial device's port handle is released; `postmaster.pid` in
  the PGlite data directory is absent after a clean shutdown.

## Preconditions

- The coordinator function is registered exactly once, synchronously, near
  the top of `index.ts` (alongside the existing `unhandledRejection`/
  `uncaughtException` handlers at `index.ts:54-73`) — not inside `main()` —
  so a signal delivered before `main()` finishes (e.g., during a slow
  `runMigrations()` or `syncHwModels()` call) is still caught rather than
  falling through to Node's default kill behavior. This means the
  coordinator must tolerate being invoked before some subsystems
  (`deviceManager`, `mqttGateway`, `app`) have been constructed yet — each
  step must no-op safely on an unconstructed/`null` subsystem rather than
  throw.
- `@fastify/websocket` (`^11.0.2`) and `fastify` (`^5.3.2`) are already
  dependencies (`packages/daemon/package.json`); this contract assumes their
  currently-installed versions' documented `close()`/WS-termination
  semantics, not a version bump.
- `MqttGateway.stop()` (`gateway.ts:159-170`), `DeviceManager.disconnect()`
  (`device-manager.ts:324-343`), `PGliteProxy.close()` (`open.ts:145-150`),
  and `clearDbLock()` (`open.ts:166-172`) all already exist and are reused
  as building blocks — this contract does not redesign their internals.

## Required behavior

### Overall shutdown order

On receiving `SIGTERM` or `SIGINT` (first occurrence — see Re-entrancy
below):

1. **Start the shutdown timer** (see Timeout, below) and log that shutdown
   has begun (signal name, timestamp).
2. **Stop accepting new work at the front door**:
   a. Close every currently-connected WS client via the new WS route
      handle's `closeAll(1001, "server shutting down")` (Interfaces,
      below) — sent *before* the HTTP listener closes, so clients get an
      explained close rather than a dropped socket during `app.close()`.
   b. Call `app.close()` to stop the HTTP listener from accepting new
      connections (including new WS upgrade requests) and to run Fastify's
      own `onClose` hooks.
3. **Stop the MQTT gateway**: `await mqttGateway.shutdown()` (no-op if
   `mqttGateway` is `null`, i.e., `MQTT_BROKER` was never configured).
4. **Close serial device connections**: `await deviceManager.shutdown()`.
5. **Terminate the PGlite worker**: `await db.close()`, then
   `clearDbLock()`.
6. **Exit**: log a shutdown-complete summary and call `process.exit(0)`.

If a step throws, it is caught, logged with which step failed, and the
sequence **continues to the next step** rather than aborting — a failure in
one subsystem's teardown (e.g., the MQTT broker being unreachable so
`client.end()` hangs briefly) must not prevent the PGlite worker from being
terminated and the lock released. This is why the shutdown timeout (below)
is the real backstop, not per-step error handling.

### Why this order, not another

- **HTTP/WS first, both directions (b before new-work, a before
  b)**: closing WS clients before stopping the listener means the "going
  away" close frame is sent over a still-live server rather than raced
  against `app.close()`'s own connection teardown, whose exact WS-closing
  behavior across `@fastify/websocket`/`ws` versions is not something this
  contract verifies from source (see Open questions #1) — sending the
  close frame explicitly, first, removes that dependency entirely. Doing
  the front door first (before MQTT/serial/DB) ensures no new client
  command (`message:send`, `device:set-config`, `mqtt:toggle`, `node:remove`
  — all handled in `routes/websocket.ts`) can start a new operation against
  a subsystem that's already mid-teardown or gone, which would otherwise
  surface as a confusing, uncategorized `COMMAND_ERROR` rather than a clean
  "connection closing" experience.
- **MQTT before serial**: `MqttGateway.shutdown()` does not touch serial
  devices at all — the two are independent from a strict data-dependency
  standpoint. Ordering MQTT first is still deliberate: `DeviceManager`
  already calls `this.mqttGateway?.detachDevice(deviceId)` as part of its
  own per-device `disconnect()` (`device-manager.ts:338`). Stopping the
  gateway first means every `detachDevice()` call during step 4 targets an
  already-idle gateway (client `null`, no self-announce timers running)
  instead of one that might still be mid-`stop()` teardown itself. This is
  a judgment call, not a hard requirement of the code as written — flagged
  in Open questions #3.
- **Serial before PGlite**: every remaining subsystem that can still issue
  a DB query (`DeviceManager`'s persistence calls, any WS command handler
  still in flight) must be stopped before the worker terminates, so a
  late query fails fast during that subsystem's own teardown (an error
  already caught and logged per-step, above) rather than racing
  `PGliteProxy.close()` and hitting `"PGlite worker is not running"`
  (`open.ts:75,84` — the proxy's own existing error for exactly this case).
  WS/MQTT are already stopped by this point (steps 2–3), so serial/
  `DeviceManager` is the last DB-query source standing before step 5.
- **PGlite last**: per the above, and because `runMigrations(db)` runs
  first at startup (`index.ts:83`) — DB availability brackets the rest of
  the daemon's lifecycle symmetrically (opened first, closed last).

### Background timers

- The MQTT 15-minute self-announce timer (documented in
  `docs/ARCHITECTURE.md:47`, implemented as `state.selfAnnounceTimer` per
  device, `gateway.ts:69,207-212`) is already cleared for every attached
  device inside the existing `MqttGateway.stop()` (`gateway.ts:160-165`).
  The new `shutdown()` method calls `stop()` internally, so this requires
  no new timer-clearing logic — it is an existing, correct behavior this
  contract reuses.
- `DeviceManager` has two other timer families, **neither of which has an
  existing bulk-clear path today**:
  - **Watchdog timers** (`watchdogTimers` map, `_startPacketWatchdog`,
    `device-manager.ts:497-529`, 45 s interval): cleared inside
    `_handleDeviceStatus`'s `DeviceDisconnected` branch
    (`device-manager.ts:570-575`) — but **not** inside the manual
    `disconnect(deviceId)` method (`device-manager.ts:324-343`). Tracing
    the code: manual `disconnect()` deletes the device from `this.devices`
    (line 332) *before* calling `device.transport.disconnect()` (line 339);
    when that later triggers `_handleDeviceStatus`, its guard
    `if (!device || device.transport !== transport) return;` (line 569)
    is hit immediately because the device is already gone from the map —
    so the watchdog-clearing code at lines 570-575 never runs for a
    manually-disconnected device. **This is a pre-existing gap in
    `disconnect()`, confirmed by reading the code, not something this
    contract introduces.** It is out of scope to fix generally (Scope/
    Excluded), but `DeviceManager.shutdown()` must not inherit it: it must
    explicitly clear every entry in `watchdogTimers` directly, not rely
    solely on calling `disconnect()` per device.
  - **Reconnect timers** (`reconnectTimers` map, `_scheduleReconnect`,
    `device-manager.ts:593-624`, exponential backoff up to 60 s): these are
    keyed by **port**, not device ID, and can exist for a port that is
    currently *disconnected and mid-backoff* — i.e., with no corresponding
    entry in `this.devices` at all. `DeviceManager.shutdown()` must
    therefore clear every entry in `reconnectTimers` (and the
    `reconnectingPorts` set) directly as well, independent of iterating
    connected devices, or a device that dropped moments before shutdown
    began would have its pending reconnect attempt fire after (or racing)
    process exit.
- No other `setInterval`/`setTimeout` use in `packages/daemon/src` is a
  persistent background timer: `open.ts:187`'s worker-ready timeout is
  startup-scoped and already self-clears on ready/error/exit;
  `routes/coverage.ts`'s two `setTimeout` calls are request-scoped
  rate-limiting delays inside a single request handler, not standing
  timers.

### PGlite worker termination and lock release

`db.close()` (`PGliteProxy.close()`, `open.ts:145-150`) already: sends a
`"close"` message to the worker (swallowing any error), then calls
`worker.terminate()`. The coordinator calls `await db.close()`, then calls
`clearDbLock()` (`open.ts:166-172`) **unconditionally afterward**, even
though `db.close()`'s own clean shutdown may already remove PGlite's
internal lock file — `clearDbLock()` is idempotent (`if
(existsSync(lockFile))`) and this belt-and-suspenders call is cheap
insurance directly satisfying TASK-029's acceptance criterion ("No stale
lock files... remain after shutdown"), without this contract asserting
(and this contract does **not** assert) that PGlite's own close reliably
removes `postmaster.pid` on every code path — that internal behavior isn't
verified against PGlite's source here.

**On the force-exit/timeout path** (below), `clearDbLock()` is
**deliberately not called** by the coordinator — `clearDbLock()`'s own
docstring says "Only call this after confirming the daemon is not
running," and on a force-exit the worker thread may still be mid-write.
Unlinking the lock file out from under a live worker is exactly the
unsafe case that docstring warns about. This is not a gap: `db/client.ts:9`
already calls `clearDbLock()` unconditionally at the *start* of the next
run, which is the existing, pre-dating-this-contract mechanism that
recovers from precisely this "killed rather than shut down cleanly" case.
The timeout path relies on that existing self-heal rather than duplicating
it unsafely inside the timeout handler.

### Re-entrancy

A second `SIGTERM`/`SIGINT` received while a shutdown is already in
progress immediately calls `process.exit(1)` (bypassing the remaining
sequence and the timeout) — the conventional "I mean it, stop now"
double-signal behavior. Flagged as a recommendation, not a hard
requirement derived from existing code (there is no precedent for this in
the codebase); see Open questions #5.

### Shutdown timeout

A timer starts when the signal is first received (step 1, above). If the
full sequence (steps 2-6) has not completed by the time the timer fires,
the coordinator logs which step it was in, then force-exits immediately
via `process.exit(124)` without waiting for any further in-flight
teardown. In-flight work at that moment (an MQTT `client.end()` still
resolving, a serial `transport.disconnect()` still awaiting the OS, a
PGlite query mid-flight) is abandoned — Node's forced process exit does
not run further JS, so nothing "half-finishes" cleanly; whatever OS-level
resources (open sockets, open serial handles) hadn't yet been released
are released by the OS on process death instead. **Proposed timeout
duration: 10 seconds.** This is a recommendation requiring explicit
human confirmation, not derived from existing code (there is no prior
shutdown-timeout precedent anywhere in this codebase to match against).
It is checked for safety against one existing constraint: the systemd
unit at `Samples/foreman-api.service` sets no `TimeoutStopSec`, so
systemd's default (90 s) applies — a 10 s internal timeout leaves ample
margin before systemd would `SIGKILL` the process itself. See Open
questions #2 for the timeout duration and exit code, both open for
confirmation.

## Postconditions and invariants

- After a clean shutdown (`process.exit(0)`): no WS clients remain
  connected to the (now-closed) HTTP server; the MQTT client is
  disconnected and every `selfAnnounceTimer` is cleared; every entry in
  `DeviceManager`'s `devices`, `watchdogTimers`, `reconnectTimers`, and
  `reconnectingPorts` is empty; the PGlite worker thread has exited; no
  `postmaster.pid` file exists in the configured PGlite data directory.
- After a force-exit (`process.exit(124)`): none of the above is
  guaranteed. The only invariant on this path is that the process does
  exit (i.e., shutdown cannot hang the process indefinitely) and that the
  next daemon startup's existing `clearDbLock()` call (`db/client.ts:9`)
  remains in place and unmodified — this contract does not weaken or
  bypass that existing self-heal.
- The coordinator is idempotent with respect to partially-constructed
  state: calling any step against a subsystem that was never constructed
  (e.g., `mqttGateway === null` because `MQTT_BROKER` was never set) is a
  safe no-op, not a thrown error.

## Failure behavior

- **A single subsystem's `shutdown()` throws or rejects**: caught and
  logged by the coordinator (subsystem name + error), sequence continues
  to the next step (see Overall shutdown order). This is a deliberate
  choice — a broken MQTT broker connection must not prevent the DB lock
  from being released.
- **The full sequence exceeds the shutdown timeout**: `process.exit(124)`,
  per Required behavior/Shutdown timeout, above.
- **A second `SIGTERM`/`SIGINT` arrives mid-shutdown**: `process.exit(1)`
  immediately, per Required behavior/Re-entrancy, above.
- **An `uncaughtException`/`unhandledRejection` fires during shutdown**:
  the two existing handlers (`index.ts:54-73`) still catch it and route it
  to `fatalError()`, which — on a TTY — waits for a keypress, or otherwise
  waits 5 seconds, before its own `process.exit(1)`. This is **not**
  reconciled by this contract with the shutdown-timeout path; both could
  in principle fire, and whichever calls `process.exit()` first wins. This
  interaction is a genuine open question, not silently resolved — see Open
  questions #6.

## Interfaces

```ts
// packages/daemon/src/routes/websocket.ts

export interface WsRouteHandle {
  /**
   * Closes every currently-connected WS client with the given close code
   * and reason. Safe to call with zero connected clients. Idempotent —
   * a client that closes/disconnects concurrently is simply skipped.
   */
  closeAll(code: number, reason: string): void;
}

export async function registerWsRoute(
  app: FastifyInstance,
  deviceManager: DeviceManager,
  mqttGateway?: MqttGateway | null,
  db?: PGlite,
): Promise<WsRouteHandle>; // return type changes from Promise<void> to this
```

```ts
// packages/daemon/src/mqtt/gateway.ts — new method, `stop()` unchanged

class MqttGateway extends EventEmitter {
  // ...existing members unchanged...

  /**
   * Process-shutdown hook. Internally calls the existing `stop()` (clears
   * every device's selfAnnounceTimer, force-closes the MQTT client). Does
   * not throw — internal errors are caught and logged. Resolves once
   * teardown is complete; safe to call even if the gateway was never
   * started.
   */
  async shutdown(): Promise<void>;
}
```

```ts
// packages/daemon/src/device/device-manager.ts — new method

class DeviceManager extends EventEmitter {
  // ...existing members unchanged...

  /**
   * Process-shutdown hook. Disconnects every currently-connected device
   * (parallelized; one device's failure does not block the others) and
   * unconditionally clears all entries in `watchdogTimers`,
   * `reconnectTimers`, and `reconnectingPorts` directly — not solely as a
   * side effect of per-device `disconnect()` — because both timer families
   * can hold state (a pending reconnect for an already-dropped port; a
   * watchdog interval `disconnect()` doesn't clear, per Required behavior)
   * that isn't reachable by iterating `this.devices` alone. Does not throw.
   * Does not schedule any further reconnect attempts once called.
   */
  async shutdown(): Promise<void>;
}
```

```ts
// packages/daemon/src/index.ts — coordinator (illustrative shape; exact
// internal structure is implementation discretion)

async function shutdown(signal: "SIGTERM" | "SIGINT"): Promise<never> { ... }

let shuttingDown = false;
for (const sig of ["SIGTERM", "SIGINT"] as const) {
  process.on(sig, () => {
    if (shuttingDown) {
      process.exit(1); // second signal — force quit now
    }
    shuttingDown = true;
    shutdown(sig);
  });
}
```

No change is required to `PGliteProxy.close()` or `clearDbLock()`
(`open.ts`) — both are reused as-is.

## UX expectations

- Connected WS/frontend clients: receive a WebSocket close frame with code
  `1001` ("Going Away") and reason `"server shutting down"` — not silence,
  not a raw connection reset. The frontend's own reconnect-handling
  behavior (not specified here) can use this to distinguish an intentional
  shutdown from a network drop if desired; this contract only guarantees
  the code/reason are sent, not any particular frontend reaction to them.
- Operator (terminal/`journalctl`): sees a logged shutdown-start line
  (signal name), one line per subsystem as it completes (or fails, still
  logged), and either a shutdown-complete line before exit 0, or a
  "shutdown timed out during <step>, forcing exit" line before exit 124.

## Validation requirements

- Manual shutdown testing, per TASK-029's own Validation requirements:
  normal shutdown; shutdown mid-HTTP-request; shutdown with an active
  serial connection and a pending MQTT publish. Confirm no stale
  `postmaster.pid` and no orphaned worker process remains afterward, per
  TASK-029's acceptance criteria.
- At least one subsystem-hung condition (per TASK-029's Plan step 4):
  simulate a subsystem whose `shutdown()` never resolves (e.g., a stubbed
  MQTT client whose `end()` never calls back) and confirm the shutdown
  timeout still force-exits within the configured duration rather than
  hanging indefinitely.
- Confirm a WS client observes close code `1001`/reason `"server shutting
  down"` specifically (not a generic 1000 or an abrupt terminate).
- Confirm `DeviceManager.shutdown()` clears a *pending* reconnect timer for
  a port whose device dropped moments before shutdown began (not just a
  timer for a still-currently-connected device) — this is the specific gap
  identified in Required behavior/Background timers.
- Confirm the coordinator does not throw when invoked with `mqttGateway ===
  null` (no `MQTT_BROKER` configured) and/or before `app`/`deviceManager`
  are constructed.

## Open questions

1. **Does `app.close()` on the installed `@fastify/websocket@^11.0.2` /
   `fastify@^5.3.2` already force-close any WS client left open, and with
   what code?** This contract does not assume any particular behavior here
   and instead requires the coordinator to close every WS client
   explicitly, with a defined code/reason, *before* calling `app.close()`
   (Required behavior), so the answer doesn't matter for correctness. It
   may still matter for `app.close()`'s own resolve timing (whether it
   waits on the WebSocketServer at all) — worth a quick implementation-time
   check, not a blocking question for approval.
2. **Is the proposed 10-second shutdown timeout, and the proposed exit
   code 124 for the force-exit path, acceptable?** Neither is derived from
   existing code or precedent in this repository — both are this
   contract's own recommendation (10 s: generous relative to the
   lightweight teardown work involved and well within systemd's 90 s
   default `TimeoutStopSec`; 124: the conventional "timed out" exit code
   used by GNU `timeout`, chosen to be distinguishable from `fatalError()`'s
   existing exit code 1 in logs/monitoring). The human should confirm or
   choose different values.
3. **Is MQTT-before-serial the right relative order, or should it be
   serial-before-MQTT?** As explained in Required behavior, there is no
   strict data-dependency forcing this order — the rationale given (avoid
   `detachDevice()` calls racing a still-shutting-down gateway) is a
   judgment call, not a hard requirement. The human should confirm or
   propose different reasoning/order.
4. **The `start-api.sh` restart-loop interaction.** `start-api.sh`
   (referenced by `Samples/foreman-api.service`'s `ExecStart`) wraps the
   daemon in an unconditional `while true; do pnpm ... dev || true; ...;
   done` loop with a 1 s sleep — it restarts the daemon on *any* exit,
   clean or not. This contract's clean shutdown path calls
   `process.exit(0)`. If an operator sends `SIGTERM` intending to *stop*
   the service (e.g., `systemctl stop foreman-api.service`, which sends
   `SIGTERM` to the whole control group under systemd's default
   `KillMode=control-group`, hitting both the bash wrapper and the node
   process), the daemon may restart itself via the shell loop within ~1 s
   of this contract's own graceful exit completing, defeating the intent
   to stop. This contract does not change `start-api.sh` (Scope/Excluded)
   — it is flagged here because it's an externally-visible compatibility
   concern this contract's own behavior interacts with, not because this
   contract can resolve it. The human should decide whether this is
   acceptable as-is, or whether `start-api.sh`/the systemd units need a
   follow-up change (e.g., distinguishing an intentional-stop exit code
   from a crash) — out of this contract's scope either way.
5. **Should a second `SIGTERM`/`SIGINT` mid-shutdown force-exit
   immediately (proposed), or be ignored/queued instead?** No precedent in
   this codebase; flagged as a recommendation requiring confirmation.
6. **Should the shutdown coordinator suppress/short-circuit
   `fatalError()`'s existing "wait for keypress or 5 s" behavior
   (`index.ts:24-49`) while a `SIGTERM`/`SIGINT`-triggered shutdown is
   already in progress?** `fatalError()`'s wait is designed for *crash*
   visibility (so an operator watching a terminal can read the error
   before the loop restarts) — that rationale doesn't obviously apply to
   an unrelated `uncaughtException` firing mid-*intentional* shutdown,
   where it would visibly stall a `systemctl stop`/`Ctrl-C` for up to 5+
   seconds. This contract does not resolve this interaction and flags it
   for explicit human decision rather than silently picking a precedence
   between the two exit paths.
