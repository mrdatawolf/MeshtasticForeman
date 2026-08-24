# TASK-018: Split the application shell into focused components

Owner role: UX Specialist
Assigned agent: interface-designer
Proposed by: jarvis
Proposed date: 2026-08-24
Approved by:
Approved date:
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

- [ ] `useClickOutside` is a single, tested hook used by all four menus (device, GPS, MQTT, settings).
- [ ] `AppShell`, `MainNavigation`, `DeviceMenu`, `GpsMenu`, `MqttMenu`, `SettingsMenu` exist as focused components.
- [ ] `App.tsx` primarily composes the shell and routes, per the roadmap's own Stage 4 completion criteria.
- [ ] No visible interaction or styling change (manual regression pass on all four menus: open, close via click-outside, close via selection).

## Validation requirements

`useClickOutside` unit tests (TASK-010 infra); manual interaction regression pass on all four menus across at least two browsers/viewport sizes given interface-designer's responsive-behavior remit.

## Risks and assumptions

Assumes TASK-017 lands first; if you want to parallelize instead, this task can be rebuilt against the old `useState` shape and rewired afterward, but that's more total work — sequential is recommended.

## Blocker

None.

## Implementation handoff

Not started.

## Review

Not reviewed.

## Human acceptance

Pending.
