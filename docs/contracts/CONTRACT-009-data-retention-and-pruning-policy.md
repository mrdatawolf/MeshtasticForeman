# CONTRACT-009: Data Retention and Pruning Policy

Status: Accepted
Approved by: Patrick
Approved date: 08/24/26
Related tasks: TASK-032 (Dependencies: TASK-012 — completed; TASK-028 —
completed (`packages/daemon/src/db/repositories/`, including `packets.ts`
and `messages.ts`); retention config surfaced through TASK-014's config
module — implemented as `packages/daemon/src/config.ts`, accepted per
CONTRACT-003)

## Purpose

No retention or pruning mechanism exists in `packages/daemon` today. The
`packets`, `messages`, `elevation_cache`, and `viewshed_cache` tables (and,
depending on how "telemetry" and "activity" are scoped — see below —
possibly others) grow without bound as the daemon runs, with no configured
limit and no deletion path. TASK-032's own Plan step 1 is explicit that the
retention **windows** are "a real product/operational decision... that
shouldn't be decided unilaterally by an implementer," and its Risks section
states plainly: *this is the task most likely to cause real operator-facing
harm if done wrong, because the harm — deleted data — is irreversible.*

This contract was originally written narrower than most: rather than
selecting retention windows, a pruning mechanism, or a deletion-vs-archival
strategy itself, it (1) pinned down, against the actual schema, exactly what
each of TASK-032's five named categories maps to in the database (some
mappings are not what the task's framing assumes — see Required behavior),
(2) laid out concrete, tradeoff-labeled options for each open design
question, and (3) defined the shape everything must eventually fit into
(config-module surfacing, per-category configurability, boundary-condition
testability), so that once the human chose among the options, an
implementer would have an unambiguous contract to build against.

Patrick reviewed those options and made every decision this contract had
deferred, on 2026-08-26. Required behavior below now marks, per category,
which option was selected and which were considered and rejected (rejected
options are struck through but kept, not deleted, so this document remains
a record of what was decided and why); Open questions records a short
summary of each of the eight resolutions. This contract is now fully
specified: it defines the retention windows, mechanism, and deletion
strategy TASK-032 must implement, not merely the menu of choices.

## Scope

### Included

- Confirming, against `packages/daemon/src/db/migrations.ts`, the exact
  table/column each of TASK-032's five named categories (packet, message,
  activity, telemetry, cache) actually maps to, including cases where the
  mapping is not a dedicated table.
- Presenting retention-window options (time-based and/or row-count-based)
  per category, each with a one-line tradeoff, for human selection.
- Presenting pruning-mechanism options (scheduled job, prune-on-write, or
  both), with tradeoffs, for human selection.
- Presenting the deletion-vs-archival/export question TASK-032's own
  Excluded section raises, for human selection.
- Defining how the eventual chosen policy is surfaced through
  `packages/daemon/src/config.ts` (`DaemonConfig`), following the schema and
  fail-fast conventions CONTRACT-003 established, so a follow-up
  implementation task has one settled place to add fields rather than
  inventing a second configuration mechanism.
- Flagging schema/table gaps (tables that grow unboundedly with event
  volume but are not named in TASK-032's title) so the human can decide
  whether they are in-scope, explicitly deferred, or intentionally excluded.

### Excluded

- Actually building the pruning mechanism, the sweep code, or any config
  module change. This contract, once fully specified below, is still a
  contract, not an implementation — TASK-032 (or a successor task) does the
  building. Retention windows, the row-count cap, the mechanism, and the
  deletion strategy are no longer open (see Required behavior and Open
  questions for Patrick's 2026-08-26 decisions), but selecting them is a
  different activity than writing the code that enforces them.
- Designing the internal structure of the repository modules TASK-028
  introduced (`packages/daemon/src/db/repositories/`, including the
  now-existing `packets.ts` and `messages.ts`). TASK-032's own Dependencies
  note repository modules as pruning logic's "natural home"; this contract
  does not prescribe which function in which repository module the sweep's
  delete queries live in — that remains an implementation detail for
  TASK-032, not something this contract fixes.
- Building an archival/export mechanism. Decision #5 (2026-08-26) settled
  this: pruning means deletion only, no export step. Building the deletion
  logic itself is still out of scope for this contract, per the bullet
  above.
- Retention policy for tables not named in TASK-032's title (`devices`,
  `nodes`, `channels`, `waypoints`, `mqtt_nodes`, `node_overrides`,
  `hw_models`, `coverage_proposals`, `position_history`, `traceroutes`,
  `mqtt_json_packets`). Per decisions #2 and #7 (2026-08-26): the first
  eight are permanently excluded (confirmed correct — see Required
  behavior); `position_history`, `traceroutes`, and `mqtt_json_packets` are
  explicitly deferred as a candidate follow-up task, not silently
  forgotten and not folded into TASK-032's scope.

## Actors

- **Human (project owner)**: the sole actor authorized to select a
  retention window, mechanism, and deletion/archival strategy per category.
  Patrick made every such decision on 2026-08-26 (see Required behavior and
  Open questions); this actor remains the sole authority for any future
  change to a window, the mechanism, or the deletion strategy.
- **Daemon process** (`packages/daemon/src/index.ts`, via `loadConfig()`):
  loads the retention configuration defined in Interfaces below at startup
  alongside the rest of `DaemonConfig`, exactly as CONTRACT-003 describes
  for every other config section.
- **Pruning mechanism** (not yet built): the scheduled-sweep component
  TASK-032 (or a successor task) implements per the mechanism decided below
  — a periodic sweep, not prune-on-write and not both (decision #6).
- **Operator**: sets retention configuration in the root `.env` file (per
  `CLAUDE.md`'s convention that "all user defined variables will be held in
  root .env file") and is the party who bears the consequence — data loss
  or unbounded disk growth — of whichever defaults are ultimately chosen.
- **Existing coverage/elevation cache read path**
  (`packages/daemon/src/routes/coverage.ts`): already implements an
  application-level, read-time-only 180-day freshness filter
  (`CACHE_TTL_MS`, `coverage.ts:14`) that is directly relevant to (but
  distinct from) the cache pruning question below — see Required behavior.

## Inputs and outputs

- **Input**: a periodic timer tick from the scheduled-sweep component
  (decision #6) — not a per-write event, since prune-on-write was not
  selected. The sweep runs on a fixed interval
  (`retention.sweepIntervalHours`, see Interfaces) for as long as the
  daemon process is running. There is no persisted "last swept at" value
  this contract requires; a sweep missed because the daemon was not
  running is not backfilled — the next sweep after restart simply operates
  against whatever data exists at that point, against the same
  boundary/cap rules as any other sweep.
- **Output**: for each category that is in scope for pruning (packets,
  telemetry, cache — see Required behavior; not messages, not activity)
  and only while `retention.enabled` is `true`, some number of rows (zero
  or more) physically removed from the corresponding table. Alongside the
  deletions themselves, the sweep produces one log line reporting what was
  removed per category (see UX expectations). There is no other output —
  no export artifact, no API response, no return value consumed by another
  daemon component.

## Preconditions

- `packages/daemon/src/config.ts` (TASK-014, implementing CONTRACT-003)
  exists and is the established pattern for adding new configuration: a
  Zod-validated schema, positive-integer/exact-boolean-string parsing
  helpers already defined there (`positiveInteger`, `exactTrue`), and a
  `DaemonConfig` interface consumers receive by value. TASK-014 is
  completed and CONTRACT-003 is accepted; this is the settled base the
  retention fields in Interfaces below extend.
- TASK-028 (repository modules) is completed
  (`packages/daemon/src/db/repositories/`, including `packets.ts` and
  `messages.ts`). Pruning logic's natural home is one of these modules;
  this contract does not require a particular function or file within
  them, since contracts define observable behavior, not file organization.
- The schema facts below are drawn directly from
  `packages/daemon/src/db/migrations.ts` as it exists today (18 migrations
  applied) and from the modules named alongside each fact; they are not
  approximated.

## Required behavior

### What each of TASK-032's five categories actually maps to

This is the first thing that must be pinned down, because two of the five
named categories do not map onto what "packet, message, activity,
telemetry, and cache tables grow unbounded" (this task's own framing)
would suggest.

| Category | Actual table(s) | Timestamp column | Relevant existing indexes | Notes |
|---|---|---|---|---|
| **Packet** | `packets` (`migrations.ts:52-70`) | `rx_time TIMESTAMPTZ NOT NULL` | `packets_device_time (device_id, rx_time DESC)` (`:72`); `packets_portnum (device_id, portnum, rx_time DESC)` (`:73`) | Highest write volume of the five; rows carry `payload_raw TEXT` and `decoded_json JSONB`, so this is also the largest per-row footprint. No index exists on `rx_time` alone — see performance note below. |
| **Message** | `messages` (`migrations.ts:33-47`, extended `:175-190,321-322`) | `rx_time TIMESTAMPTZ NOT NULL` | `messages_device_time` (`:49`); `messages_channel` (`:50`); `messages_role` (`:177`); partial `messages_ack ... WHERE ack_status = 'pending'` (`:190`); partial `messages_reply ... WHERE reply_to_packet_id != 0` (`:322`) | Lower volume than packets; this is human-authored chat content, not raw radio telemetry — its retention value profile is plausibly quite different from packets (see options below). |
| **Telemetry** | **Not a dedicated table.** A subset of `packets` rows where `portnum_name = 'TELEMETRY_APP'` (confirmed at `packages/daemon/src/routes/analytics.ts:655`, `:644`). | Same `rx_time` as `packets`. | Same `packets_device_time`/`packets_portnum` indexes as above — but `packets_portnum` is keyed on the integer `portnum` column, not the `portnum_name` string the analytics route actually filters on; a telemetry-specific prune query filtering by `portnum_name` would not use that index as written. | "Telemetry retention" is therefore not an independent deletion target — it is a filtered subset of the same table `packets` uses. See Open questions #3 for whether telemetry gets its own window at all, and the index-mismatch note under Validation requirements. |
| **Activity** | **No table exists.** `ActivityLog` (`packages/daemon/src/activity/log.ts:11-26`) is an in-process `EventEmitter`-backed ring buffer, hard-capped at `MAX_ENTRIES = 500` (`log.ts:5`), never written to PGlite. Confirmed by a repository-wide check of `db/migrations.ts`: no `activity` table in any of the 18 migrations. | N/A | N/A | This category, as it exists in the codebase today, **already self-bounds and is not persisted**, so it does not exhibit the "grows unbounded" problem TASK-032 names. **Resolved (decision #1, 2026-08-26):** this category is dropped as a pruning target entirely — it is not one of the categories this contract's mechanism needs to handle. No config field, no sweep logic, and no table for it. |
| **Cache** | `elevation_cache` (`migrations.ts:239-245`) and `viewshed_cache` (`:254-261`) | `cached_at TIMESTAMPTZ NOT NULL DEFAULT now()` on both | Neither table has an index on `cached_at` alone — both primary keys are on the cache-key columns (`lat_key, lon_key` / `lat_key, lon_key, radius_km`). A prune query filtering only by `cached_at < cutoff` would not be able to use either primary key and would scan the full table. | `coverage.ts:14`'s `CACHE_TTL_MS` (180 days) already implements a **read-time freshness filter** (`WHERE cached_at >= cutoff`, `coverage.ts:85,242`) — stale rows are never re-served as fresh, but are also never deleted; a key that stops being queried keeps its row forever. This is the unbounded-growth mechanism for these two tables specifically. |

### Tables that grow unboundedly but are not named in TASK-032's title

A schema-wide check surfaces three more event-history tables with the same
unbounded-growth shape as `packets`/`messages`, none of which TASK-032
mentions by name:

- `position_history` (`migrations.ts:218-232`) — one row per GPS fix per
  node; `recorded_at TIMESTAMPTZ`, indexed by `(node_id, recorded_at DESC)`
  and `(device_id, recorded_at DESC)`.
- `traceroutes` (`migrations.ts:199-210`) — one row per traceroute result;
  `recorded_at TIMESTAMPTZ`, indexed similarly.
- `mqtt_json_packets` (`migrations.ts:293-314`) — one row per JSON-mode
  MQTT packet; `rx_time`/`inserted_at TIMESTAMPTZ`, indexed by
  `(from_node, rx_time DESC)` and `(type, rx_time DESC)`.

By contrast, `devices`, `nodes`, `channels`, `waypoints`, `mqtt_nodes`,
`node_overrides`, and `hw_models` are current-state/reference tables keyed
by device/node/model identity rather than by event — they grow with the
*cardinality* of known devices/nodes, not with time or message volume, and
so do not share this problem. `coverage_proposals` has a `created_at`
column but is explicitly user-authored planning content (hypothetical
sites an operator adds deliberately) — auto-deleting it under a time-based
policy would very likely surprise an operator in a way none of the other
categories would.

**Resolved (decisions #2 and #7, 2026-08-26):** `devices`, `nodes`,
`channels`, `waypoints`, `mqtt_nodes`, `node_overrides`, `hw_models`, and
`coverage_proposals` are confirmed correctly excluded, permanently, per the
reasoning above — including `coverage_proposals`, despite its `created_at`
column. `position_history`, `traceroutes`, and `mqtt_json_packets` are
explicitly **deferred**, not silently excluded and not folded into
TASK-032: they are out of scope for this contract and TASK-032, and are
recorded here as a candidate follow-up task (a future task covering
retention for these three event-history tables specifically) so they are
not forgotten.

### Mechanism: scheduled job vs. prune-on-write vs. both

Independent of *how long* to retain data, *when* pruning runs is a
separate design choice with its own tradeoffs:

| Option | Tradeoff |
|---|---|
| **Selected — Scheduled job** (e.g. a periodic `setInterval` sweep run from `main()`, matching the daemon's existing precedent in `device-manager.ts:506` and `mqtt/gateway.ts:208`) | Predictable, bounded load at a known cadence; straightforward to test in isolation. Leaves a window between sweeps where a table can transiently exceed its configured retention. PGlite has no built-in cron equivalent (e.g. no `pg_cron`), so this runs as ordinary daemon-process JS, meaning it only prunes while the daemon is running. |
| ~~Prune-on-write~~ (check-and-delete past a threshold on or after each relevant insert) | ~~Keeps tables continuously near their bound with no separate timer or "daemon must be running" caveat.~~ **Not selected.** Adds latency/lock contention directly to the hot write path — most consequential for `packets`, the highest-volume, hottest-write-path category. |
| ~~Both~~ (scheduled sweep as primary mechanism, on-write check only as a hard-ceiling backstop well above the normal configured window) | ~~More robust against both transient overshoot and "daemon rarely runs" scenarios.~~ **Not selected.** Two mechanisms to implement, configure, and test instead of one — more surface area for the exact kind of subtle bug this task's own Risks section warns about, for no real benefit at this scale. |

**Resolved (decision #6, 2026-08-26).** At the expected write volume
(~100 changes/minute, i.e. ~144k/day), a scheduled batch delete is trivial
load with no lock-contention concern, whereas prune-on-write would add
latency to every write on `packets` — the highest-volume, hottest-write-path
table — for no real benefit at this scale.

**Implementation note (recommended default, not the only technically valid
approach):** the existing `packets` indexes are composite
(`packets_device_time (device_id, rx_time DESC)` /
`packets_portnum (device_id, portnum, rx_time DESC)`), not `rx_time` alone,
so a single global "delete everything older than X across all devices"
sweep query would not use them efficiently. The recommended approach is for
the sweep to iterate per-device, reusing the existing `packets_device_time`
index, rather than adding a new `rx_time`-only index. Either approach is
technically valid; per-device iteration is the recommended default absent a
reason to deviate.

### Deletion vs. archival/export

TASK-032's own Excluded section states this explicitly: "pruning means
deletion... or the contract may define an export step, if that's the
direction CONTRACT-009 lands on." Options considered:

| Option | Tradeoff |
|---|---|
| **Selected — Deletion only** | Simplest to implement and test; matches "pruning" literally; no added storage or export-format design. Irreversible — the exact risk this task's own Risks section names as its primary concern. |
| ~~Export-then-delete~~ (e.g. reusing the SQL-dump export pattern `packages/daemon/src/routes/terrain-cache.ts` already implements for `elevation_cache`, generalized to other categories) | ~~Preserves data an operator can restore later; gives a wrong-default a recovery path.~~ **Not selected.** Requires deciding export destination, retention of the export itself, and format — meaningful added scope TASK-032's Excluded section is explicitly trying to keep out. |
| ~~Configurable per category~~ (some categories delete, others export, operator's choice) | ~~Most flexible.~~ **Not selected.** Most configuration surface to design, document, and test, and hardest to give a safe default for. |

**Resolved (decision #5, 2026-08-26): deletion only. No export/archival
mechanism.**

### Per-category retention window options

Each table below records every option considered; the selected option is
marked and the rest are struck through but kept, as a record of what was
decided and why (all decisions below by Patrick, 2026-08-26).

**Packet** (`packets` table, all portnums):

| Option | Tradeoff |
|---|---|
| ~~30 days~~ | ~~Smallest disk footprint.~~ **Not selected** — likely too short for month-over-month RF/coverage troubleshooting. |
| ~~90 days~~ | ~~Moderate disk use.~~ **Not selected** — still discards seasonal/long-term propagation trend data. |
| **Selected — Row-count cap per device: 100,000 rows/device** | Bounds worst-case disk regardless of packet rate; effective retention *duration* varies unpredictably — a busy device loses history far faster than a quiet one. Oldest-`rx_time`-first eviction per device once that device's row count exceeds 100,000. |
| ~~Unlimited (no pruning by default)~~ | ~~No risk of losing data operators want.~~ **Not selected** — does not solve the problem this task exists to solve. |

**Message** (`messages` table):

| Option | Tradeoff |
|---|---|
| ~~90 days~~ | ~~Mirrors a plausible packet-tier window.~~ **Not selected** — may discard chat content ("who reported X on this date") that has outsized value relative to its small storage cost. |
| ~~1 year~~ | ~~Preserves a full seasonal cycle of human-authored chat history at modest cost.~~ **Not selected.** |
| **Selected — Unlimited (no pruning by default)** | Messages are plausibly the single category most likely to hold irreplaceable operational value; this contract does not prune `messages` at all, regardless of the global switch's state — see Postconditions. |

**Telemetry** (packets where `portnum_name = 'TELEMETRY_APP'`):

| Option | Tradeoff |
|---|---|
| ~~Same window as general packet retention (no separate rule)~~ | ~~Simplest — one policy, one query pattern, against one table.~~ **Not selected** — telemetry's value profile (long-run trend data, low per-row cost) doesn't fit `packets`' row-count cap well. |
| **Selected — Independent window: 1 year** | Matches telemetry's actual use case (long-run battery/channel-health trend charts) and low per-row cost. Requires the prune query to filter by `portnum_name` specifically — the existing `packets_portnum` index is keyed on integer `portnum`, not the string `portnum_name` the analytics route filters on, so **a new index is needed** for this to be efficient (see Validation requirements). |

**Cache** (`elevation_cache`, `viewshed_cache`):

| Option | Tradeoff |
|---|---|
| **Selected — Delete rows past the existing 180-day `CACHE_TTL_MS` (`coverage.ts:14`)** | No behavior change versus today's *effective* read semantics (stale rows are already never served as fresh) — this reclaims space already logically abandoned; the deletion cutoff matches the existing read-time freshness filter exactly. Requires adding a `cached_at`-only index for the delete query to avoid a full-table scan on both tables — **neither table has one today; it must be added.** |
| ~~Shorter, independent prune window (e.g. 90 days)~~ | ~~Frees space sooner.~~ **Not selected** — would increase repeat calls to the external elevation API for locations re-queried between 90 and 180 days out, partially defeating the cache's purpose. |
| ~~Row/size cap with oldest-`cached_at`-first eviction~~ | ~~Bounds disk directly.~~ **Not selected** — `cached_at` reflects last write, not last read, so it's a poor proxy for "least useful." |
| ~~Unlimited (no pruning by default)~~ | ~~Closest thing in this contract to a low-risk option.~~ **Not selected.** |

**Activity**: resolved as out of scope entirely (decision #1) — `ActivityLog`
already self-bounds and is never persisted to PGlite, so it is not a
pruning target for this contract. No window options apply.

### Configuration surfacing (extends `packages/daemon/src/config.ts`)

Whatever windows/mechanism/deletion strategy the human selects must be
surfaced through the existing `DaemonConfig` module (CONTRACT-003's
pattern), not a new configuration mechanism:

- New fields are added to the existing `daemonConfigSchema` in
  `packages/daemon/src/config.ts`, using the same helpers already defined
  there (`positiveInteger` for numeric windows/caps, `exactTrue` for any
  boolean enable/disable flags, following the exact-string `"true"`-match
  semantics CONTRACT-003 established for `ENABLE_MQTT`/`BOT_ENABLED`) —
  not a parallel schema or ad hoc `process.env` reads.
  `packages/daemon/src/config.ts` is the sole config module in this
  package; CONTRACT-003's own Scope explicitly forbids "adding any new
  configuration option" under *its* task, but a follow-up
  extension for TASK-032 is exactly the mechanism CONTRACT-003 was
  designed to receive.
- New env vars are documented in the root `.env.example`, consistent with
  CONTRACT-003's requirement that every schema field be present there
  (commented or live) or its absence explicitly justified.
- **Resolved (decision #4, 2026-08-26):** operators adjust or disable
  pruning via a **single global enable/disable switch**
  (`retention.enabled` / `RETENTION_ENABLED`), not a per-category on/off
  flag. Each category's retention *window* (or cap, or "unlimited" for
  `messages`) is still independently configured (see Interfaces) — only the
  kill switch is global. Patrick's stated reasoning, preserved here: this
  is a judgment call about expected real-world usage patterns, not a
  permanent architectural stance — it may be revisited once there is real
  operational experience with the feature, at which point per-category
  enable flags could be added without changing this contract's overall
  shape.
- A `DaemonConfig.retention` section is the natural home for these fields,
  matching the existing per-concern nesting (`api`, `db`, `mqtt`,
  `meshtastic`, `bot`, `coverage`) `config.ts` already uses. Its exact
  shape, field names, and defaults are given in Interfaces below, which is
  now the settled schema, not a proposal sketch.

## Postconditions and invariants

- **"Pruned" means physically removed, with no export step.** A prune
  operation issues a `DELETE` against the underlying table (`packets`,
  `elevation_cache`, `viewshed_cache`); per decision #5, there is no
  archival or export step of any kind. Once a row is pruned, it does not
  exist anywhere the daemon can recover it from.
- **A prune operation never removes data inside its configured boundary.**
  For a time-based category (telemetry, cache), a sweep never deletes a row
  whose relevant timestamp (`rx_time` for telemetry, `cached_at` for cache)
  is strictly newer than that category's configured cutoff at the moment
  the sweep runs. For the row-count-capped category (packets), a sweep
  never deletes a row if doing so would bring that device's row count below
  `retention.packets.maxRowsPerDevice`; eviction is oldest-`rx_time`-first,
  per device, and stops once that device's remaining row count equals the
  cap.
- **Messages are never pruned.** Per decision #5's per-category window
  choice, `messages` has no configured retention window; no sweep this
  contract describes ever deletes a row from `messages`, regardless of the
  global switch's state.
- **Activity is never in scope.** Per decision #1, no sweep logic this
  contract describes touches `ActivityLog` or any database table on its
  behalf — there is no table to prune.
- **Disabling the global switch is absolute.** When `retention.enabled` is
  `false` (the fresh-install default per decision #8), no category is ever
  pruned, regardless of any category's age or row count. Re-enabling it
  resumes sweeps against whatever data exists at that point; a period spent
  disabled is not "made up" by a larger subsequent sweep — it simply means
  data that would have been pruned during that period was not.
- **A sweep is idempotent.** Running a sweep against a table with no rows
  past its configured boundary is a no-op (zero rows deleted); running two
  sweeps back-to-back never deletes the same already-pruned row twice, and
  never deletes a row a prior sweep had already correctly retained.

## Failure behavior

- **A mid-sweep failure cannot partially delete a table.** Each category's
  delete (and, for `packets`' per-device sweep, each device's delete) runs
  inside the existing `db.transaction()` pattern already used throughout
  `migrations.ts` and `open.ts`'s proxy, so a failure partway through rolls
  back that delete rather than leaving it partially applied. A failure in
  one category's or one device's delete does not need to roll back deletes
  already committed earlier in the same sweep pass for other
  categories/devices; each is its own transaction.
- **A prune failure is not fatal to the daemon.** Consistent with
  CONTRACT-003's precedent that only startup misconfiguration is treated as
  an availability emergency, a failed sweep (e.g. a transient PGlite error)
  is logged — including which category or device failed and the underlying
  error — and the daemon continues running. The next scheduled sweep is
  unaffected and simply runs again at its normal interval. Data growth is
  not an availability emergency the way a startup misconfiguration is.
- **A malformed retention configuration value fails fast at startup.**
  Following CONTRACT-003's exact convention, an invalid `retention.*`
  environment variable (e.g. a non-numeric
  `RETENTION_PACKETS_MAX_ROWS_PER_DEVICE`, or a non-positive-integer
  `RETENTION_SWEEP_INTERVAL_HOURS`) causes `loadConfig()` to throw a single
  aggregated error listing every failing retention variable alongside any
  other failing variable, surfaced through `index.ts`'s existing
  `fatalError()` path with exit code 1 — not a silent fallback to a
  default, and not a failure deferred until the first sweep attempt.

## Interfaces

Exact schema, matching CONTRACT-003's `daemonConfigSchema` conventions
(`positiveInteger`/`exactTrue` helpers already defined in
`packages/daemon/src/config.ts`) — not a sketch. This extends the existing
`DaemonConfig`/`daemonConfigSchema`; sections other than `retention` are
unchanged.

```ts
export interface DaemonConfig {
  // ...existing sections unchanged (api, db, mqtt, meshtastic, bot, coverage)...
  retention: {
    enabled: boolean; // RETENTION_ENABLED, default false (exact "true" match only, same convention as ENABLE_MQTT/BOT_ENABLED) — global kill switch (decision #4); fresh-install default is disabled (decision #8)
    sweepIntervalHours: number; // RETENTION_SWEEP_INTERVAL_HOURS, default 24 (see cadence rationale below)
    packets: {
      maxRowsPerDevice: number; // RETENTION_PACKETS_MAX_ROWS_PER_DEVICE, default 100000 — row-count cap per device, oldest rx_time evicted first
    };
    telemetry: {
      windowDays: number; // RETENTION_TELEMETRY_WINDOW_DAYS, default 365 — independent of packets.maxRowsPerDevice (decision #3)
    };
    cache: {
      windowDays: number; // RETENTION_CACHE_WINDOW_DAYS, default 180 — matches coverage.ts:14's existing CACHE_TTL_MS exactly
    };
    // messages: intentionally absent. Decision #5 selected "unlimited, no
    // pruning" for this category (see Required behavior's Message table);
    // there is no window/cap value to configure until/unless that default
    // is revisited.
    // activity: intentionally absent, per decision #1 — not a pruning
    // target for this contract at all.
  };
}
```

Schema additions to `daemonConfigSchema` (same file, same helper style):

```ts
RETENTION_ENABLED: exactTrue,
RETENTION_SWEEP_INTERVAL_HOURS: positiveInteger("24"),
RETENTION_PACKETS_MAX_ROWS_PER_DEVICE: positiveInteger("100000"),
RETENTION_TELEMETRY_WINDOW_DAYS: positiveInteger("365"),
RETENTION_CACHE_WINDOW_DAYS: positiveInteger("180"),
```

and, inside the existing `.transform((env): DaemonConfig => ({ ... }))`:

```ts
retention: {
  enabled: env.RETENTION_ENABLED,
  sweepIntervalHours: env.RETENTION_SWEEP_INTERVAL_HOURS,
  packets: { maxRowsPerDevice: env.RETENTION_PACKETS_MAX_ROWS_PER_DEVICE },
  telemetry: { windowDays: env.RETENTION_TELEMETRY_WINDOW_DAYS },
  cache: { windowDays: env.RETENTION_CACHE_WINDOW_DAYS },
},
```

**Sweep interval default rationale (24 hours):** telemetry's (1 year) and
cache's (180 day) windows are measured in months, so a sub-daily sweep adds
no material benefit to either. `packets`' row-count cap only needs to be
re-checked often enough to bound worst-case per-device overshoot to about a
day's worth of writes — a small fraction of the 100,000-row cap even for a
device receiving a large share of the daemon's ~100 writes/minute — so an
hourly cadence would add ~24x the sweep frequency for negligible practical
benefit at this write volume. Daily is the recommended default; nothing in
this contract prevents an operator from setting a shorter
`RETENTION_SWEEP_INTERVAL_HOURS` if they want tighter bounds.

New fields require corresponding entries in the root `.env.example`,
consistent with CONTRACT-003's existing requirement that every schema field
be present there (commented or live) or its absence explicitly justified.

## UX expectations

N/A as a distinct end-user-facing UI surface — this contract governs
backend data lifecycle, not frontend behavior. The one operator-facing
consequence is what the daemon logs when a prune sweep runs: at minimum,
one log line per sweep pass reporting rows removed per in-scope category
(`packets`, `telemetry`, `cache`) — and, for `packets`, per device, since
eviction is per-device — so an operator upgrading into this behavior for
the first time can see what happened rather than silently losing history.
A sweep that removes zero rows still logs (a no-op sweep is a normal,
expected outcome, not something to suppress), consistent with this
contract's idempotency invariant above. Exact log line format/fields are
an implementation detail for TASK-032, not fixed by this contract, so long
as category, device (for packets), and row count are present.

## Validation requirements

Boundary-condition tests per in-scope category, confirming a prune
operation never removes data inside its configured boundary and always
removes data past it:

- **Packets**: a device at exactly 100,000 rows (no eviction), a device at
  100,001 rows (exactly one row evicted, oldest `rx_time` first), and a
  device well past the cap (evicted down to exactly 100,000, not below).
- **Telemetry**: a `TELEMETRY_APP` row at exactly the 1-year cutoff, one
  just inside it (retained), and one well past it (removed) — verified
  without affecting non-telemetry `packets` rows with the same `rx_time`,
  since telemetry's window is independent of `packets`' cap.
- **Cache**: an `elevation_cache`/`viewshed_cache` row at exactly the
  180-day cutoff, one just inside it (retained), and one well past it
  (removed) — verified as consistent with `coverage.ts`'s existing
  `CACHE_TTL_MS` read-time filter (a row the read path already treats as
  stale should be exactly the row the sweep deletes).
- **Messages and activity**: a test confirming no sweep this contract
  describes ever touches `messages` or any activity-related table,
  regardless of row age or the global switch's state.
- **Global switch**: a test confirming that with `retention.enabled`
  false, a sweep against data past every category's boundary deletes
  nothing.

A manual, documented check of a fresh install's default retention behavior
before shipping (`retention.enabled` defaults to `false` per decision #8 —
confirm a fresh install genuinely does not prune until an operator opts
in), since silent, undocumented data loss on upgrade is the primary risk
this whole contract exists to prevent.

Index requirements this contract identifies as necessary for TASK-032 to
add (not optional performance tuning — without them, a sweep becomes an
unexpectedly expensive full-table scan on the categories with the highest
row counts): a `portnum_name`-inclusive index to support the telemetry
sweep's filter (the existing `packets_portnum` index is keyed on the
integer `portnum` column, not the `portnum_name` string the sweep filters
on); a `cached_at`-only index on both `elevation_cache` and
`viewshed_cache` (neither has one today — both primary keys are on the
cache-key columns). The existing `packets_device_time (device_id, rx_time
DESC)` index already supports the recommended per-device packets sweep
without any new index.

## Open questions

All 8 questions below were resolved by Patrick on 2026-08-26. This section
is retained as a historical record of what was asked and answered; the
authoritative detail for each lives in the Required behavior,
Configuration surfacing, Postconditions, and Interfaces sections above.

1. **Activity retention meaning** — resolved as: not applicable.
   `ActivityLog` is in-memory, self-bounding, never persisted; dropped as a
   pruning target entirely.
2. **`position_history`/`traceroutes`/`mqtt_json_packets` scope** —
   resolved as: deferred. Explicitly out of scope for TASK-032; recorded
   as a candidate follow-up task.
3. **Telemetry window: independent or shared with `packets`?** — resolved
   as: independent, 1 year.
4. **Per-category configurability vs. a single global switch?** — resolved
   as: a single global enable/disable switch (`retention.enabled`);
   per-category windows/caps remain independently configured. Patrick
   noted this reflects expected usage patterns and may be revisited with
   real-world operational experience — a deliberately revisitable choice,
   not a permanent architectural stance.
5. **Deletion or export-then-delete?** — resolved as: deletion only, no
   archival/export mechanism.
6. **Mechanism: scheduled, on-write, or both?** — resolved as: scheduled
   sweep, daily by default (`retention.sweepIntervalHours`, default 24).
7. **Are `devices`/`nodes`/`channels`/`waypoints`/`mqtt_nodes`/
   `node_overrides`/`hw_models`/`coverage_proposals` correctly excluded?**
   — resolved as: yes, confirmed correctly excluded, including
   `coverage_proposals` despite its `created_at` column.
8. **Fresh-install default retention behavior?** — resolved as: pruning
   disabled by default; an operator must explicitly opt in via
   `retention.enabled`.
