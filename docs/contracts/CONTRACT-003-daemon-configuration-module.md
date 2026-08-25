# CONTRACT-003: Daemon Configuration Module

Status: Accepted
Approved by:
Approved date:
Related tasks: TASK-014

## Purpose

TASK-014 replaces `packages/daemon`'s scattered, ad hoc `process.env` reads
with a single Zod-validated configuration module, loaded once at startup and
passed explicitly into the services that need it. A repository-wide read of
every current `process.env` read site confirms the risk TASK-014's own task
file names without hedging: every one of these fourteen variables is read
with its own inline default/parsing logic, repeated or subtly varied across
four files, with no shared validation and no fail-fast behavior for a
malformed value —

- `packages/daemon/src/index.ts` (11 sites): `API_PORT`, `API_HOST`,
  `WEB_DIST`, `MQTT_BROKER`, `MQTT_PORT`, `MQTT_USER`, `MQTT_PASS`,
  `MQTT_ROOT`, `ENABLE_MQTT`, `MESHTASTIC_PORT`, `MESHTASTIC_NAME`.
- `packages/daemon/src/db/open.ts` and `packages/daemon/src/db/client.ts`
  (one site each, independently duplicated): `PGLITE_DIR`.
- `packages/daemon/src/routes/coverage.ts` (one site): `ELEVATION_API_URL`.
- `packages/daemon/src/device/device-manager.ts` (one site): `BOT_ENABLED`.

Two concrete defects already exist in this scattered form and motivate the
fail-fast requirement below: `Number(process.env.API_PORT ?? 3750)` and
`Number(process.env.MQTT_PORT ?? 1883)` both silently produce `NaN` for a
non-numeric value (e.g. `API_PORT=abc`) rather than failing — `NaN` is then
passed into `app.listen({ port: NaN, ... })` or `MqttGatewayConfig.port`,
surfacing as a confusing failure deep inside Fastify or the `mqtt` client
rather than as a clear message about the misconfigured variable. Because
"every service depends on config" (TASK-014's words), a bug introduced while
"formalizing" these defaults — silently changing one, or introducing a new
input-coercion footgun (see the boolean-parsing pitfall in Required
behavior) — reproduces itself across the whole daemon rather than staying
contained to one feature. That reach is why this contract exists: to pin
down the exact schema, defaults, failure behavior, and consumer wiring
before implementation, rather than let each of those decisions be made
ad hoc during the diff.

## Scope

### Included

- The Zod schema for all fourteen environment variables above: exact type,
  optionality, and default value, cross-checked against today's code (not
  approximated).
- The typed configuration object's shape (flat vs. nested) and how it is
  constructed (`loadConfig()`, its signature, and when/where it is called).
- Fail-fast behavior: what "clear startup-time error" means concretely —
  exit code, message format, and whether all violations are reported or only
  the first.
- Which call sites receive the typed config object instead of reading
  `process.env` directly, per TASK-014's own enumerated list:
  `DeviceManager`, `MqttGateway`, the analytics routes module, the coverage
  routes module, and `index.ts` itself.
- The `ENABLE_MQTT`/`MQTT_BROKER` independence question the human flagged as
  worth resolving explicitly.
- `.env.example` consistency with the schema (every schema field documented
  there, or an explicit, reasoned exception).
- The specific boolean- and number-parsing pitfalls a naive Zod schema could
  introduce (see Required behavior) — since these are exactly the kind of
  silent default/behavior change TASK-014 itself flags as the main risk.

### Excluded

- Adding any new configuration option, or changing any existing default
  value. TASK-014 is explicit that this is "a structural change only";
  this contract enforces that boundary rather than relaxing it.
- Rewiring `packages/daemon/src/db/open.ts` or `packages/daemon/src/db/client.ts`
  to consume the new config module. TASK-014's own Scope/Included list names
  `DeviceManager`, `MqttGateway`, the analytics routes, the coverage routes,
  and `index.ts` as the config object's consumers — it does not name the db
  files. Those two files are additionally governed by the already-Accepted
  CONTRACT-001 (TASK-012 consolidation), which defines `PGLITE_DIR`'s
  resolution as existing, preserved behavior. Rewiring them here would touch
  files under a different contract's authority and risks a startup-ordering
  regression (see Open questions #1). `PGLITE_DIR` is still part of this
  contract's validated schema (so its type/format is checked, and so
  `.env.example` documents it consistently with the other thirteen
  variables) — it is simply not threaded into `db/open.ts`/`db/client.ts` as
  a constructor argument by this task.
- Any change to what `MqttGatewayConfig`'s shape looks like
  (`packages/daemon/src/mqtt/gateway.ts`'s existing `broker`/`port`/
  `username`/`password`/`rootTopic`/`selfAnnounceInterval` interface) — the
  config module's `mqtt` section is designed to map onto this existing shape
  unchanged, not to redesign it.
- Runtime config reload / live-editing. The config module is read once at
  process startup; nothing in this contract supports changing a running
  daemon's configuration without a restart.
- Validating device-specific or per-request configuration (e.g. request
  query parameters in `coverage.ts`'s `viewshed` handler) — this contract
  covers process-level environment configuration only.

## Actors

- **Daemon process entry point** (`packages/daemon/src/index.ts`): calls
  `loadConfig()` once, at the start of `main()`, and passes sections of the
  resulting object into `DeviceManager`, `MqttGateway`, and the route
  registration functions.
- **The config module** (new — file location is implementation discretion
  within `packages/daemon/src/`, e.g. `config.ts`; TASK-014 suggests
  `config.ts`/`config/`): the actor whose behavior this contract primarily
  constrains. Exposes `loadConfig()` and the Zod schema/inferred type.
- **`DeviceManager`** (`packages/daemon/src/device/device-manager.ts`):
  currently reads `process.env.BOT_ENABLED` directly inside
  `_handleMessage()`. Must instead read this from a config value supplied at
  construction time.
- **`MqttGateway`** (`packages/daemon/src/mqtt/gateway.ts`): already accepts
  a typed `MqttGatewayConfig` constructor argument; today `index.ts`
  constructs that argument from `process.env` inline. After this change,
  `index.ts` constructs it from the loaded config object instead — the
  gateway class itself does not change.
- **Analytics routes** (`packages/daemon/src/routes/analytics.ts`,
  `registerAnalyticsRoutes(app, db)`): reads **no** environment variable
  today (confirmed by repository-wide grep — see Open questions #2). Named
  as a config consumer in TASK-014's acceptance criteria regardless.
- **Coverage routes** (`packages/daemon/src/routes/coverage.ts`,
  `registerCoverageRoutes(app, db)`): reads `ELEVATION_API_URL` today as a
  module-level constant computed at import time. Must instead receive it
  via the config object, since a module-level `process.env` read cannot be
  validated or fail-fast'd by `loadConfig()`.
- **Human operator**: sets variables in the root `.env` file (per
  `CLAUDE.md`'s "all user defined variables will be held in root .env
  file") and experiences either a normally-starting daemon or the
  fail-fast startup error this contract defines.

## Inputs and outputs

- **`loadConfig(env: NodeJS.ProcessEnv = process.env): DaemonConfig`** — a
  plain, synchronous function (not a memoized/module-level singleton — see
  Required behavior for why). Input: an environment-variable-like object,
  defaulting to `process.env` so call sites need no arguments in normal
  operation while unit tests can inject fixtures. Output: the fully
  validated, typed `DaemonConfig` object, or a thrown error (see Failure
  behavior) if any variable fails validation.
- **`DaemonConfig`** (exact shape in Interfaces): a plain object nested by
  concern (`api`, `db`, `mqtt`, `meshtastic`, `bot`, `coverage`), matching
  how these variables already group by consumer. All values are fully
  resolved (defaults applied, strings parsed to numbers/booleans as
  appropriate) — no consumer of `DaemonConfig` performs any further parsing
  of a raw string.
- **The Zod schema itself** (e.g. `daemonConfigSchema`) is also exported, so
  a caller/test can call `.safeParse()` directly if it needs the raw
  success/failure result rather than `loadConfig()`'s throw-on-failure
  convenience wrapper.

## Preconditions

- The daemon is started via `node --env-file=../../.env --import tsx/esm
  src/index.ts` (per `packages/daemon/package.json`'s `dev`/`start` scripts)
  or an equivalent mechanism that populates `process.env` from the root
  `.env` file before `loadConfig()` is called. This contract does not change
  how `.env` values reach `process.env` — only how they are read once
  they're there.
- `zod` (`^3.24.0`) is already a `packages/daemon` dependency (confirmed in
  `packages/daemon/package.json`) and is already used with the repo's
  established plain `z.object({...})` / `z.string()` / `z.number()` style
  (see `packages/daemon/src/routes/devices.ts`'s `connectBodySchema` and
  `nodeOverrideBodySchema`) — no coercion helpers (`z.coerce.*`) are used
  anywhere in the codebase today. This contract's schema follows that same
  explicit style rather than introducing `z.coerce.*` (see Required
  behavior for why coercion is specifically unsafe for the boolean fields
  here).

## Required behavior

### Exact schema (every field, type, optionality, default — verified against current code)

| Env var | Config path | Type | Required | Default (verbatim source) |
|---|---|---|---|---|
| `API_PORT` | `api.port` | `number` (integer) | No | `3750` — from `packages/daemon/src/index.ts:23`, `Number(process.env.API_PORT ?? 3750)` |
| `API_HOST` | `api.host` | `string` | No | `"0.0.0.0"` — `index.ts:24` |
| `WEB_DIST` | `api.webDist` | `string` | No | absolute path equal to `<repo-root>/packages/web/dist` — `index.ts:99`, `join(__dirname, "../../web/dist")` resolved from `index.ts`'s own directory (see the location-independence requirement below) |
| `MQTT_BROKER` | `mqtt.broker` | `string \| undefined` | No | `undefined` (no default — its presence/absence is itself meaningful; see below) — `index.ts:111,114` |
| `MQTT_PORT` | `mqtt.port` | `number` (integer) | No | `1883` — `index.ts:115` |
| `MQTT_USER` | `mqtt.username` | `string` | No | `"meshdev"` — `index.ts:116` |
| `MQTT_PASS` | `mqtt.password` | `string` | No | `"large4cats"` — `index.ts:117` |
| `MQTT_ROOT` | `mqtt.rootTopic` | `string` | No | `"msh/US"` — `index.ts:118` (note: `.env.example`'s `MQTT_ROOT=msh/US/CA/Humboldt/Eureka` is an example operator value, not the code default) |
| `ENABLE_MQTT` | `mqtt.enabled` | `boolean` | No | `false` — `index.ts:123`, `process.env.ENABLE_MQTT === "true"` (exact-string-equality, not truthy-coercion; see pitfall below) |
| `MESHTASTIC_PORT` | `meshtastic.port` | `string \| undefined` | No | `undefined` — `index.ts:134,135` |
| `MESHTASTIC_NAME` | `meshtastic.name` | `string \| undefined` | No | `undefined` (raw value; **not** resolved to `meshtastic.port` inside the config module — see dependent-default note below) — `index.ts:136` |
| `PGLITE_DIR` | `db.pgliteDir` | `string` | No | absolute path equal to `<repo-root>/pglite-data` — `db/open.ts:26`, `db/client.ts:9`, both `join(__dirname, "../../../../pglite-data")` resolved from each file's own directory |
| `ELEVATION_API_URL` | `coverage.elevationApiUrl` | `string` (URL) | No | `"https://api.open-elevation.com/api/v1/lookup"` — `routes/coverage.ts:13-14` |
| `BOT_ENABLED` | `bot.enabled` | `boolean` | No | `false` — `device-manager.ts:687`, `process.env.BOT_ENABLED === "true"` (same exact-string-equality semantics as `ENABLE_MQTT`) |

No variable in this list is required (none of today's fourteen reads throws
or exits if its variable is absent — every one falls back to a default or to
`undefined`). The schema must not introduce a new required variable; doing
so would be scope creep beyond "structural change only."

### Boolean parsing pitfall (must not use `z.coerce.boolean()` or truthy checks)

Today, `ENABLE_MQTT` and `BOT_ENABLED` are compared with **exact string
equality** to `"true"` — any other value, including `"false"`, `"1"`,
`"TRUE"`, or an empty string, evaluates to `false`. This must be preserved
exactly. `z.coerce.boolean()` (or any check that does `Boolean(value)` on a
non-empty string) is **not** equivalent — `Boolean("false")` is `true` in
JavaScript, so naive coercion would flip `ENABLE_MQTT=false` (the value in
`.env.example` today) to `true`, silently changing behavior for every
operator who copied that file. The schema must implement these two fields
as an explicit string comparison (e.g. `z.string().optional().transform((v)
=> v === "true")`, or equivalent), not a coercion helper.

### Number parsing (must fail, not produce `NaN`)

`API_PORT` and `MQTT_PORT` must reject a present-but-non-numeric value with
a validation error rather than silently producing `NaN` (today's actual
behavior — see Purpose). Both must validate as a positive integer when
present, using the default when absent. This is the concrete case TASK-014's
own validation requirements name ("invalid type (e.g. non-numeric port —
clear fail-fast error)").

### Location-independent path defaults (`WEB_DIST`, `PGLITE_DIR`)

`WEB_DIST`'s and `PGLITE_DIR`'s current defaults are computed via
`join(__dirname, ...)`, relative to the *reading file's own location*
(`index.ts` for `WEB_DIST`; `db/open.ts`/`db/client.ts` for `PGLITE_DIR`).
The new config module must **not** naively copy these relative expressions
into its own file — since the config module lives at a different path depth
than `index.ts` or `db/open.ts`, a literal copy would resolve to a different
absolute directory and silently break both the served frontend location and
the database directory location for any operator who hasn't set these
variables explicitly (i.e. everyone, since neither appears in
`.env.example` today). The config module must compute these two defaults so
they resolve to the exact same absolute paths as today regardless of the
config module's own file location:

- `WEB_DIST` default = `<repo-root>/packages/web/dist`
- `PGLITE_DIR` default = `<repo-root>/pglite-data`

(where `<repo-root>` is the monorepo root, i.e. the parent of `packages/`).
The specific technique (e.g. anchoring on `packages/daemon/src`'s own
resolvable location, or reusing `db/open.ts`'s already-exported
`DEFAULT_DATA_DIR` constant for the `PGLITE_DIR` default specifically,
matching the value used by consumers of that module even though this
contract doesn't wire that module to consume the *config object* — see
Scope/Excluded) is implementation discretion; the *resulting absolute path*
matching today's value exactly is not.

### `MESHTASTIC_NAME`'s dependent default is not resolved inside the schema

Today, `MESHTASTIC_NAME`'s effective value defaults to `MESHTASTIC_PORT`'s
value, computed inline at the one call site that uses it
(`const name = process.env.MESHTASTIC_NAME ?? port;`, inside the `if
(process.env.MESHTASTIC_PORT)` block). This is a same-object,
already-in-scope fallback at the call site, not a genuine cross-field
schema default. The config module exposes `meshtastic.port` and
`meshtastic.name` as independent, raw optional strings (`meshtastic.name`
is `undefined` when `MESHTASTIC_NAME` is unset, **not** pre-resolved to
`meshtastic.port`'s value) — `index.ts` keeps applying
`config.meshtastic.name ?? config.meshtastic.port` at its own call site,
exactly as today. Baking this fallback into the schema (e.g. via a
cross-field `.transform()`) is unnecessary complexity for a two-line
fallback and is not required by this contract.

### `ENABLE_MQTT` / `MQTT_BROKER` independence is preserved, not tightened

Today, `MqttGateway` is only constructed when `MQTT_BROKER` is set (any
non-empty string); `ENABLE_MQTT` only controls whether `.start()` is called
on an already-constructed gateway. Setting `ENABLE_MQTT=true` with no
`MQTT_BROKER` is valid today and is a **silent no-op** — the `if
(process.env.MQTT_BROKER)` block is never entered, no gateway is created,
and no error or warning is produced. This contract requires that this
exact behavior be preserved: the schema does **not** add a cross-field
refinement making `MQTT_BROKER` required when `ENABLE_MQTT=true` (or vice
versa). Adding such a refinement would turn a currently-silent, currently-
valid configuration into a new fail-fast startup error — a real, arguably
desirable behavior change, but one outside TASK-014's "structural change
only" scope. See Open questions #3 for whether the human wants this
tightened as explicit follow-up work.

### Where and when `loadConfig()` is called

`loadConfig()` is called explicitly as the first statement inside
`main()` in `index.ts` (before `consoleLog.install()`), not as a
module-level side effect of importing the config module. This matters for
two reasons:

1. It keeps config-loading synchronous and explicit, so a validation
   failure is an ordinary thrown error inside `main()`'s body, which
   `main().catch((err) => fatalError("startup failure", err))` (or an
   equivalently-labeled variant — see Failure behavior) already catches and
   renders through the daemon's existing, established fatal-error UX
   (`index.ts`'s `fatalError()` — boxed message, "press any key to
   restart," exit code 1).
2. It avoids a subtler regression: if the config module instead validated
   at *import* time (e.g. `export const config = loadConfig();` evaluated
   as soon as any file imports the module), and something imported that
   module before `index.ts`'s own `process.on("uncaughtException"/
   "unhandledRejection")` handlers are registered (lines 61–80), a
   validation failure would throw during ES module import resolution and
   surface as a raw, unhandled Node.js error — bypassing `fatalError()`
   entirely and producing a *worse*, less clear failure than today's
   scattered-`process.env` baseline. Calling `loadConfig()` explicitly
   inside `main()` avoids this failure mode entirely.

## Postconditions and invariants

- After `loadConfig()` returns successfully, every field of the returned
  `DaemonConfig` is fully resolved and typed — no consumer (`DeviceManager`,
  `MqttGateway`, the route registration functions, `index.ts` itself)
  performs its own `process.env` read, `Number(...)` coercion, or
  `=== "true"` string comparison anywhere in its own code after this
  change. A repository-wide grep for `process.env` inside
  `packages/daemon/src` after implementation should show zero remaining
  matches outside the config module itself and `db/open.ts`/`db/client.ts`
  (excluded per Scope).
- Every one of the fourteen variables' effective default value is
  byte-for-byte identical to what running today's code with that variable
  unset would produce. This is the acceptance criterion TASK-014's own
  "Risks and assumptions" section names as the main risk, and this
  contract's schema table above is the artifact that must be checked
  against during implementation and review.
- `DaemonConfig` is constructed once per `loadConfig()` call and passed by
  value/reference into constructors — no consumer re-reads `process.env` or
  re-calls `loadConfig()` on its own initiative after construction. (Note:
  per Scope/Excluded, `db/client.ts`'s pre-existing, CONTRACT-001-governed
  `process.env.PGLITE_DIR` read is the one intentional exception, unchanged
  by this contract.)

## Failure behavior

- **A required-shape violation** (a variable present but failing its type
  or format check — e.g. `API_PORT=abc`, `MQTT_PORT=notanumber`,
  `ELEVATION_API_URL=not a url`): `loadConfig()` throws a single
  aggregated error listing **every** failing variable, not just the first.
  Zod's `safeParse()` already aggregates all issues into
  `result.error.issues`; `loadConfig()` must use this (or `.parse()`'s
  thrown `ZodError.issues`) rather than stopping at the first failure, so
  an operator can fix every problem in one pass instead of a frustrating
  fix-one-rerun-fix-next loop.
- **Error message format**: each violation is rendered as one line,
  `  - <ENV_VAR_NAME>: <human-readable reason>` (e.g. `  - API_PORT:
  expected a positive integer, received "abc"`), joined and passed through
  `index.ts`'s existing `fatalError(label, err)` path (or a `main()`-level
  `try`/`catch` around `loadConfig()` that re-throws with this formatted
  message, so it still reaches the same `fatalError()` call at the bottom
  of `index.ts`). This reuses the box-drawn, "press any key to restart"
  presentation already established for every other daemon startup failure
  (`fatalError`'s docstring: "the start scripts loop on exit so this gives
  the user time to read the error before the window restarts") rather than
  inventing a second, differently-formatted error path.
- **Exit code**: `1`, via the existing `fatalError()` → `process.exit(1)`
  path. No new exit code is introduced.
- **A missing variable**: not a failure mode by itself for any of the
  fourteen variables above — every one has either a static default or is
  legitimately optional (`undefined`) today, and this contract requires
  that be preserved (see Scope/Excluded: no new required variable).
- **Config validation success, but a downstream service still fails to
  start** (e.g. the MQTT broker at a *validly-shaped* but unreachable
  hostname): unchanged by this contract. `loadConfig()`'s job is limited to
  shape/type validation of the environment variables themselves — it does
  not attempt to verify reachability, credentials, or any other
  runtime-dependent property of a value it accepts.

## Interfaces

```ts
// packages/daemon/src/config.ts (exact filename is implementation discretion)

export interface DaemonConfig {
  api: {
    port: number; // API_PORT, default 3750
    host: string; // API_HOST, default "0.0.0.0"
    webDist: string; // WEB_DIST, default "<repo-root>/packages/web/dist"
  };
  db: {
    pgliteDir: string; // PGLITE_DIR, default "<repo-root>/pglite-data"
  };
  mqtt: {
    enabled: boolean; // ENABLE_MQTT, default false (exact "true" match only)
    broker: string | undefined; // MQTT_BROKER, no default
    port: number; // MQTT_PORT, default 1883
    username: string; // MQTT_USER, default "meshdev"
    password: string; // MQTT_PASS, default "large4cats"
    rootTopic: string; // MQTT_ROOT, default "msh/US"
  };
  meshtastic: {
    port: string | undefined; // MESHTASTIC_PORT, no default
    name: string | undefined; // MESHTASTIC_NAME, no default (raw; see dependent-default note)
  };
  bot: {
    enabled: boolean; // BOT_ENABLED, default false (exact "true" match only)
  };
  coverage: {
    elevationApiUrl: string; // ELEVATION_API_URL, default "https://api.open-elevation.com/api/v1/lookup"
  };
}

export const daemonConfigSchema: z.ZodType<DaemonConfig>; // or equivalent; exported for direct .safeParse() use

/** Throws a formatted, multi-issue error (see Failure behavior) on invalid input. */
export function loadConfig(env?: NodeJS.ProcessEnv): DaemonConfig;
```

Consumer signatures change as follows (exact parameter name/position is
implementation discretion; that a typed config value flows in, rather than
a `process.env` read happening internally, is not):

```ts
// device-manager.ts
constructor(private readonly db: PGlite, private readonly config: Pick<DaemonConfig, "bot">) { ... }
// or an equivalently narrow slice, e.g. just `botEnabled: boolean` — implementation discretion.

// index.ts, replacing today's inline object literal:
mqttGateway = new MqttGateway(
  {
    broker: config.mqtt.broker,
    port: config.mqtt.port,
    username: config.mqtt.username,
    password: config.mqtt.password,
    rootTopic: config.mqtt.rootTopic,
  },
  db,
);

// coverage.ts
export async function registerCoverageRoutes(
  app: FastifyInstance,
  db: PGlite,
  config: Pick<DaemonConfig, "coverage">,
) { ... }

// analytics.ts — see Open questions #2 before adding a parameter with no current use
export async function registerAnalyticsRoutes(app: FastifyInstance, db: PGlite /* , config? */) { ... }
```

## UX expectations

N/A as a distinct end-user-facing surface — this contract governs backend
process startup, not UI. The one human-visible effect is the operator-facing
startup error described in Failure behavior, which must remain at least as
clear as (and, per the aggregated-violations requirement, clearer than)
today's baseline of "no validation, confusing downstream failure."

## Validation requirements

- A unit test suite for the config module (e.g.
  `packages/daemon/src/__tests__/config.test.ts`, matching this package's
  existing `__tests__/` convention) covering at minimum: (a) every field's
  default value when its variable is unset, asserted against the exact
  values in the schema table above; (b) `ENABLE_MQTT`/`BOT_ENABLED` parse
  `"true"` as `true` and every other value (`"false"`, `"1"`, `"TRUE"`,
  `""`) as `false`; (c) `API_PORT`/`MQTT_PORT` accept a valid numeric
  string and reject a non-numeric one with a validation error, not `NaN`;
  (d) an invalid config produces one thrown error whose message lists more
  than one violation when more than one variable is invalid, not just the
  first; (e) `WEB_DIST` and `PGLITE_DIR` defaults resolve to the same
  absolute paths as today's `db/open.ts`/`index.ts` computations (this is
  the specific regression this contract calls out as the most likely
  silent bug).
- Manual startup smoke tests (per TASK-014's own validation requirements):
  valid `.env` starts normally; a missing-but-optional variable starts
  normally with defaults; an invalid-type variable (e.g.
  `API_PORT=notanumber`) produces the fail-fast error and exits with code
  1 rather than starting with a broken listener.
- Regression check: with a valid `.env`, MQTT gateway construction/start,
  serial auto-connect, the bot command handler, and the coverage
  `viewshed`/`elevation` endpoints all behave identically to before the
  change (same defaults, same broker/no-broker/enabled/disabled behavior).
- `.env.example` review: confirm every one of the fourteen schema fields is
  either present (commented or live) in `.env.example`, or its absence is
  intentional and reasonable (e.g. `PGLITE_DIR` and `WEB_DIST` are
  advanced/packaging-only overrides not needed by a typical operator).
  Today, `PGLITE_DIR`, `WEB_DIST`, and `MESHTASTIC_NAME` are entirely
  absent from `.env.example`; `ELEVATION_API_URL` is present but commented
  out. This contract requires this gap be closed or explicitly justified,
  per TASK-014's own acceptance criterion 4.

## Open questions

1. **Should `db/open.ts`/`db/client.ts` be rewired to consume the new
   config module for `PGLITE_DIR`, or left reading `process.env` directly
   as this contract currently requires (Scope/Excluded)?** Leaving them
   unchanged is consistent with TASK-014's own enumerated consumer list and
   avoids touching files governed by the already-Accepted CONTRACT-001, but
   it means `PGLITE_DIR`'s presence in the new Zod schema is effectively
   validation-for-documentation-consistency only — a malformed
   `PGLITE_DIR` would still surface via `db/client.ts`'s own existing,
   less-clear error path (a `PGlite` worker startup failure), not via the
   new module's clearer, aggregated error message, because `db/client.ts`'s
   top-level `await createDb()` runs during ES module import evaluation,
   before `main()`'s explicit `loadConfig()` call ever executes. The human
   should confirm this gap is acceptable for this task, or scope closing it
   as explicit follow-up work (likely requiring a small, separate change to
   `db/client.ts`'s import-time initialization, and possibly touching
   CONTRACT-001's scope).
2. **Should the analytics routes module actually receive a config
   parameter?** A repository-wide grep confirms
   `packages/daemon/src/routes/analytics.ts` reads no environment variable
   today. TASK-014's acceptance criteria name it as a config consumer
   anyway. The human should confirm whether this is (a) intentional
   forward-provisioning (add the parameter now, unused, for consistency/
   future-proofing), (b) a drafting inaccuracy in TASK-014 that should be
   dropped from the acceptance criteria, or (c) evidence of an env read
   this drafting pass missed (re-grepped and found none as of this
   writing). This contract does not require adding an unused parameter to
   `registerAnalyticsRoutes` — see the commented-out `/* , config? */` in
   Interfaces — pending that confirmation.
3. **Should `ENABLE_MQTT=true` with no `MQTT_BROKER` become a startup
   error instead of today's silent no-op?** This contract preserves the
   current silent-no-op behavior as the safe, in-scope default (see
   Required behavior), but the human flagged this exact interdependency as
   worth resolving explicitly, and a startup-time error here (with a
   message like "ENABLE_MQTT is true but MQTT_BROKER is not set") would
   likely be a genuine operator-experience improvement. Recommended as a
   small, explicitly-scoped follow-up task if desired, rather than folded
   into TASK-014's "structural change only" diff.
4. **`.env.example`'s `API_PORT=3172` vs. the code's actual default of
   `3750`.** This is not a contradiction — `.env.example` supplies an
   explicit operator value (not documenting "the default"), and the config
   module's default (used only when the variable is absent) must remain
   `3750` per the schema table above. Flagged only so the implementer
   doesn't "fix" `.env.example` to say `3750` under the mistaken belief
   that the two are supposed to match; they are not required to.
