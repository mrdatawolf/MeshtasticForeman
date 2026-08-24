# TASK-021: Split DeviceConfigPage.tsx into wizard, cards, field editors, and pure transforms

Owner role: UX Specialist
Assigned agent: interface-designer
Proposed by: jarvis
Proposed date: 2026-08-24
Approved by:
Approved date:
Related contracts: **CONTRACT-012 recommended, optional/my addition** (pure configuration-transformation functions carry real consequence — a bad transform could misconfigure a physical radio — but this wasn't one of your named Stage 3–5 examples, so treat as a suggestion to accept or decline)
Related ADRs: None
Dependencies: TASK-011 (setup-wizard output logic already extracted and tested)

## Desired outcome

`DeviceConfigPage.tsx` (1061 lines) is split into the setup wizard, configuration cards, field editors, and pure configuration-transformation functions.

## Context

This page pushes configuration to a physically connected radio via `setDeviceConfigSchema`/`requestDeviceConfigSchema` (confirmed in `packages/shared/src/ws-protocol.ts`) — meaning bugs here have real hardware-configuration consequences, not just cosmetic ones, which is why I'm flagging the optional contract.

## Scope

### Included

Extracting the setup wizard (building on TASK-011's already-extracted wizard-output logic), configuration cards, individual field editors, and any remaining pure configuration-transformation functions (defaults/merging beyond what TASK-011 already extracted) into separate modules/components.

### Excluded

Any change to what configuration options exist or how they're validated before sending to the device — behavior-preserving restructuring only.

## Plan

1) Confirm TASK-011's wizard-output extraction is in place. 2) Extract configuration cards (grouped settings sections) as components. 3) Extract individual field editors as reusable components. 4) Identify and extract any remaining pure transformation logic (e.g. building the final `setDeviceConfigSchema` payload from form state) not already covered by TASK-011. 5) Leave `DeviceConfigPage` orchestrating wizard vs. direct-edit flows.

## Acceptance criteria

- [ ] Setup wizard, configuration cards, field editors, and pure transformation functions are each in separate, focused modules.
- [ ] No change to what configuration values get sent to the device for a given set of user inputs (verified by comparing the constructed `setDeviceConfigSchema` payload before/after for representative inputs).
- [ ] No visible change to the wizard or configuration UI (manual regression pass).

## Validation requirements

Given the real-hardware consequence, this task warrants more than a visual smoke test — recommend a before/after comparison of the actual payload sent to `setDeviceConfigSchema` for a fixed set of test inputs, not just "the UI looks the same." Manual regression pass against a real or simulated device connection if available.

## Risks and assumptions

Highest-consequence Stage 4 task despite not being the largest file — a transform bug here can misconfigure a physical radio, unlike the other Stage 4 splits which are purely presentational risk.

## Blocker

None.

## Implementation handoff

Not started.

## Review

Not reviewed.

## Human acceptance

Pending.
