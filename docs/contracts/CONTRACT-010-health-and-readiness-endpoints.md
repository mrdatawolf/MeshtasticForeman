# CONTRACT-010: Health and Readiness Endpoints

Status: Accepted
Approved by: Patrick
Approved date: 08/24/26
Related tasks: TASK-033
Related ADRs: None
Depends on: TASK-014's config module (`packages/daemon/src/config.ts`, Accepted
via CONTRACT-003) for `config.mqtt.*`; informs but does not depend on TASK-029
(graceful shutdown, not yet contracted — see Open questions #3).

## Purpose

No health or readiness endpoint exists in `packages/daemon` today. Two
concrete consumers already exist in the repository and motivate this
contract rather than leaving "healthy/degraded/failed" to be invented ad hoc
during implementation:

1. **`start-frontend.sh`** (lines 14–32) polls the API's raw TCP port before
   starting the frontend, with the comment *"there's no HTTP health endpoint
   to poll, so we just check that the TCP port is open."* A TCP-accept check
   only confirms Fastify's listener is bound — it cannot distinguish "the
   daemon is genuinely serving requests" from "the socket is open but the
   process is deadlocked before finishing startup," and it starts the
   frontend unconditionally after a 60s timeout even if the API never comes
   up. TASK-033's own acceptance criterion 4 explicitly names replacing this
   "less precise check" as in scope.
2. **Any future orchestrator/monitoring tooling** (systemd's own
   `Restart=on-failure`, or an eventual container/k8s-style deployment) needs
   an externally observable way to distinguish "daemon is up but MQTT is
   momentarily disconnected" (not a restart-worthy condition — serial/local
   functionality continues independently) from "daemon cannot serve requests
   at all" (restart-worthy).

Because these endpoints will be polled externally and their body is a
contract other tooling parses, "degraded" cannot be left implicit — this
document pins down the exact healthy/degraded/failed semantics per
subsystem, the exact response shapes, and the exact HTTP status codes before
implementation, per TASK-033's own "Risks and assumptions" section.

## Scope

### Included

- The liveness endpoint's exact path, status code, and body for the trivial
  "process is running" case.
- The readiness endpoint's exact path, per-component check definitions
  (PGlite worker, MQTT broker connectivity), status-code mapping, and JSON
  body shape.
- The concrete PGlite "responsive" check (query + timeout) and the concrete
  meaning of "MQTT is configured" for readiness purposes, grounded in
  `packages/daemon/src/config.ts`'s existing `mqtt.broker`/`mqtt.enabled`
  independence (CONTRACT-003) and `MqttGateway`'s existing `isRunning`
  getter and private `connected` flag (`packages/daemon/src/mqtt/gateway.ts`).
- The one new public accessor `MqttGateway` must expose for the readiness
  endpoint to observe broker-connection state, since no such accessor is
  public today.
- Which endpoint `start-frontend.sh`'s wait-for-API polling should switch to,
  since TASK-033's acceptance criteria explicitly ask for this and the
  contract is the appropriate place to name it precisely.

### Excluded

- Deep health checks of any subsystem beyond "HTTP server, database worker,
  and optional external integrations" — no serial/device-level connectivity
  check (per TASK-033's own Scope/Excluded, citing the roadmap wording
  verbatim).
- An active health probe against the MQTT broker itself (e.g. a
  request/response ping over MQTT). The readiness endpoint reports the
  daemon's own client-side connection state as already tracked by
  `MqttGateway` (via `mqtt.js`'s `connect`/`disconnect`/`close` events,
  including its own `reconnectPeriod: 5000` reconnect loop) — it does not
  add any new network round trip. Whether the broker itself is healthy is a
  broker-operator concern, not this daemon's.
- Any change to `MqttGateway`'s connection/reconnect *behavior* — this
  contract only requires that already-tracked internal state become
  observable via a new public getter (see Interfaces); it does not change
  when or how the gateway connects, reconnects, or gives up.
- The exact shutdown-in-progress readiness state and its interaction with
  coordinated shutdown — that behavior belongs to TASK-029's own contract,
  not yet drafted as of this writing (see Open questions #3). This contract
  defines today's healthy/degraded/failed states only.
- Rewriting `start-frontend.sh`/`start-api.sh` themselves — TASK-033's own
  plan step 4 is implementation work; this contract only names which
  endpoint that implementation should target.
- Any authentication/authorization on these endpoints. They are treated as
  operationally trusted, unauthenticated endpoints, consistent with every
  other route in `packages/daemon/src/routes/*.ts` today (none currently
  requires auth).

## Actors

- **`start-frontend.sh`** (and any future equivalent startup script/systemd
  unit): the concrete near-term consumer of the liveness endpoint, replacing
  its current raw `/dev/tcp` port check.
- **A human operator** running `journalctl -u foreman-api.service -f` or
  curling the endpoints directly while diagnosing a stuck daemon.
- **`packages/daemon/src/index.ts`**: registers the new route module
  alongside its existing `registerDeviceRoutes`/`registerAnalyticsRoutes`/
  etc. calls, passing it the already-constructed `db` and `mqttGateway`
  (`MqttGateway | null`) values it already holds locally (lines 100–125).
- **The new health route module** (`packages/daemon/src/routes/health.ts` or
  equivalent — exact filename is implementation discretion, matching the
  package's `registerXRoutes(app, ...)` convention seen in
  `routes/devices.ts`, `routes/coverage.ts`, etc.): the actor whose behavior
  this contract primarily constrains.
- **`MqttGateway`** (`packages/daemon/src/mqtt/gateway.ts`): must expose one
  new public accessor (see Interfaces) so the health route module can read
  its already-tracked connection state without reaching into private fields.
- **The PGlite worker proxy** (`packages/daemon/src/db/open.ts`'s
  `PGliteProxy`, exposed as `db` from `db/client.ts`): the readiness
  endpoint's PGlite check runs an ordinary `db.query(...)` call through this
  existing proxy — no new access path is introduced.

## Inputs and outputs

- **`GET /api/health`** — no inputs (no query params, no body). Always
  responds `200 OK` with `{ "status": "ok" }` if the process can execute the
  handler at all.
- **`GET /api/ready`** — no inputs. Responds `200 OK` (status `"healthy"` or
  `"degraded"`) or `503 Service Unavailable` (status `"failed"`), with the
  body shape defined in Interfaces.

Both endpoints are placed under the existing `/api/` prefix, matching every
other route registered today (`/api/devices`, `/api/mqtt-nodes`,
`/api/region-presets`, `/api/coverage/...`, etc. — confirmed by grep across
`packages/daemon/src/routes/*.ts`). This is a deliberate consistency choice,
not an accident of no precedent existing (see Open questions #4 for the
alternative).

## Preconditions

- `db` (the `PGlite`-shaped proxy from `db/client.ts`) and `mqttGateway`
  (`MqttGateway | null`, `null` when `config.mqtt.broker` is unset) are
  already constructed and available in `index.ts`'s `main()` by the time
  routes are registered (lines 100–125, before line 140's route
  registration block) — the health route module receives them as
  constructor-style arguments exactly like every other `registerXRoutes`
  call, not via any new global/singleton.
- Because `runMigrations(db)` (line 83) runs and completes *before* the
  Fastify `app` is even constructed (line 87) or `app.listen()` is called
  (line 151), a successfully-listening daemon has already proven the PGlite
  worker was responsive at startup. The readiness endpoint's PGlite check
  exists to detect the worker becoming unresponsive *after* that point (killed
  externally, deadlocked, crashed) — it is not redundant with the startup
  path.

## Required behavior

### Liveness — `GET /api/health`

- Always returns `200 OK` with body `{ "status": "ok" }` if the handler
  executes at all. No I/O, no DB query, no await on any external resource —
  the handler is synchronous or trivially resolved so that it cannot itself
  become slow or blocked by a struggling subsystem. This is the exact
  "trivial — process responds" endpoint TASK-033's plan step 2 names.
- There is no in-body "failed" liveness state and none is added. A dead or
  hung process is observed by the *absence* of a valid response (connection
  refused, timeout, or an unrelated 5xx from the process crashing
  mid-request) — not by any field this endpoint returns. This is the
  correct, and only defensible, shape for a liveness check: if the process
  can construct and send a `200`, it is by definition alive. See Open
  questions #5 for whether an event-loop-lag check should ever be added
  here (recommended against).

### Readiness — `GET /api/ready`

**PGlite worker check (firm, not left open):**

- The check executes `db.query("SELECT 1")` through the existing
  `PGliteProxy`, raced against a **2000 ms** timeout. Resolution within the
  timeout → `pglite: "ok"`. Rejection (including the proxy's own immediate
  `"PGlite worker is not running"` rejection once `PGliteProxy`'s internal
  `dead` flag is set — see `open.ts` lines 62–66, 75, 84) or timeout →
  `pglite: "failed"`.
- **A failed PGlite check always makes overall readiness `"failed"`
  (`503`), regardless of MQTT state.** This is the one place in this
  contract's scope that has a single defensible answer rather than a
  human decision to present: every route registered in `index.ts` reads or
  writes through `db` (devices, analytics, coverage, proposals, the
  WebSocket route, and the MQTT gateway's own node upserts). An
  unresponsive database is not "serving in a reduced capacity" the way a
  disconnected MQTT broker is — it is "not serving," full stop. Reporting
  this as merely "degraded" would let an orchestrator or monitor treat a
  fully non-functional daemon as fit to receive traffic.
- **Known tradeoff, stated rather than hidden:** because `PGliteProxy`
  serializes all calls through one internal queue (`_enqueue`, `open.ts`
  lines 83–95), a readiness ping issued while a legitimately slow query
  (e.g. a large coverage viewshed calculation) is in flight queues behind
  it and can itself time out, reporting `"failed"` even though the worker
  is not actually stuck. This is an accepted false-positive risk of using a
  real query rather than a cheaper liveness-only flag (`!dead`); a plain
  `!dead` check would miss a genuinely deadlocked worker (alive as a
  thread, never responding), which is the more dangerous failure mode to
  miss. The exact 2000 ms figure is a reasoned default, not a measured SLO
  — see Open questions #2.

**MQTT check (per the task's own steer, made concrete):**

- **"MQTT is configured" for this endpoint's purposes means
  `mqttGateway !== null && mqttGateway.isRunning`** — i.e., a broker was
  configured (`config.mqtt.broker` set, per CONTRACT-003) **and** the
  gateway was actually started (`ENABLE_MQTT=true`, so `index.ts` called
  `mqttGateway.start()`, which synchronously sets the existing `isRunning`
  getter's backing `client` to non-null). This deliberately treats the
  broker-configured-but-`ENABLE_MQTT=false` case (a documented, intentional
  silent no-op per CONTRACT-003's "`ENABLE_MQTT`/`MQTT_BROKER` independence
  is preserved" section) the same as "MQTT not configured at all" — see
  next bullet and Open questions #1, since this reading is defensible but
  not the only one the task's wording supports.
- **When MQTT is configured (as just defined) and currently connected**
  (`mqttGateway.connected === true` — see Interfaces for the new getter
  this requires): `mqtt: "ok"`.
- **When MQTT is configured (as just defined) but not currently connected**
  (initial connect not yet completed, or a drop mid-`reconnectPeriod`
  reconnect loop): `mqtt: "disconnected"`, and **overall readiness is
  `"degraded"` (still `200`), never `"failed"` on this basis alone** — this
  is the task's own explicit steer, confirmed here rather than
  re-litigated: MQTT connectivity issues must not take down readiness,
  since serial/local mesh functionality is independent of the broker.
- **When MQTT is not configured** (no broker set, or broker set but never
  started per the definition above): the `checks` object's `mqtt` key is
  **omitted entirely** (not present as `"not_configured"` or any other
  placeholder value). Readiness is computed exactly as if MQTT did not
  exist as a concern — never `"degraded"`, never checked, never
  represented. This is stated explicitly, per the task's own instruction,
  so it is not an implicit assumption left for the implementer to guess:
  the presence of the `mqtt` key in the response body is itself the signal
  that MQTT is in scope for this daemon instance.

**Overall status derivation** (evaluated in this order):

1. `pglite: "failed"` → `status: "failed"`, HTTP `503`.
2. `pglite: "ok"` and (`mqtt` key absent, or `mqtt: "ok"`) → `status:
   "healthy"`, HTTP `200`.
3. `pglite: "ok"` and `mqtt: "disconnected"` → `status: "degraded"`, HTTP
   `200`.

Only two HTTP status codes are ever returned by `/api/ready`: `200`
(`"healthy"` or `"degraded"`) and `503` (`"failed"`). This binary mapping is
deliberate: an orchestrator or load balancer that only understands "ready
vs. not ready" (2xx vs. non-2xx) already gets the right answer without
parsing the body — `"degraded"` is, from a pure traffic-routing
perspective, still ready.

### Unexpected errors inside a check

If either check throws an exception not already anticipated above (e.g. a
programming error in the handler itself, not a PGlite/MQTT failure mode),
that component is reported as its own `"failed"`/error state rather than
allowing the exception to propagate into Fastify's default error handler as
an unhandled `500`. `/api/ready` must never itself throw; it always resolves
to one of the defined shapes.

## Postconditions and invariants

- `/api/health`'s response never depends on `db` or `mqttGateway` state —
  changing either subsystem's health has zero effect on liveness.
- `/api/ready`'s `checks.mqtt` key's mere *presence* is sufficient to
  determine whether this daemon instance has MQTT in scope; a caller never
  needs to separately query `/api/health` or any config endpoint to
  interpret it.
- A `"degraded"` readiness response is always HTTP `200`; a `"failed"`
  readiness response is always HTTP `503`. The `status` field's string
  value and the HTTP status code never disagree about "should traffic be
  routed here" — they may only disagree, by design, about *how much*
  functionality is available.

## Failure behavior

- **PGlite worker killed externally / crashed / deadlocked**: `/api/ready`
  returns `503` with `{ "status": "failed", "checks": { "pglite": "failed",
  ... } }` within ~2000 ms of the check starting (see the timeout above).
  `/api/health` is unaffected and continues returning `200`.
- **MQTT broker unreachable while configured (`ENABLE_MQTT=true` with a
  set, unreachable `MQTT_BROKER`)**: `/api/ready` returns `200` with
  `{ "status": "degraded", "checks": { "pglite": "ok", "mqtt": "disconnected"
  } }`. This is the task's named validation scenario and must not produce a
  `503`.
- **MQTT not configured, or configured but not enabled**: `/api/ready`'s
  behavior is identical to a daemon built without MQTT support at all —
  `checks.mqtt` is absent, and only the `pglite` check determines
  `"healthy"` vs. `"failed"`.
- **Both PGlite failed and MQTT disconnected simultaneously**: `status:
  "failed"`, `503` — PGlite failure always dominates (see derivation order
  above); `checks.mqtt` still reports `"disconnected"` for diagnostic value
  even though it isn't what determined the overall status.
- **A request to either endpoint while the process is in the middle of
  starting up** (before routes are registered): not observable as a defined
  response at all — the TCP connection is refused or the request never
  reaches a handler, since Fastify hasn't started listening yet
  (`app.listen()` is the last startup step before routes become reachable).
  This is existing, unremarkable Fastify/Node behavior, not a new failure
  mode this contract introduces.

## Interfaces

```ts
// packages/daemon/src/routes/health.ts (exact filename is implementation discretion)

export interface ReadinessBody {
  status: "healthy" | "degraded" | "failed";
  checks: {
    pglite: "ok" | "failed";
    /** Present only when MQTT is configured for this daemon instance
     *  (mqttGateway !== null && mqttGateway.isRunning). Absent otherwise. */
    mqtt?: "ok" | "disconnected";
  };
}

export async function registerHealthRoutes(
  app: FastifyInstance,
  db: PGlite,
  mqttGateway: MqttGateway | null,
): Promise<void>;
// GET /api/health -> 200 { status: "ok" }
// GET /api/ready  -> 200 | 503, body: ReadinessBody
```

```ts
// packages/daemon/src/mqtt/gateway.ts — one new public accessor required
// by this contract, alongside the existing `isRunning` getter (line 172):

/** True only while the underlying mqtt.js client has fired "connect" and
 *  has not since fired "disconnect"/"close"/"error"-induced closure.
 *  Backed by the gateway's existing private `connected` field (already
 *  toggled by the client event handlers at lines 112–156) — this getter
 *  makes that already-tracked state observable, it does not add new
 *  connection-tracking logic. */
get connected(): boolean;
```

`index.ts` wiring (additive, alongside the existing `registerDeviceRoutes`/
etc. calls at lines 140–144):

```ts
await registerHealthRoutes(app, db, mqttGateway);
```

## UX expectations

N/A as a distinct visual surface — these are infrastructure endpoints
consumed by scripts, systemd, and human operators via `curl`/browser, not by
the frontend application. The one UX-adjacent requirement: `start-frontend.sh`
(implementation work under TASK-033, not this contract) should poll
`GET /api/health` in place of its current raw `/dev/tcp` check, since
liveness — "is the API's HTTP server actually answering requests" — is the
correct precision level for "should the frontend start now," matching what
that script is actually trying to establish today. `/api/ready` is not the
right endpoint for that specific check: gating frontend startup on full
readiness (including MQTT state) would make the frontend refuse to start
merely because a configured MQTT broker is briefly unreachable, which is
exactly the outcome this contract's MQTT-degraded design is meant to avoid
elsewhere.

## Validation requirements

- Manual test, normal startup: both endpoints return `200`; `/api/ready`
  returns `"healthy"` with `checks: { pglite: "ok" }` (no `mqtt` key) when
  no broker is configured, or `checks: { pglite: "ok", mqtt: "ok" }` once a
  configured broker connects.
- Manual test, PGlite worker killed externally (e.g. `kill -9` the worker
  thread's OS process, or an equivalent forced-crash): `/api/ready` returns
  `503` with `status: "failed"` and `checks.pglite: "failed"` within
  roughly 2000 ms; `/api/health` continues returning `200` throughout.
- Manual test, MQTT broker unreachable while `ENABLE_MQTT=true` and
  `MQTT_BROKER` set to an unreachable host: `/api/ready` returns `200` with
  `status: "degraded"` and `checks.mqtt: "disconnected"`.
- Manual test, `MQTT_BROKER` set but `ENABLE_MQTT` unset/`false`:
  `/api/ready`'s `checks` has no `mqtt` key; `status` is determined by
  `pglite` alone.
- Automated unit test coverage (matching this package's existing
  `__tests__/` convention, e.g.
  `packages/daemon/src/routes/__tests__/health.test.ts`) for the status
  derivation table above with a mocked/fake `db` and `mqttGateway`,
  covering at minimum: healthy (no MQTT), healthy (MQTT connected),
  degraded (MQTT configured+disconnected), failed (PGlite failure with
  MQTT both absent and both states), and the "MQTT configured but not
  enabled" omitted-key case.
- Regression check: existing routes (`/api/devices`, `/api/mqtt-nodes`,
  etc.) and the SPA fallback (`setNotFoundHandler`) are unaffected — the
  new routes are registered before the fallback handler, exactly like every
  other `registerXRoutes` call already is (`index.ts` lines 140–144 precede
  line 147's `setNotFoundHandler`).

## Open questions

1. **Does "MQTT is configured" (for readiness) mean `MQTT_BROKER` is set at
   all, or `MQTT_BROKER` set *and* `ENABLE_MQTT=true`?** This contract adopts
   the latter (Required behavior above), so that an operator who
   intentionally left MQTT off via `ENABLE_MQTT=false` is never shown a
   perpetual `"degraded"` for a broker the daemon never even attempts to
   reach. The alternative reading — any `MQTT_BROKER` value at all counts as
   "configured," making `ENABLE_MQTT=false` show up as permanently
   `mqtt: "disconnected"`/`"degraded"` — is also a defensible literal reading
   of the task's wording ("if MQTT is configured... that the broker
   connection is up") and CONTRACT-003 deliberately preserved
   `MQTT_BROKER`/`ENABLE_MQTT` as independent fields without saying which one
   means "configured" for a future consumer like this one. The human should
   confirm this contract's reading before approval.
2. **Exact PGlite ping timeout (proposed 2000 ms).** No existing SLO or
   measured baseline exists in the repository for a `SELECT 1` round trip
   through the worker-thread proxy; 2000 ms is a reasoned default (well
   above expected WASM query latency, short enough that a monitoring poll
   every few seconds still gets a timely answer) rather than a measured
   figure. The known false-positive risk under a legitimately slow
   concurrent query (see Required behavior) is a secondary reason the human
   may want a different value, or may accept the tradeoff as-is.
3. **Shutdown-in-progress readiness state.** TASK-033's own Dependencies
   line names TASK-029 (graceful shutdown) and states "readiness should
   reflect shutdown-in-progress state." TASK-029's contract does not yet
   exist as of this writing (no `CONTRACT-008` or equivalent found in
   `docs/contracts/`). This contract does not block on it and defines only
   today's three states (`healthy`/`degraded`/`failed`); once TASK-029's
   contract exists, this contract (or a follow-up revision of it) will need
   a fourth state — most likely `"shutting_down"` with a `503` (not ready
   for new work) — and a defined interaction with the `pglite`/`mqtt`
   per-component checks during an in-progress shutdown sequence. Flagged so
   it is not silently forgotten once that dependency lands, not resolved
   here.
4. **`/api/health` + `/api/ready` vs. unprefixed `/health` + `/ready`.**
   This contract places both endpoints under the existing `/api/` prefix
   for internal consistency with every other route in the package. Many
   external conventions (Kubernetes-style probes, common reverse-proxy
   configs) instead expect unprefixed, top-level paths so they can be
   exempted from auth/API-versioning middleware that might apply to `/api/*`
   as a whole. Nothing in this daemon today applies such middleware
   selectively to `/api/*` (no auth exists on any route), so this
   distinction is low-stakes here, but the human should confirm the
   `/api/`-prefixed choice rather than have it be an unstated default.
5. **Should liveness ever incorporate a cheap event-loop-lag check** (e.g.
   flagging `"degraded"`/non-`200` if the event loop has been blocked for
   an unusually long time), rather than being purely "did the handler run
   at all"? This contract recommends against it — TASK-033's own wording
   calls the liveness endpoint "trivial," and event-loop-lag detection would
   introduce a genuinely new health signal and threshold-tuning question
   with no current motivating incident in this codebase. Named here only so
   the omission is a stated decision, not an unnoticed gap.
