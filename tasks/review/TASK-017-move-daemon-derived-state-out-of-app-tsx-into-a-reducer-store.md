# TASK-017: Move daemon-derived state out of App.tsx into a reducer/store

Owner role: Implementer
Assigned agent: openai-coder
Proposed by: jarvis
Proposed date: 2026-08-24
Approved by: Patrick
Approved date: 08/24/26
Related contracts: None initially (contract can follow once the store shape is settled, at your discretion)
Related ADRs: ADR-001 (Accepted 2026-08-24 — decision: React `useReducer`, not a dedicated store)
Dependencies: None remaining — ADR-001 is Accepted, satisfying the prior blocker.

## Desired outcome

Devices, mesh nodes, MQTT nodes, activity, logs, configuration, and WebSocket events are managed by a reducer or dedicated store, not scattered `useState` calls in `App.tsx`; a new `ServerEvent` variant produces a compiler error until handled or deliberately ignored (exhaustive handling).

## Context

Confirmed `App.tsx` (1118 lines) currently handles `ServerEvent`s via a chain of `if (event.type === "...")` checks (13+ branches confirmed at lines 224–288) rather than an exhaustive switch — exactly the gap the roadmap names. TASK-009 already adds a compile-time exhaustiveness *type* check at the shared-schema level; this task makes the actual consumer (`App.tsx`) exhaustive too. Note: this decision materially overlaps with the Stage 6 item "record an ADR for WebSocket state ownership" — I recommend deciding that now (ADR-001) rather than documenting it retrospectively after the fact in Stage 6's TASK-034, so the decision drives the implementation instead of chasing it.

## Scope

### Included

Design and implement the chosen state-management approach (per ADR-001) for the seven named state categories; convert `App.tsx`'s `if`-chain event handling into an exhaustive construct (switch with a `never`-check default, or equivalent); keep transient UI state (selected tab, open menu) local to the components that render it, explicitly *not* moved into the new store.

### Excluded

Splitting `App.tsx` into shell components (TASK-018) — that's a separate task, though closely related and dependent on this one landing first so the new components are built against the final state shape rather than being rewired afterward.

## Plan

1) (Prerequisite, tracked as ADR-001) Decide reducer-in-React vs. small dedicated store (e.g. Zustand-style, or hand-rolled) with you. 2) Design the store's state shape and action/event-handling surface. 3) Implement it, migrating the seven state categories one at a time. 4) Convert event dispatch to an exhaustive switch. 5) Confirm no behavioral regression across Nodes, Map, Messages, Analytics, Activity, Logs, and Device Config pages (all consume this state).

## Acceptance criteria

- [ ] ADR-001 is approved before this task is approved for implementation.
- [ ] Devices, mesh nodes, MQTT nodes, activity, logs, configuration, and WebSocket events are managed outside ad hoc `useState` in `App.tsx`.
- [ ] Adding a new `ServerEvent` variant without handling it produces a TypeScript compile error (verified by a deliberate test addition, then reverted).
- [ ] Transient UI state remains local to its component, not lifted into the new store.
- [ ] All pages consuming this state (Nodes, Map, Messages, Analytics, Activity, Logs, Device Config) behave identically before/after (manual regression pass).

## Validation requirements

Full manual regression pass across every page listed above, since this is the highest cross-cutting risk in Stage 4 — it touches state consumed by literally every page. Recommend QualityAssurance review before acceptance.

## Risks and assumptions

This is the largest single risk in Stage 4 given how central this state is. Strongly recommend not combining this with TASK-018 in one PR even though they're related — keep them independently reviewable as scoped.

## Blocker

None.

## Implementation handoff

Implementer: openai-coder
Date: 2026-08-24

### Changes made

- Added `packages/web/src/appState.ts`, containing a plain React reducer state shape of
  `{ devices: DeviceInfo[]; nodes: NodeInfo[]; mqttNodes: MqttNode[];
  activity: ActivityEntry[]; logs: LogEntry[]; mqttEnabled: boolean;
  deviceConfigs: Map<string, DeviceConfig> }` and an action type of `ServerEvent`
  (the reducer accepts and dispatches server event objects directly).
- Replaced the seven corresponding ad hoc `useState` calls in `App.tsx` with
  `useReducer(appStateReducer, initialAppState)`. All derived values remain local
  computations sourced from the reducer fields.
- Replaced the WebSocket event `if` chain with one `dispatch(event)`. The reducer has
  an exhaustive `switch (event.type)` covering all 23 current `ServerEvent` variants
  and a `default` arm containing `event satisfies never`.
- Preserved the existing `device:list` `loadRecentMessages(device.id)` side effect and
  the `device:status` GPS-pending cleanup beside `dispatch(event)` in the subscription,
  outside the pure reducer.
- Explicitly left the ten previously ignored variants as reducer no-ops, including
  `node:removed`; no event-coverage gaps were changed as part of this refactor.

### Validation performed

- Baseline attempt before source edits: `pnpm --filter @foreman/web test` could not
  start because the non-login sandbox shell had no `pnpm` on `PATH` and printed
  `/bin/bash: line 1: pnpm: command not found`. The repository's pinned pnpm was then
  invoked directly with Node 22 for all executable validation. Consequently, a valid
  pre-edit numeric baseline was not available.
- Exhaustiveness failure command (with the `node:removed` case temporarily commented):
  `cd packages/web && /home/patrick/.nvm/versions/node/v22.22.3/bin/node node_modules/typescript/bin/tsc --noEmit --skipLibCheck --target ES2022 --module NodeNext --moduleResolution NodeNext src/appState.ts`.
  Exact compiler error: `src/appState.ts(101,13): error TS1360: Type '{ type:
  "node:removed"; payload: { nodeId: number; }; }' does not satisfy the expected type
  'never'.`
- Restored-case command: the identical reducer-only TypeScript command completed with
  no errors. Full package typecheck also passed via
  `/home/patrick/.nvm/versions/node/v22.22.3/bin/node /home/patrick/.cache/node/corepack/pnpm/11.21.0/bin/pnpm.cjs --filter @foreman/web exec tsc --noEmit` (exit 0, no compiler output).
- Full build:
  `/home/patrick/.nvm/versions/node/v22.22.3/bin/node /home/patrick/.cache/node/corepack/pnpm/11.21.0/bin/pnpm.cjs --filter @foreman/web build` passed. TypeScript passed;
  Vite transformed 1,841 modules and built in 7.96s. Vite emitted only its chunk-size
  advisory.
- Full final test:
  `/home/patrick/.nvm/versions/node/v22.22.3/bin/node /home/patrick/.cache/node/corepack/pnpm/11.21.0/bin/pnpm.cjs --filter @foreman/web test` passed: 10 test files and 34 tests. An earlier mid-work run passed 9 files and 30 tests; the increase came from concurrent web work. No failing tests were observed, but no numeric pre-edit baseline can be claimed because of the PATH issue above.
- Formatting:
  `/home/patrick/.nvm/versions/node/v22.22.3/bin/node node_modules/prettier/bin/prettier.cjs --check packages/web/src/App.tsx packages/web/src/appState.ts` passed.
- Several intermediate builds were run. They initially exposed only incomplete concurrent
  edits in Analytics and Map files; after those agents' edits settled, the final build
  above passed. No changes were made to those files for TASK-017.

### Acceptance criteria evidence

- `NodesPage`: its interface remains `DeviceInfo[]`, `NodeInfo[]`, and `MqttNode[]`;
  the call site supplies reducer `devices`, override-applied `effectiveNodes`, and
  scoped `effectiveMqttNodes` exactly as before.
- `MapPage`: its interface remains `NodeInfo[]`, `MqttNode[]`, optional connected
  `deviceId`, and optional `Map<string, DeviceConfig>`; the call site supplies the same
  derived arrays, reducer-backed connected device id, and reducer `deviceConfigs`.
- `MessagesPage`: its interface remains `DeviceInfo[]`, `NodeInfo[]`, and `MqttNode[]`;
  the same reducer/derived values are supplied.
- `ActivityPage`: its `ActivityEntry[]` `entries` prop is supplied from reducer
  `activity`; all local filter/pause state is unchanged.
- `LogsPage`: its `LogEntry[]` `entries` prop is supplied from reducer `logs`; all local
  filter/pause state is unchanged.
- `NodeOverridesPage`: remains sourced only from REST-backed local `overrides` plus the
  locally derived no-location list; its interface and call site are untouched.
- `DeviceConfigPage`: its `DeviceInfo[]` and `Map<string, DeviceConfig>` props are now
  sourced from the reducer with the same shapes.
- `AnalyticsPage`: its interface remains `NodeInfo[]`, `MqttNode[]`, and `DeviceInfo[]`;
  the call site still supplies effective mesh/MQTT arrays and reducer `devices`.
- No live browser was available; regression evidence is interface/call-site inspection,
  successful full TypeScript/Vite build, and the full automated web suite.

### Assumptions and deviations

- The seven-category boundary was treated as exact. `overrides`, connection status,
  GPS-pending state, navigation/panel/filter state, wizard state, message target, and
  focused coverage node remain local `useState` values per ADR-001.
- `gpsPending` is cleared in the subscription immediately after dispatch only for a
  `device:status` carrying `gpsDetail`, preserving the previous trigger exactly.
- `loadRecentMessages` remains a subscription side effect for every device in each
  `device:list` payload.
- The seven fields were wired into the single reducer atomically because the exhaustive
  reducer transition surface was created as one unit. Repeated build attempts were made
  during migration, but concurrent incomplete Analytics/Map edits prevented clean
  per-field build evidence. The settled-tree full build and typecheck pass.
- Direct `pnpm` was unavailable in the sandbox PATH; the exact pinned pnpm 11.21.0 entry
  point was executed with the repository-required Node 22.22.3 instead.

### Unresolved risks

- No live-browser regression pass was possible.
- `node:removed` remains an intentional no-op to preserve current behavior; this is an
  observed coverage gap suitable for a separate behavior-changing task.
- A numeric pre-change test baseline was not captured because the initial direct command
  could not launch. Final coverage is 10 files / 34 tests, all passing.

### Documentation updated

- Updated this inline implementation handoff only. No architecture or public behavior
  changed beyond the already accepted ADR-001, so no additional durable documentation
  was required.

## Review

Not reviewed.

## Human acceptance

Pending.
