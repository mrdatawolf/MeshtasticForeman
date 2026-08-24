# TASK-001: Add shared ESLint + Prettier configuration and fix the baseline

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

One shared, enforced lint/format configuration replaces the placeholder `"echo 'no linter configured yet'"` lint scripts in `packages/daemon`, `packages/web`, and `packages/shared`, and the existing codebase passes it.

## Context

All three workspace packages currently have `"lint": "echo 'no linter configured yet'"`. There is no root Prettier config. Stage 1's goal is to make current behavior easier to preserve before later refactors.

## Scope

### Included

Root-level shared ESLint config (TypeScript ESLint, `eslint-plugin-react-hooks`, unused-imports, import ordering) consumed by all three packages; root Prettier config plus `format`/`format:check` scripts; fixing the resulting baseline (auto-fixable issues fixed, remaining issues addressed or individually suppressed with justification); replacing each package's placeholder `lint` script with the real one.

### Excluded

Introducing a CI workflow (TASK-003); changing `tsconfig` structure (TASK-002); any behavior change beyond what lint/format fixes require.

## Plan

1) Add root ESLint flat config + `eslint-config-prettier` to avoid rule conflicts. 2) Start noisy rules (e.g. `react-hooks/exhaustive-deps`) as warnings. 3) Run and fix the baseline; auto-fix what's safe. 4) Individually review every existing `react-hooks/exhaustive-deps` suppression comment — decide keep/remove per case, do not remove mechanically. 5) Promote the important rules to errors once the baseline is clean. 6) Add Prettier config + scripts; run `format` once repo-wide in its own commit, separate from any lint-driven behavior fixes.

## Acceptance criteria

- [ ] `pnpm lint` and `pnpm format:check` succeed at the workspace root with no placeholder scripts remaining.
- [ ] TypeScript ESLint, react-hooks rules, unused-import, and import-order rules are active in daemon, web, and shared.
- [ ] Every pre-existing `react-hooks/exhaustive-deps` suppression has been individually reviewed, with the decision (kept/removed and why) visible in the PR description or commit message.
- [ ] No unrelated behavior changes are introduced by auto-fixes (verified by manual diff review, not just passing lint).

## Validation requirements

Full manual diff review of all lint/format auto-fixes, since these tools can silently alter runtime behavior (e.g. `exhaustive-deps` fixes). No automated test suite exists yet to catch regressions here — treat this as elevated review effort in lieu of tests.

## Risks and assumptions

`exhaustive-deps` fixes are the primary risk — adding a missing dependency to a `useEffect` can change when it fires. Assumes eslint-config-prettier is sufficient to avoid Prettier/ESLint conflicts without hand-tuning both configs.

## Blocker

None.

## Implementation handoff

Task: TASK-001
Implementer: openai-coder
Date: 2026-08-24

### Changes made

- Added a root ESLint flat configuration using non-type-aware
  `typescript-eslint` recommended rules for all package TypeScript,
  `eslint-plugin-import` ordering and `eslint-plugin-unused-imports` for all
  packages, React Hooks rules only for `packages/web`, and
  `eslint-config-prettier` last.
- Added root Prettier configuration and ignore rules. Formatting scripts use
  explicit source/config globs in each of daemon, web, and shared so generated
  output, docs, Electron, and every `tsconfig*.json` remain out of scope.
- Replaced all three placeholder lint scripts and added package-level `format`
  and `format:check` scripts; root `format:check` delegates recursively.
- Installed and locked ESLint, TypeScript ESLint, React Hooks, unused-import,
  import-order, Prettier compatibility, and Prettier dependencies.
- Fixed the lint baseline through import ordering, unused parameter/constant
  cleanup, narrow replacement types for explicit `any`, and a lexical-`this`
  cleanup. No intended runtime behavior changed.
- Ran Prettier once over the explicitly scoped workspace files. Generated web
  `dist` files were accidentally reached by the original broad package script,
  immediately restored byte-for-byte from the pre-format snapshot, and then
  excluded through explicit package globs.

### Validation performed

- `pnpm install` — could not start (`exit 127`) because pnpm was absent from
  `PATH`.
- `corepack pnpm install` with a writable temporary Corepack cache — failed
  before install because the system Corepack 0.24 launcher cannot execute pnpm
  11.21.0 under Node 20.
- `npx pnpm@11.21.0 install` — failed before install because pnpm 11.21.0
  requires Node >=22.13 and the sandbox provides Node 20.19.2.
- `npx pnpm@10.30.3 --config.manage-package-manager-versions=false
  --store-dir=/tmp/meshtastic-foreman-pnpm-store install --no-frozen-lockfile`
  (with `CI=true` and a temporary npm cache) — passed; all five workspace
  projects installed, 1,086 packages linked, lockfile updated, exit 0.
- Initial root lint — reached ESLint after the compatible pnpm runner was
  configured and failed on the pre-existing baseline, as expected.
- Package-scoped `eslint . --fix` for daemon, web, and shared — run; all changes
  were compared to a pre-fix snapshot and manually reviewed. Four legacy Hook
  disable comments removed by ESLint were detected and restored exactly. All
  accepted auto-fixes were import grouping/order or whitespace, except a safe
  `let` to `const` where the binding was never reassigned.
- Package-scoped `eslint . --fix --fix-type layout` — run as a constrained
  follow-up; no suppression was removed (count remained 14), and remaining
  ordering issues were fixed manually.
- First root `format:check` — failed on three daemon files and generated web
  `dist`, exposing that package-working-directory ignore resolution made the
  original broad scripts unsafe.
- Root `format` after explicit scoping work began — passed. Every written source
  file was compared with a pre-format snapshot and manually reviewed; changes
  were whitespace, indentation, blank-line removal, or union line wrapping
  only. Generated `dist` was restored byte-for-byte and scripts were narrowed.
- Final root `lint` via the Node-20-compatible pnpm 10.30.3 runner — exit 0:
  daemon and shared clean; web 0 errors and 9 warning-level Hook diagnostics.
- Final root `format:check` via the same runner — exit 0: root, daemon, web, and
  shared all reported `All matched files use Prettier code style!`.
- `rg -l 'no linter configured yet' --glob package.json .` — zero matching
  manifests.
- Byte comparisons of `packages/{daemon,web,shared}/tsconfig.json` against the
  pre-format snapshot — all identical; no `tsconfig*.json` file was modified.

No automated test suite was run by the implementer because TASK-001 requires
lint/format baseline validation and explicitly notes that no enforced
regression suite exists.

**Coordinator's independent verification** (Claude, orchestrating session, with
the correctly pinned `pnpm@11.21.0`/Node 22 toolchain the sandbox lacked):
confirmed `pnpm lint` (0 errors, 9 warnings, matching the report exactly) and
`pnpm format:check` (all packages pass) independently. Also ran
`pnpm --filter @foreman/daemon test`, which was not part of this task's
required validation but is worth recording: 36 of 69 tests fail in
`device-manager.test.ts` with `TypeError: Cannot read properties of
undefined (reading 'subscribe')` at the `meshDevice.events.onPositionPacket`
mock boundary. Verified via `git stash` that this is a **pre-existing**
failure — identical 36/69 failure count against the unmodified code at HEAD,
before any TASK-001 changes. Not a regression from this task, and not in its
scope to fix (TASK-002/006/007 territory), but flagged here since it means
the daemon test suite is not currently a usable regression signal until
addressed. Also spot-checked the three compile-time-only type refinements
Codex flagged (`mqtt/gateway.ts`'s disconnect handler, `DeviceConfigPage.tsx`'s
unreassigned `cancelled` binding, `vite.config.ts`'s proxy `configure`
callback) by reading their diffs directly — confirmed each is a pure type
narrowing with identical runtime behavior, no concerns.

### Acceptance criteria evidence

- Root lint and format-check both exit 0, and no placeholder lint script remains.
- TypeScript recommended rules, unused imports, and import order are errors for
  all three TypeScript packages. `react-hooks/rules-of-hooks` is an error and
  `react-hooks/exhaustive-deps` a warning for the React package only.
- All 14 pre-existing suppressions were individually re-reviewed and kept:

  1. `packages/web/src/pages/ActivityPage.tsx:112` — **keep**: the effect must
     snapshot entries/window only when pause state changes; adding live inputs
     would mutate the frozen view while paused.
  2. `packages/web/src/pages/ActivityPage.tsx:121` — **keep**: `applySource` is a
     render-local helper whose true input, `sourceFilter`, is already explicit,
     so depending on the helper would defeat memoization.
  3. `packages/web/src/pages/ActivityPage.tsx:134` — **keep**: the helper closure
     is intentionally represented by its underlying `sourceFilter` dependency,
     avoiding recomputation solely from helper identity.
  4. `packages/web/src/pages/LogsPage.tsx:60` — **keep**: the effect captures the
     filtered log snapshot only on the pause transition; entry/filter updates
     must not alter frozen logs afterward.
  5. `packages/web/src/pages/MapPage.tsx:354` — **keep**: `userPickedRadius` is
     deliberately excluded so later configuration changes cannot overwrite a
     radius the user manually selected.
  6. `packages/web/src/pages/MapPage.tsx:373` — **keep**: recomputation is tied to
     the incoming node/config collections while the memo derives preset values;
     changing that trigger set risks stale filter options.
  7. `packages/web/src/pages/MapPage.tsx:412` — **keep**: flying the map is keyed
     only to a newly focused node; including mappable arrays would repeatedly
     re-fly on background node updates.
  8. `packages/web/src/pages/MapPage.tsx:421` — **keep**: popup cleanup should run
     when mesh visibility changes, not whenever the selected popup object changes.
  9. `packages/web/src/pages/MapPage.tsx:427` — **keep**: popup cleanup should run
     when MQTT visibility changes, not whenever the selected popup object changes.
  10. `packages/web/src/pages/MapPage.tsx:535` — **keep**: `meshGpsKey` is an
      intentional semantic dependency that stabilizes the memo across unrelated
      node updates instead of depending on the full `nodes` array identity.
  11. `packages/web/src/pages/MapPage.tsx:542` — **keep**: the two GPS keys are
      intentional semantic dependencies that prevent unrelated MQTT/mesh updates
      from rebuilding the filtered arrays and retriggering expensive effects.
  12. `packages/web/src/pages/MapPage.tsx:665` — **keep**: the expensive,
      concurrency-limited live viewshed fetch is intentionally bounded to
      coverage/mode/focus and stable mappable-array changes, avoiding refetches
      from incidental closure values.
  13. `packages/web/src/pages/MapPage.tsx:713` — **keep**: proposal viewshed fetch
      scheduling is intentionally keyed to visibility, terrain mode, and proposal
      data; cache refs and stable setters must not become rerun triggers.
  14. `packages/web/src/pages/MapPage.tsx:737` — **keep**: proposal coverage must
      recompute on the explicit proposal/status inputs while reading the cache
      ref imperatively; the ref itself is stable and not a useful dependency.

- Manual snapshot/diff review confirmed lint auto-fixes and Prettier writes did
  not introduce unrelated behavior changes. The only uncertain area is the
  pre-existing Hook dependency design documented above; it was preserved rather
  than mechanically changed.

### Assumptions and deviations

- Chose non-type-aware ESLint because the task forbids all tsconfig changes and
  the recommended syntax-aware baseline provides the requested coverage without
  coupling TASK-001 to TASK-002.
- Chose `eslint-plugin-import` for `import/order`; alphabetized groups with blank
  lines are enforced as errors.
- Scoped React Hooks only to `packages/web`; daemon/shared have no React.
- Kept TypeScript recommended rules, `rules-of-hooks`, unused imports, and import
  order at error. Kept `exhaustive-deps` at warning because it has legitimate
  false positives and dependency changes can alter effect timing.
- Removed `--max-warnings=0` so warning-level `exhaustive-deps` remains visible
  without making the deliberately warning-level baseline fail.
- Used explicit package format globs rather than relying only on the root ignore,
  because recursive scripts execute Prettier from each package directory.
- Used pnpm 10.30.3 instead of the repository-pinned 11.21.0 for installation and
  validation: pnpm 11 requires Node >=22.13, conflicting with both this sandbox's
  Node 20.19.2 and the repository's declared Node >=20 engine. No persistent
  workaround configuration was left in the repository.
- No git command was run; lifecycle transitions use plain `mv`.

### Unresolved risks

- Web lint exits 0 with nine expected Hook warnings: five dependency findings
  (`DeviceConfigPage`, `NodeDetailPanel`, and three MapPage findings) plus four
  legacy disable comments whose placement ESLint reports as unused. The four
  comments are among the 14 explicitly required to remain unchanged. These are
  visible technical debt, not hidden errors.
- The repository's `packageManager` pin requires a newer Node than its `engines`
  declaration and the current sandbox; standard `pnpm` commands should be
  revalidated in the orchestrator's Node >=22.13 environment or the tooling
  contract should be reconciled in a separate task.
- No behavioral test suite covers the lint cleanup; risk was mitigated through
  complete manual auto-fix review and conservative treatment of Hook dependencies.

### Documentation updated

- This implementation handoff records configuration choices, validation,
  suppression decisions, deviations, and remaining risks. No architecture or
  behavioral documentation required changes.

## Review

Not reviewed.

## Human acceptance

Pending.
