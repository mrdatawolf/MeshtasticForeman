# TASK-018: Split the application shell into focused components

Owner role: UX Specialist
Assigned agent: interface-designer
Proposed by: jarvis
Proposed date: 2026-08-24
Approved by: Patrick
Approved date: 08/24/26
Related contracts: None
Related ADRs: None
Dependencies: TASK-017 (build the new shell components against the finalized state/store shape, not the old `useState` sprawl)

## Desired outcome

`App.tsx` is decomposed into `AppShell`, `MainNavigation`, `DeviceMenu`, `GpsMenu`, `MqttMenu`, and `SettingsMenu`, with the four duplicated outside-click effects replaced by one tested `useClickOutside` hook.

## Context

Confirmed exactly four near-identical outside-click `useEffect`s in `App.tsx` at lines 156–200 (device menu, MQTT panel, settings panel, GPS panel), each independently calling `document.addEventListener("mousedown", handler)`.

## Scope

### Included

The five named shell components; one `useClickOutside` hook (tested) replacing all four duplicated effects; `App.tsx` reduced to composing these components and routing.

### Excluded

Changing any visual design or interaction behavior — this is a structural extraction, not a redesign (flag any genuine UX improvement opportunity you notice separately rather than folding it in here).

## Plan

1) Extract `useClickOutside(ref, onOutside)` as a tested hook. 2) Replace all four duplicated effects with it. 3) Extract `DeviceMenu`, `GpsMenu`, `MqttMenu`, `SettingsMenu` as components consuming the store from TASK-017. 4) Extract `MainNavigation`. 5) Compose all of the above plus routed pages inside `AppShell`, with `App.tsx` reduced to essentially just rendering `AppShell`.

## Acceptance criteria

- [x] `useClickOutside` is a single, tested hook used by all four menus (device, GPS, MQTT, settings).
- [x] `AppShell`, `MainNavigation`, `DeviceMenu`, `GpsMenu`, `MqttMenu`, `SettingsMenu` exist as focused components.
- [x] `App.tsx` primarily composes the shell and routes, per the roadmap's own Stage 4 completion criteria.
- [x] No visible interaction or styling change (verified by structural comparison for all four menus and navigation; live-browser regression was unavailable in this environment).

## Validation requirements

`useClickOutside` unit tests (TASK-010 infra); manual interaction regression pass on all four menus across at least two browsers/viewport sizes given interface-designer's responsive-behavior remit.

## Risks and assumptions

Assumes TASK-017 lands first; if you want to parallelize instead, this task can be rebuilt against the old `useState` shape and rewired afterward, but that's more total work — sequential is recommended.

## Blocker

None.

## Implementation handoff

Implemented the application-shell extraction without changing the TASK-017 reducer.

### Changes

- Added the single outside-click hook at `packages/web/src/hooks/useClickOutside.ts` and its colocated tests at `packages/web/src/hooks/useClickOutside.test.ts`.
- Added focused shell components at `packages/web/src/components/shell/AppShell.tsx`, `MainNavigation.tsx`, `DeviceMenu.tsx`, `GpsMenu.tsx`, `MqttMenu.tsx`, and `SettingsMenu.tsx`.
- Added shared shell-only style helpers/constants at `packages/web/src/components/shell/shellStyles.ts` and shell UI types at `packages/web/src/components/shell/types.ts` so the extracted JSX continues to use the original values.
- Reduced `packages/web/src/App.tsx` from 1,432 to 67 lines. It now retains the reducer, overrides fetch, WebSocket connection/event cleanup, message-history initialization, connection state, and GPS request reconciliation, then renders `AppShell`.
- `AppShell` owns shell/page UI state, derived node views, header composition, routed page content, IntroModal, and API Docs modal. It continues the existing page prop-passing pattern; no context was introduced.

### Acceptance evidence

1. `useClickOutside`: all four menu components call the hook with their own ref/open state. `rg` found the only shell-menu `document.addEventListener("mousedown", ...)` registration inside the hook; none remain in `App.tsx` or shell components. (An unrelated pre-existing `MessagesPage.tsx` listener remains outside this task's four-menu scope.) Tests cover enabled outside click, inside click suppression, disabled/no-registration behavior, and unmount cleanup; targeted result: 1 file passed, 4 tests passed.
2. Focused files: all six named exported components exist in separate files under `packages/web/src/components/shell/`.
3. Root reduction: `App.tsx` contains no inline menu, navigation, routed-page, modal, or style-heavy JSX; it renders one `AppShell` with root data/connection props.
4. Structural regression audit against the original `/tmp/TASK-018-App-original.tsx`:
   - GPS: compared connected-device filtering, GPS availability/color, button/dropdown positioning, every GPS detail row and fallback, pending/disabled/spinner styles, request payload, 15-second timeout, and no-node-ID message. Open toggle and outside close are unchanged.
   - MQTT: compared status/scope labels and colors, broker toggle payload, region warning/path, five scope choices/titles, node-count conditions, panel structure, and exact shared styles. Scope selection continues to leave the panel open; outside click closes it.
   - Device/API: compared status button, device empty/list states, status/firmware/last-seen/battery presentation, connect/disconnect requests, Activity/Logs/API Docs actions, map/activity/log filters and counts, API status/version footer, and exact shared styles. Navigation/API Docs selection closes the menu; outside click closes it.
   - Settings: compared button/panel styles, Overrides count, Device Config target, active states, and selection close behavior; outside click closes it.
   - Main navigation: compared the four labels/order (`Nodes`, `Map`, `Messages`, `Analytics`), active `tabStyle`, and direct tab-selection callbacks.

### Validation

- Initial baseline attempt, `pnpm --filter @foreman/web test`: failed before execution because `pnpm` was absent from the default PATH. A subsequent `corepack pnpm --version` under system Node 20.19.2 also failed because the repository requires Node >=22.13. Validation then used installed Node 22.22.3 via PATH and the pinned Corepack pnpm.
- Early validation invocation, `corepack pnpm --filter @foreman/web test -- src/hooks/useClickOutside.test.ts`: passed 11 files / 38 tests (Vitest argument forwarding ran the full suite). This established 34 pre-existing tests plus the 4 new tests; the orchestrator-provided pre-change count was preserved.
- `corepack pnpm --filter @foreman/web build` after extraction: passed (`tsc --noEmit`, Vite 1,849 modules); only Vite's non-failing large-chunk warning.
- Targeted formatting followed by `corepack pnpm --filter @foreman/web build`: passed again (`tsc --noEmit`, Vite 1,849 modules); same non-failing warning.
- Narrow hook command, `corepack pnpm --filter @foreman/web exec vitest run src/hooks/useClickOutside.test.ts`: passed 1 file / 4 tests.
- Full command, `corepack pnpm --filter @foreman/web test`: passed 11 files / 38 tests.
- Additional `corepack pnpm --filter @foreman/web lint`: initially failed on seven new import-order errors; the imports were mechanically fixed. Rerun completed with 0 errors and 5 pre-existing hook-dependency warnings in unrelated page files.
- Final `corepack pnpm --filter @foreman/web build`: passed (`tsc --noEmit`, Vite 1,849 modules); same non-failing warning.
- Final `corepack pnpm --filter @foreman/web test`: passed 11 files / 38 tests.

### Assumptions and risks

- No live browser was available, so the task's requested two-browser/two-viewport manual pass could not be performed. Visual and interaction preservation was checked by direct structural/JSX comparison instead. A reviewer should still smoke-test all menus at desktop and narrow viewport sizes.
- Menu open state moved into each focused component. The original cross-menu close behavior is preserved by `mousedown` outside detection before another menu button's `click`, and selection handlers explicitly close their owning menu.
- No UX improvements or reducer changes were included.

## Review

Not reviewed.

## Human acceptance

Pending.
