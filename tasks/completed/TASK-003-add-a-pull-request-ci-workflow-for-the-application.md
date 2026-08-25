# TASK-003: Add a pull-request CI workflow for the application

Owner role: Implementer
Assigned agent: openai-coder
Proposed by: jarvis
Proposed date: 2026-08-24
Approved by: Patrick
Approved date: 08/24/26
Related contracts: None
Related ADRs: None
Dependencies: TASK-001, TASK-002 (CI must run against a working lint/format/tsconfig baseline, not the placeholders); TASK-036 (pnpm install must succeed from a clean checkout); TASK-037, TASK-038 (pnpm test must be green) — all five landed, see Blocker

## Desired outcome

Every pull request runs dependency install, format check, lint, TypeScript build, and tests, and cannot merge if any of those fail.

## Context

The only existing workflow is `.github/workflows/deploy-docs.yml` (VitePress docs deployment). There is no application CI at all.

## Scope

### Included

New `.github/workflows/ci.yml` installing dependencies via Corepack with the pnpm version pinned in `package.json`, then running `pnpm format:check`, `pnpm lint`, `pnpm build`, `pnpm test`; branch protection recommendation (documented, not necessarily configured by this task since branch protection is a GitHub repo setting outside version control — flag as a manual follow-up for you).

### Excluded

Modifying `deploy-docs.yml`; adding release/publish workflows; configuring GitHub branch-protection rules (repo settings, not a file this task can change — call out as a manual step for the human).

## Plan

1) Add workflow triggered on `pull_request` against `main`. 2) Use Corepack to install the exact pinned pnpm version. 3) Run the four checks as separate steps (or a matrix) so failures are individually attributable. 4) Verify the workflow passes on a scratch branch before merging.

## Acceptance criteria

- [ ] `ci.yml` runs on every PR and fails the check if format, lint, build, or test fails.
- [ ] Uses Corepack with the `packageManager` version from `package.json` (currently `pnpm@11.21.0`), not a hardcoded version.
- [ ] Documentation deployment remains a separate, untouched workflow.
- [ ] `docs/DEVELOPMENT.md` is updated to mention the CI workflow.

## Validation requirements

A test PR (or workflow run against a scratch branch) demonstrating both a passing run and at least one intentionally-broken run (e.g. a lint violation) failing the check.

## Risks and assumptions

Assumes TASK-001/002 land first so CI enforces real checks rather than placeholders. Recommend you enable required-status-check branch protection manually after this merges — that's a repo setting, not something in this task's file scope.

## Blocker

None as of 2026-08-24. Was blocked from approval through TASK-036/037/038
landing — see git history on this file for that record. Now resolved:
`pnpm install` succeeds from a clean checkout (TASK-036, `a9a46d7`), and
`pnpm --filter @foreman/daemon test` passes 69/69 (TASK-037 `ea5b822` +
TASK-038 `9c2153a`), independently verified with the correctly pinned
toolchain each time. Ready for implementation.

## Implementation handoff

Implementer: openai-coder
Date: 2026-08-24

### Changes made

- Added `.github/workflows/ci.yml`, triggered by pull requests targeting
  `main`. The workflow checks out the repository, uses
  `pnpm/action-setup@v4` without a `version` input so the action resolves the
  exact root `packageManager` pin, selects Node 22, installs with a frozen
  lockfile, and runs formatting, linting, build, and test as separate steps.
- Added a Continuous integration section to `docs/DEVELOPMENT.md` describing
  the PR trigger, pinned pnpm source, and four separately reported checks.
- Did not modify `.github/workflows/deploy-docs.yml` and did not add a release
  or publish workflow.

### Validation performed

- `pnpm format:check` — failed with exit 127 before the check ran:
  `/bin/bash: line 1: pnpm: command not found`.
- `pnpm lint` — failed with exit 127 before lint ran:
  `/bin/bash: line 1: pnpm: command not found`.
- `pnpm build` — failed with exit 127 before the build ran:
  `/bin/bash: line 1: pnpm: command not found`.
- `pnpm test` — failed with exit 127 before tests ran:
  `/bin/bash: line 1: pnpm: command not found`.
- Toolchain diagnostics: `node --version` reported `v20.19.2` and
  `corepack --version` reported `0.24.0`. `corepack pnpm --version` failed with
  exit 1 because Corepack attempted to create a directory in the read-only
  `/home/patrick/.cache/node/corepack`. Retrying as
  `COREPACK_HOME=/tmp/task-003-corepack corepack pnpm --version` also failed
  with exit 1 because the sandbox could not request
  `https://registry.npmjs.org/pnpm`. Therefore the required Node >=22.13 and
  pinned pnpm 11.21.0 toolchain could not be installed, and none of the four
  application checks could execute in this sandbox.
- `python3 -c "import yaml,sys; yaml.safe_load(open('.github/workflows/ci.yml')); print('YAML syntax valid')"`
  printed `YAML syntax valid` and exited 0.
- `sha256sum .github/workflows/deploy-docs.yml` reported
  `06c35ec7ee11e26a4958a26c1b405a7716cc6d528c71d378468ec7b6d2762325`
  both before implementation and after validation.
- Workflow inventory after implementation contained only `ci.yml` and the
  existing `deploy-docs.yml`; no release or publish workflow was added.

### Acceptance criteria evidence

1. `.github/workflows/ci.yml` has `pull_request` scoped to `main`; its four
   separate named steps run `pnpm format:check`, `pnpm lint`, `pnpm build`, and
   `pnpm test`. YAML syntax parsing passed. A real passing/failing Actions run
   remains outstanding as described below.
2. The `pnpm/action-setup@v4` step deliberately has no `version` input, causing
   it to resolve the `packageManager` declaration in root `package.json`
   (`pnpm@11.21.0` with its integrity hash) rather than using a duplicated,
   hand-typed pnpm version. `actions/setup-node@v4` selects Node 22, satisfying
   the root `engines.node` requirement of `>=22.13.0` on current Node 22 runners.
3. Documentation deployment remains separate in `deploy-docs.yml`; its SHA-256
   was identical before and after this work.
4. `docs/DEVELOPMENT.md` now includes a Continuous integration section covering
   the new application PR workflow.

### Assumptions and deviations

- Assumed the maintained `pnpm/action-setup@v4` contract described in the task:
  omitting `version` reads the package manager and version from the root
  `packageManager` field.
- Local execution deviated from the requested passing validation because the
  sandbox supplies Node 20, no `pnpm` executable, a read-only default Corepack
  cache, and no registry access. The commands were invoked exactly and their
  failures are reported above; no success is claimed.

### Unresolved risks

- **No real GitHub Actions run has occurred.** No PR was opened against the real
  GitHub repository from this sandbox. Before relying on this check for branch
  protection, a human should open a real PR or push a scratch branch and confirm
  both a passing workflow and an intentionally broken run (for example, a lint
  violation) that fails on GitHub-hosted runners.
- After that validation, a human should enable the application CI job as a
  required status check in branch protection for `main`; repository settings
  are outside this task's file scope.

## Review

Not reviewed.

## Human acceptance

Pending.
