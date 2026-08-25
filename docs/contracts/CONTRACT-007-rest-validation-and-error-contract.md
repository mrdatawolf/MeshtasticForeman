# CONTRACT-007: REST Validation and Error Contract

Status: Accepted
Approved by: Patrick
Approved date: 08/24/26
Related tasks: TASK-027 (depends on TASK-026, TASK-014)

## Purpose

TASK-027 replaces ad hoc manual casting of `req.query`/`req.params`/`req.body`
across the daemon's REST route files with Fastify/Zod schemas. A
repository-wide read of every route file confirms the inconsistency is real
and, more importantly, that validation coverage today is uneven: some inputs
are already checked by hand (`Number.isFinite`, range checks, `Zod` +
`safeParse` in `devices.ts`), many are silently coerced with a fallback
default on bad input (`Number(x) || default`), and a few crash paths exist
where malformed input reaches SQL or property access with no check at all.

Because this task's own stated risk ("the task most likely to introduce an
externally-visible breaking change") is that consistent, strict validation
will start rejecting requests that today succeed (even if the "success" is
semantically wrong — e.g. a garbage `since` value silently becoming "no
filter" instead of an error), this contract exists to (a) fix one
validation-error response shape before six-plus route files each invent
their own, and (b) enumerate, file by file, every place where tightening
validation changes what a request that succeeds today will do tomorrow — so
that change is a reviewed decision, per TASK-027's own acceptance criteria,
not a side effect discovered after implementation.

This contract does not decide those newly-rejected-input questions itself;
see Open questions.

**Observed pre-implementation file layout**: at the time of drafting,
TASK-026 (splitting `analytics.ts` by domain) is in `tasks/in-progress/` but
`packages/daemon/src/routes/analytics.ts` is still a single ~1250-line file
with no split yet applied. Everything below describing "analytics.ts" refers
to that single file's current endpoints; if TASK-026 completes first, its
domain modules inherit this contract's requirements unchanged — this
contract governs behavior per endpoint, not per file.

## Scope

### Included

- One consistent validation-error response shape (status code + body) for
  Zod schema failures, used by every REST route file.
- Shared, reusable Zod schemas for parameter shapes that genuinely repeat
  across multiple endpoints: device ID, `since`/time-range, `nodeId`, and
  bounded `limit`/`offset`.
- Enumeration of current manual-casting patterns per route file (this
  contract's own drafting deliverable, reproduced below) so implementation
  has a checklist rather than needing to re-derive it via its own grep pass.
- Enumeration of specific inputs that succeed (however oddly) today under
  manual casting but would be newly rejected under the shared schemas above,
  so the human can approve or reject each one explicitly.

### Excluded

- WebSocket command validation — already covered by
  `packages/shared/src/ws-protocol.ts`'s `clientCommandSchema` (TASK-009).
  Not restated here.
- Response-body schemas / response serialization behavior beyond what is
  already true today. Fastify's `schema.response` validation is not required
  by this contract; TASK-027's scope note mentions "important responses" but
  this contract treats that as implementation discretion unless the human
  says otherwise (see Open questions).
- Business-logic error responses that are not schema-validation failures
  (e.g. `404 Not found`, `503 DB not available`) — these already use the
  documented `{ error: string }` shape (`API_PROMISES.md`, "REST runtime
  errors") and this contract does not change them.
- The raw-SQL-body `POST /api/elevation-cache/import` endpoint's actual
  content (the SQL text itself) — Zod can only usefully assert "non-empty
  string," identical to today's check. Whether an authenticated REST
  endpoint that executes arbitrary client-supplied SQL text is an acceptable
  design is a pre-existing question this contract does not raise or resolve
  (out of scope for a validation-shape contract); flagged only so it is not
  mistaken for something TASK-027 fixes.
- `packages/web/src/api/client.ts`'s consumption of these error shapes —
  already fixed by CONTRACT-002, which this contract intentionally aligns
  with rather than duplicates or renegotiates.
- TASK-026's file-split mechanics themselves.

## Actors

- **REST route handlers** in `packages/daemon/src/routes/{analytics,devices,
  coverage,proposals,terrain-cache}.ts` (or `analytics.ts`'s post-TASK-026
  domain modules) — the code this contract constrains.
- **Fastify** — the HTTP framework; whether validation is wired via
  Fastify's native `schema` route option, a Zod type-provider plugin, or
  manual `schema.safeParse()` calls (the pattern `devices.ts` already uses
  for `connectBodySchema`/`nodeOverrideBodySchema`) is implementation
  discretion. This contract fixes the JSON shape that reaches the client,
  not the mechanism that produces it — see Required behavior's note on
  Fastify's own default AJV-style error format, which must not leak through
  unmodified.
- **REST API consumers**: the frontend (`packages/web/src/api/*` per
  CONTRACT-002/TASK-013), and any external script or operator hitting the
  API directly (e.g. via curl), both of which observe whatever status/body
  this contract fixes.

## Inputs and outputs

### Current manual-casting inventory (drafting deliverable)

**`analytics.ts`** (all query-string only; no path params, no bodies):

| Endpoint | Param | Current handling | Validated today? |
|---|---|---|---|
| snr-history, telemetry-history, position-history | `nodeId` | `Number(nodeId)`, `Number.isFinite` check → 400 `{error:"Invalid nodeId"}` | Yes |
| all `since`-accepting endpoints (11 of them) | `since` | `parseSince()`: accepts `/^(\d+)(h|d)$/` shorthand, the literal `"all"`, or any string `new Date()` can parse; **unparseable input silently returns `null`**, i.e. "no time filter" | **No** — bad input never errors, it silently widens the query |
| message-volume, packet-timeline, node-activity | `bucket` | exact string match (`"hour"`/`"day"` or `"minute"`/`"hour"`) → 400 if not one of those | Yes |
| busiest-nodes | `limit` | `Math.min(100, Math.max(1, Number(limit) \|\| 20))` — non-numeric silently falls back to default `20` | **No** |
| position-history | `limit` | `Math.min(10_000, Math.max(1, parseInt(...) \|\| 2000))` — same silent-fallback pattern | **No** |
| packet-log | `limit`, `offset` | same silent-fallback/clamp pattern (`\|\| 500`, `\|\| 0`) | **No** |
| packet-log, packet-log.csv | `portnum` | passed straight into a SQL param; any string accepted, unknown values just match 0 rows | **No** (not obviously wrong to leave unvalidated — see Open questions) |
| all endpoints | `deviceId` | passed straight into a SQL param as a plain string; no UUID/format check anywhere in this file | **No** |

**`devices.ts`**:

| Endpoint | Input | Current handling | Validated today? |
|---|---|---|---|
| `POST /api/devices/connect` | body | `connectBodySchema` (Zod) + `safeParse`, 400 with `result.error.flatten()` on failure | Yes — **this is the existing precedent for the error shape below** |
| `PUT /api/node-overrides/:nodeId` | body | `nodeOverrideBodySchema` (Zod) + `safeParse`, same flatten() shape | Yes |
| `GET /api/devices/:id/nodes`, `GET /api/devices/:id/config`, `DELETE /api/devices/:id` | `:id` | cast `as { id: string }`, no format check at all | **No** |
| `DELETE /api/devices/:id/messages/:nodeId` | `:nodeId` | `Number(rawNodeId)`, `Number.isInteger && >= 0` → 400 `{error:"Invalid nodeId"}` | Yes |
| `PUT /api/node-overrides/:nodeId` | `:nodeId` | `Number(...)`, `Number.isInteger && > 0` → 400 | Yes (note: `> 0` here vs. `>= 0` on the messages route above — not identical) |
| `DELETE /api/node-overrides/:nodeId` | `:nodeId` | `Number(...)`, **no check at all** — a non-numeric value becomes `NaN` and is passed directly into `db.query(...)` | **No** |
| `GET /api/traceroutes` | `since` | `new Date(since)`, `isNaN` check → 400 `{error:"Invalid 'since' date"}` | Yes — **but this is a stricter/different `since` grammar than `analytics.ts`'s `parseSince`, and rejects rather than silently ignores** |
| `GET /api/traceroutes` | `deviceId` | plain string, no format check | **No** |

**`coverage.ts`**:

| Endpoint | Input | Current handling | Validated today? |
|---|---|---|---|
| `GET /api/coverage/viewshed`, `GET /api/elevation` | `lat`, `lon` | `Number(...)`, full range check (`-90..90`/`-180..180`) → 400 `{error:"Invalid lat/lon"}` | Yes |
| `GET /api/coverage/viewshed` | `altitudeM`, `radiusKm`, `radials` | `Math.min/max(..., Number(x) \|\| default)` — non-numeric silently falls back to default; out-of-range values silently clamp rather than reject | **No** |
| `DELETE /api/coverage/viewshed` | `lat`, `lon` | only `isFinite` checked, **no range check** (unlike the GET above) | Partially — inconsistent with GET |
| `DELETE /api/coverage/viewshed` | `radiusKm` | `Number(q.radiusKm ?? 20)`, **no check at all**; `NaN` can reach the SQL params | **No** |

**`proposals.ts`**:

| Endpoint | Input | Current handling | Validated today? |
|---|---|---|---|
| `POST /api/proposals` | body | manual: `req.body as Record<string, unknown>`, then per-field `Number()`/range checks with 400 on failure | Yes, *if* `req.body` is already an object — see gap below |
| `POST`/`PATCH /api/proposals/:id` | body | **no top-level shape check**: if `req.body` is `null`, an array, or a primitive, property access (`body.name`, `body.lat`, ...) either throws (uncaught → Fastify's default 500) or silently reads `undefined` off an array/primitive | **No** — this is a real crash-risk gap, not just a leniency gap |
| `PATCH /api/proposals/:id` | body | same per-field pattern as POST, partial-update style (`!== undefined` checks against current row) | Yes, same object-shape caveat as above |
| `PATCH`/`DELETE /api/proposals/:id` | `:id` | plain string, no format check (proposal IDs are DB-generated UUIDs per `migrations.ts`) | **No** |

**`terrain-cache.ts`**:

| Endpoint | Input | Current handling | Validated today? |
|---|---|---|---|
| `POST /api/elevation-cache/import` | body (raw `text/plain` SQL) | non-empty-string check → 400 `{error:"Expected a SQL dump..."}` | Yes, to the extent Zod could add anything (see Scope/Excluded) |

### Shared shapes identified

Cross-referencing the tables above, four parameter shapes are genuinely
reused (not superficially similar) across multiple endpoints and multiple
files, and should be defined once:

1. **`deviceId`** — a UUID string (`devices.ts`'s `id` param is generated via
   `randomUUID()`; `ws-protocol.ts`'s `clientCommandSchema` already validates
   every WebSocket `deviceId` as `z.string().uuid()`). Appears, unvalidated,
   in nearly every `analytics.ts` endpoint, three `devices.ts` path/query
   params, and `traceroutes`'s `deviceId` query filter. Recommended shape:
   `z.string().uuid()`, reused as both a path-param schema and an optional
   query-param schema.
2. **`since`** — a time-range string. **Not currently one shape**: analytics
   silently ignores unparseable input, `traceroutes` rejects it outright.
   A single reusable schema requires picking one behavior first (see Open
   questions) before it can be written; this contract flags the shared
   *surface* (shorthand `\dh`/`\dd`, the literal `"all"`, or an ISO
   datetime) without prescribing which failure behavior wins.
3. **`nodeId`** — a numeric mesh node ID, coercible from a query/path string.
   Existing constraints differ slightly per call site (`>= 0` vs `> 0` vs no
   check) — a shared schema needs one canonical constraint, with any
   intentional per-endpoint difference called out explicitly rather than
   silently unified.
4. **`limit`/`offset`** — a bounded positive integer, coerced from a query
   string. The *shape* (positive int, silently-clamped or rejected outside
   `[1, max]`) is shared, but the bound itself differs per endpoint
   (`busiest-nodes` max 100, `packet-log` max 5000, `position-history` max
   10000) — this should be a small parameterized schema factory
   (`limitSchema(max, default)`), not one hardcoded constant.

`lat`/`lon`/`radiusKm`/`altitudeM`/`radials` (`coverage.ts`) and
`lat`/`lon`/`altitudeM`/`modemPreset` (`proposals.ts`) are **not** the same
shared shape as each other despite superficial similarity — `coverage.ts`'s
values describe a viewshed query point/radius with coverage-specific bounds
(`radiusKm` max 50, `radials` max 72), while `proposals.ts`'s describe a
persisted proposal record with different bounds (`modemPreset` 0–8) and no
`radiusKm`/`radials` at all. Each file keeps its own schema for these; do not
force a merge that isn't actually the same public contract.

### Validation-error response

- **Status code**: `400`.
- **Body shape**: `{ "error": { "fieldErrors": Record<string, string[]>,
  "formErrors": string[] } }` — i.e. exactly `zodError.flatten()`'s output,
  wrapped in `{ error: ... }`. This is not a new shape: it is the shape
  `devices.ts`'s `connectBodySchema`/`nodeOverrideBodySchema` already
  produce today, the shape `API_PROMISES.md`'s "Error Responses" section
  already documents as "REST validation errors," and the exact shape
  `packages/web/src/api/client.ts`'s `errorFromResponse()`/`ClientError`
  already special-cases (`fieldErrors` populated, `message` derived from
  `formErrors`/`fieldErrors`). Reusing it rather than inventing a fourth
  variant closes the risk TASK-027's context note raises and keeps the
  frontend's existing decoding logic correct with zero changes.
- This applies uniformly to query-string, path-parameter, and body
  validation failures — not just body validation as in today's two
  `devices.ts` examples.

## Preconditions

- `zod` is already a dependency and is already used for both
  `ws-protocol.ts`'s command schemas and `devices.ts`'s two body schemas —
  no new dependency is introduced.
- `API_PROMISES.md`'s "Error Responses" section already documents both the
  Zod-validation-error shape and the plain-string runtime-error shape as the
  two REST error shapes; this contract does not change that document's
  existing promises, only extends the first shape's use to every route file
  instead of two schemas in one file.

## Required behavior

- Every query-string, path-parameter, and body input enumerated as "**No**"
  in the inventory above gains a Zod schema. Every input already validated
  ("Yes") keeps at least equivalent strictness — this contract does not
  permit *loosening* an existing check while tightening others.
- On any schema failure, the response is exactly the validation-error shape
  above: `400`, `{ error: { fieldErrors, formErrors } }`. If the chosen
  validation mechanism is Fastify's own `schema` route option (AJV-based),
  its default error format (which is not Zod's `flatten()` shape) must not
  reach the client unmodified — a custom error handler or an
  AJV-error-to-`flatten()`-shape adapter is required if that mechanism is
  chosen. If the mechanism is Zod's own `safeParse()` (matching `devices.ts`
  precedent) or a Zod-aware Fastify type-provider that already emits Zod
  errors, no adapter is needed. Which mechanism to use is implementation
  discretion; producing this exact body shape regardless of mechanism is
  not.
- Business-logic (non-schema) failures — device not found, DB unavailable,
  proposal not found, elevation service unreachable — are unchanged by this
  contract and keep using `{ error: string }` at whatever status code they
  use today (`404`, `503`, `502`).
- The four shared schemas (`deviceId`, `since`, `nodeId`, `limit`/`offset`
  factory) are each defined once in a shared location (exact module path is
  implementation discretion, e.g. `routes/schemas.ts` or per-file `import`
  from a common module) and imported by every route file/module that needs
  them, rather than six independent near-duplicate `z.object({...})` calls.

## Postconditions and invariants

- For any given REST endpoint, a request whose query/params/body fail
  schema validation never reaches handler business logic (no DB query, no
  external fetch) — validation happens before any side-effecting work,
  matching today's `devices.ts` `safeParse` pattern.
- No REST route file constructs its own ad hoc `{ error: ... }` shape for a
  schema-validation failure once this task is complete; the only two REST
  error body shapes in the codebase are the validation shape above and the
  existing `{ error: string }` runtime shape.
- A caller cannot observe Fastify's raw default AJV validation-error format
  from any endpoint covered by this contract, regardless of which
  validation mechanism a given route uses internally.

## Failure behavior

Covered above (Required behavior) for the general case. The specific,
per-endpoint newly-rejected-input cases this task's own risk note asks to be
enumerated are listed in Open questions rather than here, because this
contract does not have authority to decide them — only to make sure they are
decided rather than defaulted into.

## Interfaces

```ts
// routes/schemas.ts (exact path is implementation discretion)
import { z } from "zod";

export const deviceIdSchema = z.string().uuid();

// Exact accepted grammar for `since` depends on Open questions #1 below —
// shown here as the current parseSince() surface for reference only:
export const sinceSchema = z
  .union([
    z.literal("all"),
    z.string().regex(/^\d+[hd]$/),
    z.string().datetime({ offset: true }).or(z.string()), // exact ISO strictness: TBD
  ])
  .optional();

export const nodeIdSchema = z.coerce.number().int(); // exact sign constraint: TBD, see Open questions #2

export function limitSchema(max: number, defaultValue: number) {
  return z.coerce.number().int().min(1).max(max).default(defaultValue);
}

// Validation-error response body, matching devices.ts precedent and
// API_PROMISES.md's documented "REST validation errors" shape:
export interface ValidationErrorBody {
  error: {
    fieldErrors: Record<string, string[]>;
    formErrors: string[];
  };
}
```

## UX expectations

N/A as a distinct concern beyond what Required behavior states: this is a
backend HTTP-boundary contract. Its only externally-visible effect is that
`packages/web/src/api/client.ts`'s existing `fieldErrors` decoding path
(already implemented per CONTRACT-002) becomes reachable for endpoints that
previously never returned that shape. No frontend page currently branches on
`fieldErrors` from these specific endpoints, so this is new capability, not
a change to any existing UI behavior — TASK-027's validation requirements
already call for confirming the frontend still functions against the
newly-validated endpoints, which this contract does not restate.

## Validation requirements

- TASK-005's analytics test suite (`packages/daemon/src/__tests__/routes/
  analytics.test.ts`) currently asserts `{ error: "Invalid nodeId" }` (a
  plain-string shape) for `nodeId` validation failures on three endpoints.
  Under this contract's shape, those assertions must be updated to the
  `{ error: { fieldErrors, formErrors } }` shape rather than deleted or
  weakened, per TASK-027's own acceptance criteria.
- New test coverage is needed, at minimum, for: each shared schema's reject/
  accept boundary (`deviceId` non-UUID, `since` grammar edge cases per
  whatever Open questions #1 decides, `nodeId` non-numeric and sign
  boundary, `limit`/`offset` non-numeric and out-of-range per endpoint's own
  max); the `proposals.ts` non-object-body crash gap (`POST`/`PATCH` with a
  non-object JSON body must now return `400`, not an uncaught 500); the
  `DELETE /api/node-overrides/:nodeId` gap (non-numeric `nodeId` must now
  return `400` instead of reaching the DB with `NaN`).
- Manual smoke test: run the frontend (post TASK-013 typed client) against
  the newly-validated daemon and confirm normal use (valid inputs) is
  unaffected — this is the integration checkpoint TASK-027's own validation
  requirements already call for.

## Open questions

These are the newly-rejected-input and default-value decisions TASK-027's
"Risks and assumptions" section explicitly asks to be reviewed rather than
defaulted. None of them is resolved by this contract.

1. **`since`: reject vs. silently ignore unparseable values.** Today,
   `analytics.ts` treats an unparseable `since` (e.g. `?since=banana`) as
   "no time filter" (silently returns unfiltered/all-time data);
   `devices.ts`'s `/api/traceroutes` already rejects the same case with
   `400`. A single shared `since` schema must pick one behavior. Recommend
   reject-with-400 for consistency with `traceroutes` and with "stricter
   validation is the point of this task," but this silently *changes*
   ~11 analytics endpoints' current behavior for garbage `since` input from
   "succeeds with a wider-than-intended result set" to "400" — the human
   should confirm this is desired before implementation, since it is exactly
   the class of change TASK-027 flagged as its biggest risk.
2. **`deviceId`: enforce UUID format on every occurrence.** No `analytics.ts`
   or `devices.ts` endpoint currently checks `deviceId` format; a malformed
   value today just yields an empty result set (query matches no rows) or,
   for path params, proceeds to `deviceManager` methods that themselves
   handle an unknown ID however they already do. Under a shared
   `z.string().uuid()` schema, any non-UUID `deviceId` (including empty
   string, or a partial/truncated ID a user might paste) becomes a `400`
   instead of an empty/whatever-today's-fallback result. Recommend yes
   (device IDs are always daemon-generated UUIDs; a non-UUID value is never
   legitimate), but flagging since it touches nearly every analytics
   endpoint at once.
3. **`limit`/`offset`/`radiusKm`/`altitudeM`/`radials`: reject vs. clamp
   non-numeric or out-of-range input.** Today, all of these silently fall
   back to a hardcoded default (`Number(x) || default`) or clamp into range
   (`Math.min(max, Math.max(min, x))`) on bad input — never reject. A naive
   Zod `.min().max()` schema on a coerced number would instead reject
   out-of-range/non-numeric input with `400`. Two implementation paths exist
   with different observable behavior: (a) schema rejects (behavior change,
   simplest to write), or (b) schema clamps via `.transform()` to preserve
   today's lenient behavior exactly. The task's own framing ("consistent
   ... instead of ad hoc") leans toward (a), but this is a real behavior
   change across `analytics.ts` (`limit`, `offset`) and `coverage.ts`
   (`altitudeM`, `radiusKm`, `radials`) that the human should pick
   explicitly rather than have decided implicitly by whichever the
   implementer finds easier to write.
4. **`nodeId` sign constraint.** `devices.ts` currently uses `>= 0` on one
   route and `> 0` on another for what is nominally the same "mesh node ID"
   shape. A shared schema needs to pick one — is `0` a valid node ID? This
   contract does not know the answer and should not guess at a Meshtastic
   protocol fact; needs a human (or Meshtastic-protocol-documentation)
   answer before the shared `nodeId` schema is written.
5. **Response-body schema validation ("important responses") — in or out of
   this task's actual delivery?** TASK-027's scope note mentions "important
   responses" alongside query/param/body validation, but does not say which
   responses or what "important" means, and no current route file validates
   its own response shape today. This contract treats response validation
   as excluded/discretionary (see Scope) unless the human wants specific
   endpoints' responses schema-checked (e.g. to catch a future accidental
   shape drift) — if so, which endpoints should be named explicitly rather
   than left to implementer judgment, since "all of them" is a materially
   larger task than "the request side."
6. **`portnum` (packet-log/packet-log.csv): free string vs. enum.** Today
   any string is accepted (typos just match zero rows silently). Should this
   become a `z.enum([...])` of known `portnum_name` values? This would be a
   new, narrower kind of rejection (a valid-looking but misspelled portnum
   currently "succeeds" with an empty result; it would become `400`). Low
   risk either way, but the human should decide since it's a new
   constraint, not just tightening an existing one.
7. **`proposals.ts` non-object-body gap: severity of the fix.** The
   `POST`/`PATCH` handlers today can throw an uncaught exception (→ Fastify
   default 500) if `req.body` is not a JSON object at all (array, `null`,
   primitive). This is strictly a bug fix (500 → 400) rather than a
   stricter-validation-rejects-more-input case, and this contract assumes it
   should simply be fixed as part of adding the body schema — flagged here
   only so it isn't mistaken for a design decision needing the same
   deliberation as items 1–4 above.
