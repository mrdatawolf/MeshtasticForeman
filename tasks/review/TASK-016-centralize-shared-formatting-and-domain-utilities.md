# TASK-016: Centralize shared formatting and domain utilities

Owner role: Implementer
Assigned agent: openai-coder
Proposed by: jarvis
Proposed date: 2026-08-24
Approved by: Patrick
Approved date: 08/24/26
Related contracts: None
Related ADRs: None
Dependencies: None

## Desired outcome

Node-ID formatting, relative-time formatting, node-name resolution, and modem-preset mappings each have one implementation, used consistently across daemon and web rather than being reimplemented per-file.

## Context

Confirmed patterns like `nodeHex(id)` appear in `NodeDetailPanel.tsx`; similar formatting almost certainly recurs across `NodesPage.tsx`, `MapPage.tsx`, `AnalyticsPage.tsx`, and daemon-side code — exact duplication sites to be enumerated during implementation via grep for hex-formatting/`toString(16)`/relative-time patterns (already visible in `mqtt/gateway.ts`'s `fromNum.toString(16).padStart(8,"0")` pattern, repeated multiple times in that file alone).

## Scope

### Included

A `packages/shared` (or split daemon/web-appropriate) module for: node-ID formatting (hex node-ID display), relative-time formatting, node-name resolution/fallback logic, and modem-preset name mappings; replacing duplicated inline implementations with calls to the shared module.

### Excluded

Any change to the formatted *output* — this is deduplication, not a UX change (that would belong to Stage 4/`interface-designer` work instead).

## Plan

1) Grep daemon and web for duplicated formatting logic matching the four named categories. 2) Decide placement — likely `packages/shared` for anything used by both daemon and web (e.g. modem-preset mappings, node-ID formatting), web-only for anything purely presentational (e.g. relative time strings if daemon never needs them). 3) Extract, test, and replace call sites one category at a time.

## Acceptance criteria

- [ ] Node-ID formatting has one implementation used everywhere it currently appears duplicated.
- [ ] Relative-time formatting has one implementation.
- [ ] Node-name resolution/fallback logic has one implementation.
- [ ] Modem-preset mappings have one implementation.
- [ ] No visible output changes in the UI (verified by manual comparison of before/after rendering for a representative page like `NodesPage.tsx`).

## Validation requirements

Unit tests for each extracted utility (using TASK-009's shared-package test infra); manual visual comparison of at least `NodesPage.tsx` and `NodeDetailPanel.tsx` before/after.

## Risks and assumptions

Low risk, purely a DRY refactor, but touches many call sites — recommend doing this incrementally (one utility category per commit) for reviewability.

## Blocker

None.

## Implementation handoff

Implementer: openai-coder
Date: 2026-08-24

### Changes made and grep inventory

- Node-ID formatting: grep found local `nodeHex` implementations in `packages/web/src/pages/NodesPage.tsx` (`nodeHex`, search and table ID), `NodeDetailPanel.tsx` (`nodeHex`, header/detail/traceroute routes), `MessagesPage.tsx` (`nodeHex`, thread/picker/name fallback), `NodeOverridesPage.tsx` (`nodeHex`, form/candidate/table IDs), `MapPage.tsx` (`nodeHex`, search, focus labels, markers, popups, stacked nodes), and `AnalyticsPage.tsx` (top-level and packet-log-local `nodeHex`, labels/log rows). Daemon inline formatting was in `packages/daemon/src/mqtt/gateway.ts` (gateway ID; node-info, position, publish, inbound/decrypt/decoded/POSITION/JSON logs; `fromHex`), `packages/daemon/src/device/device-manager.ts` (traceroute, my-node, bot/status/raw packet/node-info logs and `fromHex`), and `packages/daemon/src/routes/websocket.ts` (request-position, traceroute, and remove success/failure logs). All now call `formatNodeId` from `packages/shared/src/domain-utils.ts`. Shared is appropriate because both runtime packages use it. The optional minimum length preserves the daemon traceroute route's pre-existing unpadded `!` + hex output; all normal calls retain eight-character lowercase padding. The remaining `toString(16).padStart(2, "0")` is byte serialization, not node-ID display.
- Relative time: grep found identical `s/m/h/d ago` implementations in `packages/web/src/App.tsx` (`formatRelative`), `packages/web/src/pages/NodesPage.tsx`, `NodeDetailPanel.tsx`, and `MapPage.tsx` (`formatLastHeard`). No daemon relative-time presentation was found; daemon `Date.now()` differences are TTL/recalculation/silence control logic. The single implementation is `packages/web/src/lib/relativeTime.ts`, with a caller-selected empty value preserving `"—"` versus Map's `"never"`. Web-only placement avoids putting presentation-only time wording in the domain package.
- Node-name resolution: grep found display fallbacks in `NodesPage.tsx` (long → short → `Unknown`, plus name sorting), `NodeDetailPanel.tsx` (long → short → `Unknown`), `MessagesPage.tsx` (mesh short → mesh long → MQTT short → MQTT long → hex, plus picker fallback), `MapPage.tsx` (long/short/hex focus and long/hex or short/last-four marker/popup labels), `AnalyticsPage.tsx` (long → short → hex and short → last-four hex), and `NodeOverridesPage.tsx` (long → short → empty/unnamed). Daemon had one display-name fallback in `device-manager.ts`'s node-info log (long → short → `?`). These now use `resolveNodeName` in `packages/shared/src/domain-utils.ts`; its ordered sources, ordered fields, and explicit fallback preserve each existing sequence. Shared placement is justified by the daemon log use as well as web use. Raw persistence assignments and independent search-field extraction were intentionally left alone because they do not resolve a display name.
- Modem-preset mapping: grep found duplicate numeric-to-canonical-name tables in `packages/web/src/pages/DeviceConfigPage.tsx` (`MODEM_PRESET`) and `packages/web/src/pages/MapPage.tsx` (`MODEM_PRESET_LABEL`). Both now consume `MODEM_PRESET_LABELS` from `packages/shared/src/domain-utils.ts`. Shared placement reflects Meshtastic domain enum data rather than UI-specific presentation. Map's unique coverage-radius table and channel-name parser were not duplicates and retain their behavior.
- Added behavior-focused tests in `packages/shared/src/domain-utils.test.ts` for node IDs (including the unpadded compatibility option), node-name ordering/fallbacks, and all nine modem labels; added `packages/web/src/lib/relativeTime.test.ts` for seconds/minutes/hours/days and both null fallbacks. Exported shared utilities from `packages/shared/src/index.ts`.

### Manual before/after comparison

Before editing, exact copies of `NodesPage.tsx` and `NodeDetailPanel.tsx` were saved under `/tmp`; `diff -u` was run against the completed files. For `NodesPage`, the compared render paths were name (`longName ?? shortName ?? "Unknown"`), node ID, and last-heard output; for `NodeDetailPanel`, they were header name, header/detail IDs, last-heard, and forward/back traceroute IDs. JSX structure, secondary short-name rendering, separators, and empty labels are unchanged. The new tests demonstrate byte-identical representative output: `0x1a2b` → `!00001a2b`, `0xabcdef01` → `!abcdef01`, long/short/missing name cases retain their old order and fallback, null remains `"—"` or `"never"` by page, and the same `29s`, `30m`, `3h`, and `2d ago` strings are produced.

### Validation performed

- `pnpm --filter @foreman/shared test -- domain-utils.test.ts && pnpm --filter @foreman/web test -- relativeTime.test.ts` — failed before execution: `pnpm: command not found`.
- `corepack pnpm --filter @foreman/shared test -- domain-utils.test.ts && corepack pnpm --filter @foreman/web test -- relativeTime.test.ts` — failed before tests under system Node 20.19.2 with `ERR_VM_DYNAMIC_IMPORT_CALLBACK_MISSING`. All subsequent pnpm commands used the required Node 22.22.3 via `PATH=/home/patrick/.nvm/versions/node/v22.22.3/bin:$PATH corepack pnpm`.
- Narrow shared/web test rerun with that Node 22 prefix — passed: shared 2 files/30 tests (Vitest also selected the existing shared test file); web 9 files/30 tests (Vitest also selected existing web test files).
- First build checkpoint: shared build passed (`tsc --noEmit`); daemon build passed (`tsc --noEmit`); web build passed (`tsc --noEmit && vite build`, 1,825 modules). Vite emitted only its existing large-chunk advisory.
- First full matrix: shared build passed; shared test passed (2 files/30 tests); daemon build passed. The first daemon test process was inadvertently left running when the command yielded, and an overlapping second daemon test run failed with database-worker timeouts (3 files failed, 9 tests failed, 135 passed). After both processes ended, an isolated rerun passed (7 files/144 tests), establishing that the overlap—not source behavior—caused the transient failures. Web test passed (9 files/30 tests).
- `pnpm exec prettier --check` on every touched source/test file — initially reported five files needing formatting. `pnpm exec prettier --write` was run only on those five touched files (`mqtt/gateway.ts`, `device-manager.ts`, `routes/websocket.ts`, `App.tsx`, `MapPage.tsx`).
- Final clean suite after formatting: shared build passed; shared test passed (2 files/30 tests); daemon build passed; daemon test passed in isolation (7 files/144 tests); web build passed (1,825 modules, only the large-chunk advisory); web test passed (9 files/30 tests); touched-file Prettier check passed.
- Final grep for `toString(16)`, local `nodeHex` definitions, relative-time arithmetic, name fallback patterns, and modem label tables found only the centralized implementations, aliases/calls, raw data/search extraction, the unique radius mapping, and non-node two-digit byte encoding.

### Acceptance criteria evidence

- Node-ID formatting has one implementation used everywhere it currently appears duplicated: met by `formatNodeId`; final grep found no local node-ID formatter or inline node-ID hex conversion.
- Relative-time formatting has one implementation: met by web-only `formatRelativeTime`; all four former implementations call it.
- Node-name resolution/fallback logic has one implementation: met by shared `resolveNodeName`; all identified display/log fallback sites use it with compatibility options.
- Modem-preset mappings have one implementation: met by shared `MODEM_PRESET_LABELS`; Device Config and Map import it.
- No visible UI output changes: met by exact saved-source diffs for `NodesPage.tsx` and `NodeDetailPanel.tsx`, representative equivalence tests, successful builds, and unchanged JSX/separators/fallback values.

### Assumptions and deviations

- Empty strings continue to behave as absent names, matching the former truthy checks and practical nullish data model.
- The daemon traceroute route list intentionally remains unpadded, unlike normal node IDs; `formatNodeId(id, 0)` preserves that existing output instead of silently normalizing it.
- Category extraction was implemented in one source-edit pass after the complete inventory, so the requested full package matrix was not completed separately after each individual category. Narrow tests and builds were run during iteration, followed by repeated/full clean matrices. No behavior or scope was expanded to compensate for this procedural deviation.
- The Node 22 PATH prefix was necessary because the sandbox defaulted to Node 20 despite the repository requiring Node >=22.13.

### Unresolved risks

- No live browser was available; UI equivalence rests on exact source comparison, unit equivalence tests, and the production web build. No known functional risk remains.
- The pnpm warning that the root `pnpm.onlyBuiltDependencies` field is ignored is pre-existing and unrelated.

### Documentation updated

Only this implementation handoff was updated. `API_PROMISES.md`, `docs/api/`, and `docs/ARCHITECTURE.md` were not touched.

## Review

Not reviewed.

## Human acceptance

Pending.
