# TASK-013: Introduce a typed frontend HTTP client

Owner role: Implementer
Assigned agent: openai-coder
Proposed by: jarvis
Proposed date: 2026-08-24
Approved by: Patrick
Approved date: 08/24/26
Related contracts: **CONTRACT-002 recommended, borderline** (cross-cutting since used everywhere, but wraps an already-contracted API per `API_PROMISES.md` — propose and let you decide per change-classification.md's "when uncertain, propose a contract")
Related ADRs: None
Dependencies: None (can proceed independently; TASK-020/TASK-021 will consume it once split, but this task itself doesn't require them)

## Desired outcome

`packages/web/src/api/` contains small, feature-specific typed HTTP modules (devices, analytics, coverage, proposals, overrides, configuration) that consistently check `response.ok`, decode structured errors, encode query parameters, support `AbortSignal`, and handle empty responses — replacing scattered direct `fetch()` calls.

## Context

Confirmed direct `apiFetch<T>()` calls exist in `AnalyticsPage.tsx` (e.g. `/api/traceroutes`, `/api/analytics/message-latency`, `/api/analytics/link-quality`) and presumably elsewhere; there's already an `apiFetch` helper in use, so this task may be formalizing/relocating an existing informal pattern rather than starting from nothing — confirm during implementation.

## Scope

### Included

The six named feature modules; consistent error decoding and `response.ok` handling; `AbortSignal` support for cancellable requests; query-parameter encoding helpers; migrating feature-by-feature (not all at once, per the roadmap's explicit instruction) starting with whichever feature is being touched by a concurrent task (e.g. analytics, to dovetail with TASK-020).

### Excluded

Migrating every single `fetch()` call in one PR — this task establishes the client and modules and does an initial migration wave; full migration may span multiple follow-up PRs under the same task or a tracked continuation, at your discretion.

## Plan

1) Locate the existing `apiFetch` helper and any other direct `fetch()` call sites to scope the real size of migration. 2) Design the shared client core (error decoding, `AbortSignal`, query encoding) once. 3) Build the six feature modules on top of it. 4) Migrate the analytics feature first (dovetails with TASK-020's page split) as the proof case; migrate remaining features incrementally.

## Acceptance criteria

- [ ] `packages/web/src/api/` contains devices, analytics, coverage, proposals, overrides, and configuration modules.
- [ ] All modules share one core client that checks `response.ok`, decodes structured errors consistently, supports `AbortSignal`, and handles empty (204/no-body) responses.
- [ ] At least the analytics feature is fully migrated to the new client as part of this task.
- [ ] Remaining direct `fetch()` call sites are enumerated (e.g. as a checklist or follow-up note) so migration progress is trackable.

## Validation requirements

TASK-010's web test infra used to unit test the client core (error decoding, abort behavior) in isolation; manual smoke test of the migrated analytics feature.

## Risks and assumptions

Flagging the contract question directly for your call: is this internal plumbing (no contract needed, acceptance criteria suffice) or does its cross-cutting reach across every feature warrant locking down its error/response conventions in a contract before implementation? I lean toward "propose, let you decide."

## Blocker

None.

## Implementation handoff

Implementer: openai-coder
Date: 2026-08-24

### Changes made

- Added `packages/web/src/api/client.ts` with CONTRACT-002's exact exported
  `ClientError`, `RequestOptions`, and `request<T>()` interfaces. The core is the
  only implementation of fetch, `response.ok` gating, structured REST error
  decoding, `URLSearchParams` query encoding, JSON request serialization,
  `AbortSignal` passthrough, and 204/empty-2xx handling.
- Added six thin feature modules, all delegating to `request<T>()`:
  - `devices.ts`: list, connect, get, list device nodes, get device config, and
    disconnect (`GET /api/devices`, `POST /api/devices/connect`, `GET
    /api/devices/:id`, `GET /api/devices/:id/nodes`, `GET
    /api/devices/:id/config`, `DELETE /api/devices/:id`).
  - `analytics.ts`: SNR history, message volume, delivery, busiest nodes,
    portnum breakdown, packet timeline, hop distribution, hardware breakdown,
    channel utilization, message latency, telemetry history, link quality, node
    activity, neighbor graph, position history, traceroutes, and packet log.
  - `coverage.ts`: get/delete viewshed (`GET`/`DELETE
    /api/coverage/viewshed`).
  - `proposals.ts`: list, create, update, and delete (`GET`/`POST
    /api/proposals`, `PATCH`/`DELETE /api/proposals/:id`).
  - `overrides.ts`: list, update, and delete (`GET /api/node-overrides`, `PUT`/
    `DELETE /api/node-overrides/:nodeId`).
  - `configuration.ts`: get a device configuration (`GET
    /api/devices/:id/config`).
- Migrated all 18 REST data-loading calls in `AnalyticsPage.tsx` to
  `analytics.ts`. Removed its informal `apiFetch<T>()`; no direct `fetch()`
  remains. Existing `null` loading states and `.catch()` fallback values were
  preserved. The CSV `window.open()` remains unchanged as required.
- Added `packages/web/src/api/client.test.ts` with one passing test for each
  CONTRACT-002 validation case (a)-(h).

### Validation performed

- `pnpm --filter @foreman/web test -- src/api/client.test.ts` — could not start:
  `pnpm: command not found`.
- `corepack pnpm --filter @foreman/web test -- src/api/client.test.ts` — could
  not start pnpm under sandbox Node `v20.19.2`; failed with
  `ERR_VM_DYNAMIC_IMPORT_CALLBACK_MISSING`. The project pins pnpm 11.21.0 and
  documents Node >=22.13.
- `packages/web/node_modules/.bin/vitest run packages/web/src/api/client.test.ts
  --config packages/web/vitest.config.ts` — PASS: 1 test file, 8 tests.
- `pnpm --filter @foreman/web test` — could not start: `pnpm: command not found`.
- `pnpm --filter @foreman/web build` — could not start: `pnpm: command not found`.
- An initial repo-root direct Vitest fallback discovered daemon tests and was
  discarded as invalid web-package evidence. It did not mutate source.
- From `packages/web`, `./node_modules/.bin/vitest run` — PASS: 8 test files,
  28 tests, 0 failures.
- From `packages/web`, `./node_modules/.bin/tsc --noEmit &&
  ./node_modules/.bin/vite build` — PASS: TypeScript emitted no errors; Vite
  transformed 1810 modules and completed in 11.46s. Vite emitted only its
  existing large-chunk advisory (two output chunks over 500 kB).

CONTRACT-002 cases: (a) 2xx JSON parse PASS; (b) 204 -> `undefined` PASS; (c)
string error -> `ClientError` PASS; (d) validation error -> field errors and
non-empty message PASS; (e) non-JSON error -> fallback `ClientError` PASS; (f)
network failure -> `ClientError` with undefined status PASS; (g) cancellation
preserves `AbortError` and the exact signal PASS; (h) undefined query omission
and special-character encoding PASS.

### Acceptance criteria evidence

- [x] The exact six named feature modules exist under `packages/web/src/api/`.
- [x] Every feature function delegates to the one core; `rg 'fetch\\('` under
  `packages/web/src/api` finds fetch only in `client.ts`.
- [x] Analytics is fully migrated: `rg 'apiFetch|fetch\\('
  packages/web/src/pages/AnalyticsPage.tsx` returns no matches; the package
  type-check and production build pass.
- [x] Remaining informal/direct fetch sites are enumerated below (line numbers
  are from the handoff-time working tree):
  - [ ] `packages/web/src/App.tsx:102` — `DELETE /api/devices/:id`.
  - [ ] `packages/web/src/App.tsx:106` — `POST /api/devices/connect`.
  - [ ] `packages/web/src/App.tsx:206` — `GET /api/node-overrides`.
  - [ ] `packages/web/src/pages/MessagesPage.tsx:288` — `DELETE
    /api/devices/:deviceId/messages/:nodeId`.
  - [ ] `packages/web/src/pages/NodesPage.tsx:195` — `GET /api/hw-models`.
  - [ ] `packages/web/src/pages/MapPage.tsx:350` — `GET /api/traceroutes`
    (optional `since`).
  - [ ] `packages/web/src/pages/MapPage.tsx:366` — `GET /api/proposals`.
  - [ ] `packages/web/src/pages/MapPage.tsx:550` — `GET
    /api/coverage/viewshed` for mesh nodes.
  - [ ] `packages/web/src/pages/MapPage.tsx:599` — `GET
    /api/coverage/viewshed` for proposals.
  - [ ] `packages/web/src/pages/MapPage.tsx:847` — `GET /api/elevation` before
    proposal creation.
  - [ ] `packages/web/src/pages/MapPage.tsx:851` — `POST /api/proposals`.
  - [ ] `packages/web/src/pages/MapPage.tsx:1051` — `GET /api/elevation` before
    moving a proposal.
  - [ ] `packages/web/src/pages/MapPage.tsx:1055` — `PATCH /api/proposals/:id`
    for position/altitude.
  - [ ] `packages/web/src/pages/MapPage.tsx:1097` — `PATCH /api/proposals/:id`
    for proposal details.
  - [ ] `packages/web/src/pages/MapPage.tsx:1122` — `DELETE /api/proposals/:id`
    from the proposal popup.
  - [ ] `packages/web/src/pages/MapPage.tsx:1162` — `DELETE
    /api/coverage/viewshed` to evict terrain cache.
  - [ ] `packages/web/src/pages/MapPage.tsx:1174` — `GET
    /api/coverage/viewshed` to refresh terrain.
  - [ ] `packages/web/src/pages/MapPage.tsx:1756` — `PATCH /api/proposals/:id`
    to toggle visibility.
  - [ ] `packages/web/src/pages/MapPage.tsx:1796` — `DELETE /api/proposals/:id`
    from the proposal list.
  - [ ] `packages/web/src/pages/DeviceConfigPage.tsx:251` — `GET
    /api/region-presets`.
  - [ ] `packages/web/src/pages/NodeOverridesPage.tsx:91` — `PUT
    /api/node-overrides/:nodeId`.
  - [ ] `packages/web/src/pages/NodeOverridesPage.tsx:114` — `DELETE
    /api/node-overrides/:nodeId`.

### Assumptions and deviations

- CONTRACT-002 was treated as authoritative over the task prose.
- `packet-log`, coverage, proposal, and region/elevation-adjacent routes are not
  documented in `API_PROMISES.md`. The packet-log wrapper uses the exact local
  `PacketLogEntry` and filter shapes formerly in `AnalyticsPage.tsx`; coverage
  and proposal wrappers mirror the existing `MapPage.tsx` calls and shared
  `CoverageProposal` type without migrating that protected page.
- The documented analytics delivery example models `errorTypes` as a record,
  while the daemon/page currently use `{ type, count }[]`; migration preserved
  the existing page/daemon shape to avoid changing UI behavior.
- No cancellation was added to Analytics effects, so existing behavior and
  fallbacks remain unchanged; all wrappers accept optional signals for future
  callers.
- The required pnpm commands could not execute because pnpm was absent from
  PATH and the pinned Corepack pnpm could not run on sandbox Node 20. Equivalent
  installed web-package binaries were used for primary evidence.

### Unresolved risks

- No browser/live-daemon manual smoke test was possible in this sandbox. The
  migrated page is supported by the clean TypeScript/production build and unit
  suite, but end-to-end rendering and an intentionally triggered daemon failure
  remain manual review items.
- Undocumented endpoint shapes may drift until added to `API_PROMISES.md`.
- The normal package-manager commands should be rerun in the supported Node
  >=22.13 environment despite equivalent local checks passing here.

### Documentation updated

- This inline implementation handoff is the only documentation change. No API
  or architecture promise was changed.

## Review

Not reviewed.

## Human acceptance

Pending.
