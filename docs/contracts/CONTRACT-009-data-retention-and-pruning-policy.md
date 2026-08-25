# CONTRACT-009: Data Retention and Pruning Policy

Status: Proposed
Approved by:
Approved date:
Related tasks: TASK-032 (Dependencies: TASK-012 — completed; TASK-028 —
approved, not yet implemented; retention config surfaced through TASK-014's
config module — implemented as `packages/daemon/src/config.ts`, currently in
`tasks/review/`)

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

This contract's purpose is correspondingly narrower than most: it is **not**
to select retention windows, a pruning mechanism, or a deletion-vs-archival
strategy. It is to (1) pin down, against the actual schema, exactly what
each of TASK-032's five named categories maps to in the database (some
mappings are not what the task's framing assumes — see Required behavior),
(2) lay out concrete, tradeoff-labeled options for each open design
question, and (3) define the shape everything must eventually fit into
(config-module surfacing, per-category configurability, boundary-condition
testability) so that once the human chooses among the options, an
implementer has an unambiguous contract to build against. Every retention
window, mechanism choice, and deletion-vs-archival choice in this document
remains an open question requiring explicit human selection before TASK-032
can be implemented.

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

- Choosing default retention windows, row-count caps, or a mechanism.
  Nothing in this contract's Required behavior section should be read as a
  recommendation the human is expected to rubber-stamp; every numbered
  option is presented without a preferred default. See Open questions.
- Designing the repository-module structure TASK-028 will introduce.
  TASK-032's own Dependencies note repository modules as pruning logic's
  "natural home," but TASK-028 is approved and unimplemented as of this
  writing; this contract does not prescribe TASK-028's file layout or
  presume it exists yet. Once TASK-028 lands, pruning logic's home is an
  implementation detail for TASK-032, not something this contract fixes.
- Building an archival/export mechanism. Per TASK-032's Excluded section,
  this contract may land on "pruning means deletion" or may land on an
  export step instead — that choice is presented as an open question, not
  assumed either way, and building the mechanism itself is out of scope
  regardless of which way it lands.
- Retention policy for tables not named in TASK-032's title (`devices`,
  `nodes`, `channels`, `waypoints`, `mqtt_nodes`, `node_overrides`,
  `hw_models`, `coverage_proposals`, `position_history`, `traceroutes`,
  `mqtt_json_packets`). See Required behavior and Open questions for why
  several of these are flagged rather than silently included or excluded.

## Actors

- **Human (project owner)**: the sole actor authorized to select a
  retention window, mechanism, and deletion/archival strategy per category.
  Nothing in this contract is self-approving; see Open questions for every
  decision awaiting this actor.
- **Daemon process** (`packages/daemon/src/index.ts`, via `loadConfig()`):
  once a policy is chosen, loads the resulting retention configuration at
  startup alongside the rest of `DaemonConfig`, exactly as CONTRACT-003
  describes for every other config section.
- **Pruning mechanism** (not yet built): whatever component eventually
  executes the chosen deletion (or archival) policy — a scheduled job, an
  on-write check, or both, per whichever option the human selects.
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

Not yet defined — the mechanism (scheduled job vs. on-write trigger vs.
both) determines what "input" even means (a timer tick vs. a write event),
and that is itself an open question. This section will be completed once
the human selects a mechanism, at which point the config schema in
Interfaces below can be finalized with concrete field names.

## Preconditions

- `packages/daemon/src/config.ts` (TASK-014, implementing CONTRACT-003)
  exists and is the established pattern for adding new configuration: a
  Zod-validated schema, positive-integer/exact-boolean-string parsing
  helpers already defined there (`positiveInteger`, `exactTrue`), and a
  `DaemonConfig` interface consumers receive by value. TASK-014 is
  currently in `tasks/review/`, not yet human-accepted, but its code exists
  and is the correct base for retention config regardless of that review's
  outcome, since no competing configuration mechanism exists.
- TASK-028 (repository modules) is `approved` but not started. Whichever
  implementation eventually executes TASK-032 will either land before or
  after TASK-028; this contract does not require a particular order, since
  contracts define observable behavior, not file organization.
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
| **Activity** | **No table exists.** `ActivityLog` (`packages/daemon/src/activity/log.ts:11-26`) is an in-process `EventEmitter`-backed ring buffer, hard-capped at `MAX_ENTRIES = 500` (`log.ts:5`), never written to PGlite. Confirmed by a repository-wide check of `db/migrations.ts`: no `activity` table in any of the 18 migrations. | N/A | N/A | This category, as it exists in the codebase today, **already self-bounds and is not persisted**, so it does not exhibit the "grows unbounded" problem TASK-032 names. See Open questions #1 — this is a material scope question, not a detail. |
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
categories would. This contract's recommendation is that these three
tables and `coverage_proposals` be treated as **excluded from this
contract's scope**, either permanently or as explicit follow-up work — see
Open questions #2.

### Mechanism: scheduled job vs. prune-on-write vs. both

Independent of *how long* to retain data, *when* pruning runs is a
separate design choice with its own tradeoffs:

| Option | Tradeoff |
|---|---|
| **Scheduled job** (e.g. a periodic `setInterval` sweep run from `main()`, matching the daemon's existing precedent in `device-manager.ts:506` and `mqtt/gateway.ts:208`) | Predictable, bounded load at a known cadence; straightforward to test in isolation. Leaves a window between sweeps where a table can transiently exceed its configured retention. PGlite has no built-in cron equivalent (e.g. no `pg_cron`), so this runs as ordinary daemon-process JS, meaning it only prunes while the daemon is running. |
| **Prune-on-write** (check-and-delete past a threshold on or after each relevant insert) | Keeps tables continuously near their bound with no separate timer or "daemon must be running" caveat. Adds latency/lock contention directly to the hot write path — most consequential for `packets`, the highest-volume category, least consequential for `cache` tables (write-rate is naturally throttled by the 180-day TTL's read-time reuse). |
| **Both** (scheduled sweep as primary mechanism, on-write check only as a hard-ceiling backstop well above the normal configured window) | More robust against both transient overshoot and "daemon rarely runs" scenarios. Two mechanisms to implement, configure, and test instead of one — more surface area for the exact kind of subtle bug this task's own Risks section warns about. |

### Deletion vs. archival/export

TASK-032's own Excluded section states this explicitly: "pruning means
deletion... or the contract may define an export step, if that's the
direction CONTRACT-009 lands on." This contract does **not** assume
deletion is correct by default. Options:

| Option | Tradeoff |
|---|---|
| **Deletion only** | Simplest to implement and test; matches "pruning" literally; no added storage or export-format design. Irreversible — the exact risk this task's own Risks section names as its primary concern. |
| **Export-then-delete** (e.g. reusing the SQL-dump export pattern `packages/daemon/src/routes/terrain-cache.ts` already implements for `elevation_cache`, generalized to other categories) | Preserves data an operator can restore later; gives a wrong-default a recovery path. Requires deciding export destination (local disk file? operator-triggered pull, matching `terrain-cache.ts`'s existing export endpoint? automatic on-prune?), retention of the *export* itself (which reintroduces the same unbounded-growth question one layer down), and format — meaningful added scope TASK-032's Excluded section is explicitly trying to keep out. |
| **Configurable per category** (some categories delete, others export, operator's choice) | Most flexible; also the most configuration surface to design, document, and test, and the hardest to give a "safe" default for, since the safe choice is plausibly different per category (see per-category options below). |

### Per-category retention window options

None of the following is a recommendation; each is presented so the human
can select (and may select differently per category, or select
row-count-based caps for some and time-based windows for others).

**Packet** (`packets` table, all portnums):

| Option | Tradeoff |
|---|---|
| 30 days | Smallest disk footprint; likely too short for month-over-month RF/coverage troubleshooting. |
| 90 days | Moderate disk use; still discards seasonal/long-term propagation trend data. |
| Row-count cap per device (e.g. 100,000 rows/device) | Bounds worst-case disk regardless of packet rate; effective retention *duration* varies unpredictably — a busy device loses history far faster than a quiet one, which may surprise operators comparing devices. |
| Unlimited (no pruning by default) | No risk of losing data operators want; does not solve the problem this task exists to solve — disk growth becomes an unmonitored operator responsibility. |

**Message** (`messages` table):

| Option | Tradeoff |
|---|---|
| 90 days | Mirrors a plausible packet-tier window; may discard chat content ("who reported X on this date") that has outsized value relative to its small storage cost. |
| 1 year | Preserves a full seasonal cycle of human-authored chat history at modest cost, since message volume/row-size is much lower than packets. |
| Unlimited (no pruning by default) | Messages are plausibly the single category most likely to hold irreplaceable operational value; may be the strongest argument in this whole contract for exempting a category from automatic deletion until an archival option exists. |

**Telemetry** (packets where `portnum_name = 'TELEMETRY_APP'`):

| Option | Tradeoff |
|---|---|
| Same window as general packet retention (no separate rule) | Simplest — one policy, one query pattern, against one table. Couples telemetry (numeric time-series: battery, channel/air utilization — usually *wanted* longer for trend analysis, and much smaller per-row than payload/decoded_json-heavy non-telemetry packets) to whatever window is chosen for the rest of `packets`, which may not fit either well. |
| Independent, longer window (e.g. 180 days or 1 year) | Better matches telemetry's actual use case (long-run battery/channel-health trend charts) and low per-row cost. Requires the prune query to filter by `portnum_name` specifically — see the index-mismatch note above, since the existing `packets_portnum` index is keyed on integer `portnum`, not the string `portnum_name` the analytics route filters on. |

**Cache** (`elevation_cache`, `viewshed_cache`):

| Option | Tradeoff |
|---|---|
| Delete rows past the existing 180-day `CACHE_TTL_MS` (`coverage.ts:14`) | No behavior change versus today's *effective* read semantics (stale rows are already never served as fresh) — this option only reclaims space already logically abandoned. Requires adding a `cached_at`-only index for the delete query to avoid a full-table scan on both tables (see the index gap noted above). |
| Shorter, independent prune window (e.g. 90 days), decoupled from the 180-day freshness TTL | Frees space sooner. Increases repeat calls to the external elevation API for locations re-queried between 90 and 180 days out — partially defeating the cache's purpose. |
| Row/size cap with oldest-`cached_at`-first eviction | Bounds disk directly. `cached_at` reflects *last write*, not *last read* — there is no last-accessed column today, so "oldest `cached_at`" is not the same as "least useful"; a location queried once and never again is a better eviction candidate than a frequently-reused one that happens to have an old `cached_at`. |
| Unlimited (no pruning by default) | Cache data is fully re-derivable from the external elevation API (not operator-observed/authored data), making this the closest thing in this contract to a low-risk option — but "closest to low-risk" is still a real choice the human should make explicitly, not one this contract selects on its own. |

**Activity**: see Open questions #1 — no table exists to prune today, so
no window options are offered until the human confirms what, if anything,
this category refers to.

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
- Per TASK-032's acceptance criteria, operators must be able to **adjust or
  disable** pruning — meaning each category needs at minimum its own
  window/cap value and a way to express "disabled" for that category
  specifically (e.g. a sentinel value, or a companion boolean per
  category), not only a single global on/off switch. Whether the human
  wants per-category granularity or a single global switch is itself an
  open question — see Open questions #4.
- A `DaemonConfig.retention` (or similarly named) section is the natural
  home for these fields, matching the existing per-concern nesting
  (`api`, `db`, `mqtt`, `meshtastic`, `bot`, `coverage`) `config.ts`
  already uses. The exact field names, defaults, and whether mechanism
  cadence (e.g. "run every N hours") is itself configurable are not fixed
  by this contract — see Interfaces below for a proposal sketch, not a
  mandate.

## Postconditions and invariants

Not yet defined. Once the human selects windows, mechanism, and
deletion/archival strategy, this section must state, precisely: what
"pruned" means observably (rows physically removed from the table? moved
to an export artifact first?); that a prune operation never removes data
strictly newer than its configured cutoff, under any selected mechanism;
and that disabling pruning for a category (however that is expressed) is
honored exactly — no data in that category is ever removed while disabled,
regardless of age or count.

## Failure behavior

Not yet defined pending the mechanism decision. At minimum, whatever is
chosen must specify: what happens if a scheduled prune sweep fails
mid-transaction (must not partially delete a table — the existing
`db.transaction()` pattern already used throughout `migrations.ts` and
`open.ts`'s proxy is the established idiom for this); whether a prune
failure is fatal to the daemon (almost certainly not — data growth is not
an availability emergency the way a startup misconfiguration is under
CONTRACT-003) or merely logged; and what a malformed retention
configuration value does at startup (following CONTRACT-003's precedent:
fail fast with an aggregated, clear error, not a silent fallback).

## Interfaces

Sketch only — proposed shape, not a commitment, pending the Open questions
below. Once windows/mechanism/deletion strategy are chosen, this section
should be replaced with the exact schema, matching CONTRACT-003's
"Interfaces" section's level of precision (exact env var names, config
paths, types, defaults verified against chosen values).

```ts
// Illustrative only — every value below is a placeholder pending human decisions.
interface DaemonConfig {
  // ...existing sections unchanged...
  retention: {
    enabled: boolean; // global kill switch, or per-category only — see Open questions #4
    packets: { windowDays: number | undefined; maxRowsPerDevice: number | undefined };
    messages: { windowDays: number | undefined };
    telemetry: { windowDays: number | undefined }; // only if telemetry gets an independent window — Open questions #3
    cache: { windowDays: number | undefined };
    // activity: omitted pending Open questions #1
    mode: "scheduled" | "on-write" | "both"; // only if this is made configurable at all
    sweepIntervalHours: number | undefined; // only if "scheduled" or "both" is chosen
  };
}
```

## UX expectations

N/A as a distinct end-user-facing UI surface — this contract governs
backend data lifecycle, not frontend behavior. The one operator-facing
consequence is whatever the daemon logs when a prune sweep runs (row
counts removed per category, at minimum, so an operator upgrading into
this behavior for the first time can see what happened rather than
silently losing history) — exact logging format is left to the eventual
implementation contract once mechanism/window decisions are made.

## Validation requirements

Once policy is selected, TASK-032's own validation requirements already
name the right shape: boundary-condition tests per category (data exactly
at the retention edge, well within it, well past it) confirming a prune
operation never removes data inside the configured window and always
removes data past it; and a manual, documented check of a fresh install's
default retention behavior before shipping, since — per this task's own
framing — silent, undocumented data loss on upgrade is the primary risk
this whole contract exists to prevent. Additionally, whichever prune
queries are implemented must be checked against the index gaps this
contract identifies (no `rx_time`-only index on `packets`; no
`portnum_name` index for a telemetry-specific query; no `cached_at`-only
index on either cache table) so a prune sweep does not become an
unexpectedly expensive full-table scan on the categories with the highest
row counts.

## Open questions

Every item below requires an explicit human decision. None should be
treated as resolved by a "reasonable-sounding" default; per TASK-032's own
framing, a wrong default here is irreversible data loss for a real
operator, which is the reason this contract exists rather than leaving the
implementer to decide.

1. **What does "activity" retention actually mean?** The only persisted
   thing resembling "activity" today is the in-memory `ActivityLog`
   (`activity/log.ts`), which is not written to PGlite and already
   self-bounds at 500 entries. Does TASK-032 intend (a) this category is
   effectively already solved / not applicable to database pruning at all,
   (b) a new persisted activity/event-history table is expected to be
   built as part of this work (in which case its schema, not just its
   retention window, is undecided and arguably out of a pruning-contract's
   scope), or (c) "activity" was meant loosely to refer to one of the
   other four categories (e.g. packets) and should be dropped as a
   separate line item? This contract takes no position and cannot proceed
   on this category without an answer.
2. **Are `position_history`, `traceroutes`, and `mqtt_json_packets`
   in-scope for this contract, or deliberately deferred?** These three
   tables share the exact unbounded-growth shape TASK-032 warns about but
   are not named in its title. Silently including them expands TASK-032's
   scope beyond what was approved; silently excluding them leaves three
   more unbounded tables in production with no plan. Recommend the human
   either explicitly add them to this contract's per-category option
   tables above, or explicitly defer them to a follow-up task — but not
   leave the question unaddressed.
3. **Does telemetry get its own retention window, or share `packets`'
   window unconditionally?** See the Telemetry options table above. This
   also determines whether a `portnum_name`-based prune query (and
   possibly a new index) is required at all.
4. **Per-category configurability vs. a single global switch?** TASK-032's
   acceptance criteria say "operators can adjust or disable pruning" —
   ambiguous as to granularity. Per-category knobs are more flexible and
   match the differing tradeoffs identified above, but are more
   configuration surface to build, document, and get wrong; a single
   global on/off with one shared window is simpler but forces one
   size to fit categories whose value profiles (chat history vs. raw radio
   packets vs. re-derivable cache data) are demonstrably different in this
   document's own options tables.
5. **Deletion or export-then-delete?** See the dedicated options table
   above. TASK-032's Excluded section explicitly leaves this open rather
   than presuming deletion; this contract does the same.
6. **Mechanism: scheduled, on-write, or both?** See the dedicated options
   table above.
7. **Are the four tables this contract recommends excluding
   (`devices`, `nodes`, `channels`, `waypoints`, `mqtt_nodes`,
   `node_overrides`, `hw_models`, `coverage_proposals`) correctly excluded?**
   This contract's Required behavior section reasons that these are
   current-state/reference/user-authored tables rather than event-history
   tables, and therefore out of scope by nature rather than by omission —
   but that reasoning itself is a judgment call the human should confirm,
   particularly for `coverage_proposals`, which does carry a `created_at`
   timestamp even though it is user-authored planning content.
8. **What should a fresh install's *default* retention behavior be** —
   i.e., is any pruning enabled out of the box, or is the safe default
   "disabled until an operator opts in," even though that means the
   unbounded-growth problem persists by default for anyone who doesn't
   explicitly configure retention? TASK-032's acceptance criteria call for
   defaults that "don't silently delete data an upgrading operator would
   expect to keep" — the safest reading of that constraint may be
   "pruning is off by default," which is itself worth the human stating
   explicitly rather than an implementer inferring it.
