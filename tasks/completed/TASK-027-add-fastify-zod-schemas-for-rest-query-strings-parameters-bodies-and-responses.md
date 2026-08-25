# TASK-027: Add Fastify/Zod schemas for REST query strings, parameters, bodies, and responses

Owner role: Implementer
Assigned agent: openai-coder
Proposed by: jarvis
Proposed date: 2026-08-24
Approved by: Patrick
Approved date: 08/25/26
Related contracts: **CONTRACT-007 recommended** (externally consumed — this is public API validation/error/default behavior, exactly what change-classification.md flags)
Related ADRs: None
Dependencies: TASK-026 (apply schemas to the six smaller domain files rather than one 1123-line file), TASK-014 (daemon config module — establishes the Zod-validation convention this task extends to routes)

## Desired outcome

REST query strings, parameters, bodies, and important responses are validated via Fastify/Zod schemas, providing consistent defaults and error responses instead of manual `req.query` casting throughout the routes.

## Context

Currently `routes/analytics.ts` and other route files (`devices.ts`, `coverage.ts`, `proposals.ts`, `terrain-cache.ts`) presumably cast `req.query` manually (confirm exact pattern during implementation via grep for `as {` or similar casts near `req.query`). Adding schema validation changes what happens on invalid input — from whatever ad hoc behavior exists today to consistent, structured 400-style errors — which is a real, externally-visible behavior change for any API consumer.

## Scope

### Included

Zod schemas for query strings, path parameters, and bodies across all REST route files (`analytics.ts` — post-split into TASK-026's domain modules, `devices.ts`, `coverage.ts`, `proposals.ts`, `terrain-cache.ts`); reusing shared schemas where they genuinely describe the same public contract (e.g. device ID, time-range params likely repeat across many endpoints); consistent error-response shape for validation failures.

### Excluded

Validating WebSocket commands (already covered by `ws-protocol.ts`'s existing schemas, per TASK-009) — REST only.

## Plan

1) Enumerate current manual `req.query`/`req.params`/`req.body` casting across all route files. 2) Identify genuinely shared parameter shapes (device ID, since/time-range, limit) as reusable schemas. 3) Apply schemas domain-by-domain, starting with the now-split analytics modules from TASK-026. 4) Define one consistent validation-error response shape used across all routes. 5) Update `API_PROMISES.md`/`docs/api/index.md` (per TASK-015's chosen canonical source) to document the new validation behavior and error shape, since this is now part of the public contract.

## Acceptance criteria

- [x] All REST route files use Zod schemas for query strings, parameters, and bodies instead of manual casting.
- [x] Shared parameter shapes (device ID, time-range, limit, etc.) are defined once and reused across routes that genuinely share them.
- [x] Invalid input produces a consistent, documented error response shape across all routes.
- [x] TASK-005's analytics test suite is updated (not weakened) to assert on the new validation behavior for at least the invalid-input cases it already covers.
- [x] The public API documentation (per TASK-015) reflects the new validation/error contract.
- [x] CONTRACT-007 (if approved) defines the validation-error response shape and default-value behavior before implementation, since this is now externally-visible API behavior.

## Validation requirements

TASK-005's full analytics suite plus new tests for the other route files' validation behavior; confirm the frontend (post TASK-013's typed client) still functions correctly against the newly-validated endpoints — this is a good integration checkpoint between the two.

## Risks and assumptions

This is the task most likely to introduce an externally-visible breaking change (stricter validation than before could reject requests that previously succeeded, even if malformed) — CONTRACT-007 should explicitly enumerate what becomes newly-rejected, if anything, so it's a reviewed decision rather than a side effect.

## Blocker

None.

## Implementation handoff

Implemented shared request schemas and a single flattened-Zod error responder in
`packages/daemon/src/routes/schemas.ts`, then applied fail-fast request validation to all scoped
analytics, devices, coverage, and proposals handlers. Analytics `since`, traceroutes `since`, and
terrain-cache raw SQL behavior remain unchanged per the human resolutions. Proposal POST/PATCH now
reject non-object JSON before property access or DB work. Coverage DELETE now shares GET coordinate
ranges and radius bounds. Added/updated analytics, devices, coverage, and proposals route tests and
documented the uniform contract in canonical `API_PROMISES.md`.

Validation: analytics 52/52 passed; focused devices/proposals/coverage 26/26 passed; daemon suite
excluding `src/db/__tests__/open.test.ts` 172/172 passed; daemon typecheck, scoped lint, and scoped
format check passed; web typecheck and 38/38 web tests passed. The unexcluded daemon suite cannot
pass in this environment: Node v20.19.2 (repo requires >=22.13.0) cannot load
`src/db/pglite.thread.ts`, causing 7 existing worker-proxy failures. `pnpm` is unavailable, so local
package binaries were used; repo pins pnpm 11.21.0.

Assumption: the previously unchecked `DELETE /api/node-overrides/:nodeId` uses the same `> 0`
constraint as the sibling PUT route, as directed by the task owner. No response schemas were added.
No files under `packages/daemon/src/device/` or `packages/daemon/src/mqtt/` were changed.

## Review

Not reviewed.

## Human acceptance

Pending.
