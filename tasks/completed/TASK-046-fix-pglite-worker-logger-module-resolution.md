# TASK-046: Fix PGlite worker logger module resolution on daemon startup

Owner role: Implementer
Assigned agent: Codex
Proposed by: Patrick (via production startup failure report)
Proposed date: 2026-08-27
Approved by: Patrick
Approved date: 2026-08-27
Related contracts: CONTRACT-001
Related ADRs: ADR-002
Dependencies: None

## Desired outcome

The API daemon starts successfully from a clean production checkout on supported
Node.js versions, including Node.js 24, without the PGlite worker failing to
resolve `packages/daemon/src/logger.js`.

## Context

Running `start-api.ps1` on the production host fails while the PGlite worker is
starting:

```text
Error [ERR_MODULE_NOT_FOUND]: Cannot find module
'.../packages/daemon/src/logger.js' imported from
'.../packages/daemon/src/db/pglite.thread.ts'
```

Commit `b2b5474` changed the worker's recovery warning from `console.warn` to the
shared `createLogger` helper and added `import { createLogger } from
"../logger.js"`. The daemon's main TypeScript entry runs through `tsx`, but the
worker entry is a separate runtime boundary. On Node.js 24 the worker can load
the `.ts` entry while resolving the explicit `.js` dependency literally, and no
`logger.js` file exists beside `logger.ts`. The daemon therefore exits before
the database becomes ready.

The existing PGlite proxy tests launch the real TypeScript worker and are the
appropriate regression coverage for this startup path.

## Scope

### Included

- Remove the worker entry's dependency on the shared TypeScript logger module,
  keeping the worker entry self-contained across the worker/runtime-loader
  boundary.
- Preserve the existing database recovery warning and its `[db]` tag.
- Run the real PGlite worker proxy tests under the supported runtime setup to
  demonstrate that worker startup and module resolution succeed.

### Excluded

- Changes to the PGlite proxy protocol, lifecycle, storage, or recovery policy.
- Changes to application logging outside `pglite.thread.ts`.
- The unrelated pnpm deprecation warning for the root `package.json` `pnpm`
  field.
- Package version metadata changes.

## Plan

1. Remove the shared logger import and logger instance from the worker entry.
2. Emit the existing rare recovery warning directly with `console.warn`, using
   the same stable `[db]` tag and human-readable message.
3. Run formatting, type checking/build, and the PGlite real-worker tests.
4. Record the implementation handoff and move the task to `tasks/review/`.

## Acceptance criteria

- [x] Starting the real PGlite TypeScript worker no longer attempts to resolve
      a nonexistent `packages/daemon/src/logger.js`.
- [x] `openDb()` successfully starts its worker and completes a real query.
- [x] The corrupted-data recovery path still emits a tagged database warning.
- [x] No PGlite proxy protocol, lifecycle, or persistence behavior changes.

## Validation requirements

Run the daemon package's real-worker proxy tests, TypeScript build, lint, and
format check. If environment sandboxing prevents the PGlite WASM worker from
running, record the exact limitation and separately validate the source-level
module graph and TypeScript build.

## Risks and assumptions

Low technical risk. The shared logger was used only for one recovery warning in
the worker. A direct tagged console warning preserves the observable log line
while eliminating a fragile source-module dependency at the worker boundary.

## Blocker

None. Patrick explicitly approved this production bug fix on 2026-08-27.

## Implementation handoff

Implemented by Codex on 2026-08-27.

### Changes made

- `packages/daemon/src/db/pglite.thread.ts`:
  - Removed the worker entry's import of `createLogger` from `../logger.js` and
    the associated module-level logger instance. This eliminates the worker's
    attempt to resolve a nonexistent emitted JavaScript sibling while running
    directly from TypeScript.
  - Restored the rare WASM-recovery warning as a direct `console.warn` call.
    The line retains the stable `[db]` tag, the same human-readable recovery
    message, and the structured `recover-wasm-abort` operation field.
  - Did not alter worker messages, PGlite initialization, reset behavior,
    query execution, close handling, or the proxy implementation.

### Validation performed

Validation ran on Node.js `v24.2.0` using the repository's already-installed
dependencies:

- `packages/daemon/node_modules/.bin/vitest.CMD run
  src/db/__tests__/open.test.ts`: passed — 1 test file, 9 tests passed. This
  suite starts the real TypeScript worker, opens PGlite, executes `SELECT 42`,
  exercises transactions and queueing, and covers worker failure/exit handling.
- `packages/daemon/node_modules/.bin/tsc.CMD --noEmit`: passed with no
  TypeScript diagnostics.
- `pnpm exec vitest ...` could not begin because pnpm detected that the existing
  `node_modules` layout needs replacement and refused the purge without a TTY
  (`ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY`). The installed Vitest shim was
  therefore invoked directly, avoiding any dependency mutation.
- Lint and Prettier checks could not run because their executables are absent
  from this checkout's partial `node_modules` installation. The changed source
  is conventionally formatted, and the TypeScript build passed.

### Acceptance criteria evidence

- [x] Real-worker startup completes without `ERR_MODULE_NOT_FOUND`; demonstrated
      by all nine PGlite proxy tests passing on Node 24.2.0.
- [x] The suite's first test successfully calls `openDb()` and executes a real
      `SELECT 42::integer AS answer` query.
- [x] The reset branch still emits a warning beginning with `[db]` and includes
      `{"operation":"recover-wasm-abort"}`.
- [x] The patch changes only logging inside the reset branch; proxy and worker
      protocol logic are untouched.

### Assumptions and deviations

- `git mv` could not update the task lifecycle because this environment has
  read-only access to `.git` and could not create `.git/index.lock`. The task
  file was moved with an ordinary filesystem rename instead; there is only one
  lifecycle copy.
- The unrelated pnpm configuration warning and package version metadata remain
  excluded as approved.

### Unresolved risks

- The full daemon lint and format checks should be rerun after a clean
  `pnpm install` restores the root development-tool executables.
- The destructive corrupted-PGlite-data recovery branch was not deliberately
  triggered; its warning line was validated by source inspection, while normal
  worker startup and database behavior were exercised end to end.

### Documentation updated

Only this task handoff. No contract, ADR, or user-facing behavior changed.

## Review

Not reviewed.

## Human acceptance

Pending.
