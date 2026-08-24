# CONTRACT-002: Frontend HTTP Client Conventions

Status: Accepted
Approved by: Patrick
Approved date: 08/24/26
Related tasks: TASK-013

## Purpose

TASK-013 replaces the frontend's scattered, inconsistent direct `fetch()` calls
with a small set of feature-specific typed modules under `packages/web/src/api/`
built on one shared client core. A repository-wide read of every current
`fetch()` call site (`AnalyticsPage.tsx`, `App.tsx`, `DeviceConfigPage.tsx`,
`MessagesPage.tsx`, `NodesPage.tsx`, `NodeOverridesPage.tsx`, `MapPage.tsx`)
confirms the inconsistency is real, not theoretical:

- `AnalyticsPage.tsx`'s informal `apiFetch<T>()` (lines 219–223) checks
  `response.ok` and throws `new Error(\`HTTP ${res.status}\`)` on failure,
  discarding the response body entirely.
- `App.tsx`'s `apiDisconnect()` and `apiConnect()` (lines 125–134) call `fetch()`
  and never check `response.ok` at all — a `400`/`503` from
  `POST /api/devices/connect` is silently treated as success.
- `NodeOverridesPage.tsx`'s save handler (line 102) does check `response.ok`,
  but decodes the failure body with `res.text()`, not `res.json()` — even
  though `API_PROMISES.md` documents every REST error body as JSON.
- `MapPage.tsx` builds query strings by raw template-literal interpolation of
  `lat`/`lon`/`radiusKm` (lines 635, 1278) without `encodeURIComponent`, while
  it does correctly encode `since` elsewhere (line 435) — encoding is applied
  inconsistently even within one file.
- No call site in the frontend passes an `AbortSignal`; several `useEffect`
  hooks (e.g. `AnalyticsPage.tsx`'s per-tab fetches) have no cancellation on
  unmount or dependency change, so a fast filter change can let a stale
  response overwrite fresher state.

Because the client TASK-013 introduces will mediate every REST call the
frontend makes — across devices, analytics, coverage, proposals, overrides,
and configuration — an error in its shared core (e.g. silently swallowing a
non-2xx status, or decoding an error body inconsistently) is not a
single-feature bug; it reproduces itself in every module built on top of it.
That reach, not any complexity in the client's own logic, is why this
contract exists: to pin down one observable, testable convention before six
modules are built against it, rather than let each module invent its own
interpretation of "handle the response."

## Scope

### Included

- The shared client core's request/response handling contract: `response.ok`
  interpretation, structured error decoding (network failure, non-2xx status,
  malformed/non-JSON body), query-parameter encoding, `AbortSignal` support,
  and empty/204/no-body response handling.
- The public shape (not the internal implementation) of the six feature
  modules (`devices`, `analytics`, `coverage`, `proposals`, `overrides`,
  `configuration`) insofar as they are required to share the one core and
  therefore inherit its error/response conventions uniformly.
- The decoded error value's shape as seen by calling code (page components),
  since that is what every future page-level `.catch()` / error-state handler
  depends on.

### Excluded

- The REST API's own request/response contract (status codes, body shapes,
  endpoint behavior) — that is `API_PROMISES.md`'s scope, already documented
  and not restated here except where quoted verbatim to ground a frontend
  decoding decision. This contract does not renegotiate what the daemon
  promises; it only defines how the frontend client consumes what is already
  promised.
- The WebSocket client (`ForemanClient`, covered by TASK-010's tests) and its
  reconnect/event-envelope behavior — out of scope; TASK-013 is REST-only per
  its own task description.
- Which specific endpoints each feature module exposes, or the shape of any
  individual endpoint's response — those are pass-through types mirroring
  `API_PROMISES.md` and `packages/shared/src/types.ts`; this contract does not
  enumerate them.
- Migration sequencing/scope (which features move to the new client in this
  PR vs. later) — that is TASK-013's own acceptance-criteria concern, not a
  behavioral contract concern.
- Any caching, retry, deduplication, or request-coalescing behavior. None is
  required by this contract; none should be silently added.
- UI-level presentation of errors (toast vs. inline banner vs. console log) —
  each page decides how to surface a decoded error; this contract only
  guarantees the decoded error's shape is consistent for every caller to
  branch on.

## Actors

- **Page components** (`AnalyticsPage.tsx`, `MapPage.tsx`, `NodeOverridesPage.tsx`,
  `DeviceConfigPage.tsx`, `MessagesPage.tsx`, `NodesPage.tsx`, `App.tsx`, and
  their future replacements/splits such as TASK-020/TASK-021): the sole
  consumers of the six feature modules. They call module functions, receive
  either a resolved typed value or a rejected promise, and branch on that
  outcome.
- **The six feature modules** (`packages/web/src/api/{devices,analytics,
  coverage,proposals,overrides,configuration}.ts`): thin, per-endpoint typed
  wrappers. They do not implement their own `response.ok`/error/`AbortSignal`
  logic; they delegate to the shared core.
- **The shared client core** (`packages/web/src/api/client.ts` or equivalent —
  exact filename is implementation discretion): the single place that
  performs the `fetch()` call, checks `response.ok`, decodes errors, encodes
  query parameters, and handles empty responses. This is the actor whose
  behavior this contract primarily constrains.
- **The daemon REST API** (`packages/daemon/src/routes/*.ts`): the
  counterparty, whose response shapes are given (not designed) by
  `API_PROMISES.md`.

## Inputs and outputs

- **Core request function** — conceptually:
  `request<T>(path: string, options?: { method?, query?, body?, signal? }): Promise<T>`
  - Input: a path (e.g. `/api/analytics/snr-history`), optional query
    parameters as a plain object, optional JSON-serializable body, optional
    `AbortSignal`.
  - Output: resolves with the parsed JSON body typed `T` on success (`2xx`);
    resolves with `undefined`/`void` for a `204`/empty body (see Required
    behavior); rejects with a `ClientError` (see Interfaces) on any failure
    mode.
- **Feature module functions** (e.g. `devices.connect(port, name)`,
  `overrides.update(nodeId, patch)`, `analytics.snrHistory(params)`): each
  wraps one endpoint documented in `API_PROMISES.md`, typed with that
  endpoint's documented request/response shape, and returns whatever the core
  returns for that call (typed value or rejected `ClientError`).
- Query parameters: values are plain JS values (`string | number | boolean |
  undefined`); `undefined` values are omitted from the query string entirely
  (not serialized as `"undefined"`), matching the optional nature of params
  like `deviceId`/`since`/`nodeId` throughout `API_PROMISES.md`.

## Preconditions

- The daemon is reachable at the frontend's configured base path (`/api/...`,
  same-origin per current call sites — no call site constructs an absolute
  URL with a different host).
- Every endpoint a feature module wraps is already documented in
  `API_PROMISES.md`; this contract assumes that document is authoritative for
  status codes and body shapes and does not re-derive them.
- The daemon's REST error bodies are as documented in `API_PROMISES.md`'s
  "Error Responses" section: `{ error: { fieldErrors, formErrors } }` for Zod
  validation failures, and `{ error: string }` for runtime errors. The core's
  error decoding (below) is built to handle both shapes, plus the case where
  the body is not JSON at all (e.g. a proxy-generated HTML error page, or a
  network-level failure with no body).

## Required behavior

### `response.ok` handling

- The core checks `response.ok` (i.e., `status` in the `200`–`299` range) on
  every completed fetch. A non-`ok` response is never returned to the caller
  as a resolved value under any circumstance — it always produces a rejected
  promise via the error-decoding path below. This closes the gap in
  `App.tsx`'s current `apiConnect()`/`apiDisconnect()`, which today ignore
  `response.ok` entirely.

### Structured error decoding

- On a non-`ok` response, the core attempts to parse the response body as
  JSON. Three outcomes are distinguished, and all three normalize to the same
  rejected-value shape (see `ClientError` in Interfaces) so that every caller
  can branch on the same fields regardless of which failure mode occurred:
  1. **Body is valid JSON matching `{ error: string }`** (documented "REST
     runtime errors" shape): `ClientError.message` is that string;
     `ClientError.status` is the HTTP status; `ClientError.fieldErrors` is
     `undefined`.
  2. **Body is valid JSON matching `{ error: { fieldErrors, formErrors } }`**
     (documented Zod validation-error shape): `ClientError.fieldErrors` is
     set to the `fieldErrors` object; `ClientError.message` is a
     human-readable summary derived from `formErrors`/`fieldErrors` (exact
     derivation is implementation discretion, but must never be empty —
     fall back to a generic `"Request failed validation"` if both are
     empty); `ClientError.status` is the HTTP status.
  3. **Body is missing, empty, or not valid JSON** (network-level failure,
     proxy/gateway error page, or a `fetch()` rejection before any response
     was received at all): `ClientError.message` is a client-generated
     fallback (implementation discretion, e.g. `"HTTP {status}"` or
     `"Network error"` for a pre-response failure); `ClientError.status` is
     the HTTP status if one was received, or `undefined` for a pre-response
     network failure (e.g. DNS/connection refused, or `TypeError: Failed to
     fetch`); `ClientError.fieldErrors` is `undefined`.
- In every one of the three outcomes above, the value the caller's rejected
  promise resolves to (i.e. the `catch`/`.catch()` argument) is always an
  instance of the same `ClientError` type — callers never need to
  `instanceof`-check against multiple possible thrown types, and never
  receive a bare `Error` with only a `message` (unlike today's `AnalyticsPage.tsx`
  `apiFetch`, which throws a plain `Error`).
- An `AbortSignal`-triggered cancellation (see below) is the one exception:
  it rejects with the `AbortError` `DOMException` that `fetch()` itself
  produces, not a `ClientError`. Callers that pass a signal are expected to
  distinguish cancellation from a real failure (e.g. via `err.name ===
  "AbortError"`) before treating a rejection as an error to display.

### Query-parameter encoding

- The core provides one query-encoding path used by every feature module
  that accepts query parameters (`since`, `deviceId`, `nodeId`, `limit`,
  `bucket`, `port` filters, coverage `lat`/`lon`/`radiusKm`/`altitudeM`,
  etc.). Every value is passed through `URLSearchParams` (or equivalent),
  which URL-encodes it — closing the gap in `MapPage.tsx`'s current raw
  template-literal interpolation of unencoded `lat`/`lon` values.
- A query parameter whose value is `undefined` is omitted from the resulting
  query string (not stringified as the literal text `"undefined"`). A
  parameter whose value is `null` is implementation discretion (may be
  omitted or serialized as `"null""`) since no current endpoint's optional
  parameters are ever explicitly `null` rather than absent.
- Parameter order in the resulting query string is not a caller-visible
  guarantee (no endpoint in `API_PROMISES.md` is order-sensitive).

### `AbortSignal` support

- Every core request function accepts an optional `signal: AbortSignal` and
  passes it through to the underlying `fetch()` call unchanged. The core
  itself does not create, manage, or combine `AbortSignal`s (e.g. no
  built-in per-request timeout) — that remains the caller's responsibility,
  consistent with "no caching/retry/timeout behavior" in Scope/Excluded.
- Passing a signal is optional at every call site; omitting it preserves
  today's behavior of the request running to completion regardless of
  component unmount.

### Empty / `204` / no-body response handling

- For a response with status `204` (per `API_PROMISES.md`, used by
  `DELETE /api/devices/:id` and `DELETE /api/node-overrides/:nodeId`, and any
  future `204` response), the core does not attempt to parse a JSON body. The
  request function's promise resolves with `undefined` (not `null`, not an
  empty object, not a parse error) — this is a fixed, callable convention
  every feature module's `DELETE`-style wrapper can rely on without its own
  status-code special-casing.
- For any other `2xx` response with an empty body (e.g. a `200 OK` with
  `Content-Length: 0`, if the daemon ever returns one), the core treats it
  the same as a `204`: resolves with `undefined` rather than throwing a JSON
  parse error. A `2xx` response whose body is present but fails to parse as
  JSON is treated as a client-side bug/unexpected-response condition and
  rejects (implementation discretion on exact error shape for this
  specific, currently-hypothetical case — no documented `2xx` endpoint in
  `API_PROMISES.md` returns a non-JSON, non-empty body today).

## Postconditions and invariants

- Every one of the six feature modules' functions, for every endpoint they
  wrap, exhibits the `response.ok`, error-decoding, query-encoding,
  `AbortSignal`, and empty-response behavior specified above identically —
  there is exactly one implementation of each of these concerns (the shared
  core), not six independent ones. A module reimplementing any part of this
  logic itself (e.g. its own `response.ok` check) violates this contract even
  if its result happens to look correct.
- A caller can always distinguish "request succeeded with no meaningful body"
  (resolves `undefined`) from "request failed" (rejects with `ClientError` or
  `AbortError`) — the core never resolves a non-`ok` response, and never
  rejects a `2xx` response solely because its body was empty.
- The decoded `ClientError`'s `status` and `fieldErrors` fields are present
  (possibly `undefined`) on every rejection produced by the core's own error
  path, so a caller can write one generic error handler (e.g. "if
  `fieldErrors` present, highlight those form fields; else show
  `error.message`") that works across all six modules without per-module
  branching.

## Failure behavior

- **Network failure before any response is received** (DNS failure,
  connection refused, offline): rejects with a `ClientError` whose `status`
  is `undefined` and whose `message` is a client-generated fallback string
  (see Required behavior, outcome 3). This is a new, defined behavior; today
  most call sites either don't catch this at all (`App.tsx`) or catch it and
  silently swallow it (`MapPage.tsx`'s traceroute fetch, `NodesPage.tsx`'s
  hw-model fetch) — this contract does not mandate what callers do with the
  rejection (that remains a per-page UX decision, excluded above), only that
  the client always surfaces one consistently-shaped rejection for the page
  to decide what to do with.
- **Non-2xx status with a documented JSON error body**: rejects with a
  `ClientError` carrying the decoded `message`/`fieldErrors` per Required
  behavior. Never resolves.
- **Non-2xx status with an undocumented/non-JSON body** (e.g. an HTML error
  page from a reverse proxy in front of the daemon, or a body that doesn't
  match either documented error shape): rejects with a `ClientError` using
  the fallback path (outcome 3) rather than throwing an unhandled JSON-parse
  exception. The client must not let a malformed error body itself become an
  unrelated, harder-to-diagnose crash (e.g. `SyntaxError: Unexpected token <`
  from calling `.json()` on an HTML body) — this is the specific defect class
  this contract exists to close, since it's easy for six independently
  written modules to each get this differently wrong.
- **Request aborted via `AbortSignal`**: rejects with the `AbortError`
  `DOMException`, not a `ClientError` (see Required behavior). Feature
  modules must not swallow, wrap, or reinterpret this as a `ClientError`.
- **`2xx` response with a body that fails to parse as JSON**: rejects (see
  Required behavior's empty-response bullet); does not silently resolve with
  a partial or `null` value.

## Interfaces

```ts
// packages/web/src/api/client.ts (exact filename is implementation discretion)

export interface ClientError extends Error {
  /** HTTP status code, if a response was received. Undefined for a
   *  pre-response network failure. */
  status: number | undefined;
  /** Present only when the server returned the documented Zod
   *  validation-error shape ({ error: { fieldErrors, formErrors } }). */
  fieldErrors: Record<string, string[]> | undefined;
}

export interface RequestOptions {
  query?: Record<string, string | number | boolean | undefined>;
  body?: unknown;              // JSON-serialized; caller does not set Content-Type manually
  signal?: AbortSignal;
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE"; // default "GET"
}

// Resolves T on 2xx-with-body; resolves undefined on 204/empty 2xx;
// rejects ClientError on any failure; rejects AbortError on cancellation.
export function request<T>(path: string, options?: RequestOptions): Promise<T | undefined>;
```

```ts
// packages/web/src/api/{devices,analytics,coverage,proposals,overrides,configuration}.ts
// Each module exports one function per endpoint it wraps, e.g.:

// devices.ts
export function listDevices(signal?: AbortSignal): Promise<DeviceInfo[]>;
export function connectDevice(port: string, name: string, signal?: AbortSignal): Promise<DeviceInfo>;
export function disconnectDevice(id: string, signal?: AbortSignal): Promise<void>;
// ...

// overrides.ts
export function listOverrides(signal?: AbortSignal): Promise<NodeOverride[]>;
export function updateOverride(nodeId: number, patch: Partial<NodeOverride>, signal?: AbortSignal): Promise<NodeOverride>;
export function deleteOverride(nodeId: number, signal?: AbortSignal): Promise<void>;
```

The exact function names/signatures per endpoint are implementation
discretion (they are not observable to anything outside `packages/web`); what
this contract fixes is that every one of them is typed against the request/
response shapes in `API_PROMISES.md`, and every one of them delegates to
`request<T>()` (or an equivalent single core entry point) for the
conventions specified above rather than reimplementing them.

## UX expectations

N/A as a distinct section beyond what's stated in Failure behavior and
Scope/Excluded: this contract governs data-fetching plumbing, not visual
presentation. It requires that every page always has enough information
(a consistently-shaped `ClientError` or an `AbortError`) to build whatever
error UI it wants, but does not mandate what that UI looks like.

## Validation requirements

- Unit tests (via the `vitest` infra TASK-010 added to `packages/web`) for
  the shared core in isolation, covering at minimum: (a) a `2xx` JSON
  response resolves the parsed body; (b) a `204` response resolves
  `undefined`; (c) a non-`ok` response with `{ error: string }` rejects with
  a `ClientError` carrying that message; (d) a non-`ok` response with
  `{ error: { fieldErrors, formErrors } }` rejects with a `ClientError`
  carrying `fieldErrors`; (e) a non-`ok` response with a non-JSON body
  rejects with a fallback `ClientError` rather than throwing an unhandled
  parse error; (f) a pre-response network failure rejects with a
  `ClientError` whose `status` is `undefined`; (g) an aborted request (signal
  already aborted, or aborted mid-flight) rejects with `AbortError`, not
  `ClientError`; (h) query parameters with `undefined` values are omitted
  from the constructed URL, and parameters with special characters are
  correctly encoded.
- No new test is required per individual feature-module function beyond
  confirming it delegates to the shared core with the correct path/method/
  params — the core's own test coverage above is what substantively
  validates behavior, per this contract's "one implementation, six thin
  wrappers" design.
- Manual smoke test (per TASK-013's own validation requirements): the
  migrated analytics feature continues to render correctly end-to-end
  against a running daemon, including at least one intentionally-triggered
  error case (e.g. stopping the daemon mid-request) to visually confirm the
  page doesn't crash on a network failure.

## Open questions

1. **Exact `ClientError` message derivation for the `fieldErrors` case.**
   This contract requires a non-empty, human-readable `message` but leaves
   the precise derivation (e.g. join `formErrors`, or synthesize from
   `fieldErrors` keys) to implementation discretion. If the human wants a
   specific format (e.g. for consistent toast text), that should be
   specified before implementation; otherwise this is a low-risk deferral.
2. **Should `2xx`-with-unparseable-body be a `ClientError` or a different
   error type?** No current endpoint exercises this path, so this contract
   states the requirement (must reject, must not silently resolve) without
   mandating the exact rejected value's shape. Low risk either way since it
   is presently unreachable in practice.
3. **Whether this contract's scope is actually justified**, i.e. the
   question TASK-013 itself raised. See the drafting agent's assessment
   delivered alongside this document — this contract takes the position that
   the shared-core conventions above (error decoding, `response.ok`, empty-
   response handling) are worth locking down because they are the one part
   of TASK-013 with six independent, easy-to-diverge implementations if left
   to acceptance criteria alone, while explicitly declining to duplicate
   anything `API_PROMISES.md` already promises. The human should confirm or
   reject that framing before this moves to Approved.
