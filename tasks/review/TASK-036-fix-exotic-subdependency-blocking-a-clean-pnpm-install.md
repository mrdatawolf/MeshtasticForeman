# TASK-036: Fix exotic subdependency blocking a clean pnpm install

Owner role: Implementer
Assigned agent: openai-coder
Proposed by: jarvis (via Claude, orchestrating session)
Proposed date: 2026-08-24
Approved by: Patrick
Approved date: 08/24/26
Related contracts: None
Related ADRs: None
Dependencies: None

## Desired outcome

`pnpm install` succeeds from a clean checkout (no local `node_modules`, no
policy bypass flags) in any environment that enforces pnpm's
`blockExoticSubdeps` supply-chain policy — including CI. This currently
fails and blocks TASK-003 (pull-request CI workflow), which needs a clean
install to be possible at all.

## Context

Discovered while validating TASK-001/TASK-002 before starting TASK-003. The
already-committed `pnpm-lock.yaml` (present at `HEAD`, not introduced by any
task from this roadmap decomposition) resolves `@electron/rebuild@^3.7.2`'s
transitive dependency `@electron/node-gyp` via a raw GitHub tarball URL:

```
'@electron/node-gyp@https://codeload.github.com/electron/node-gyp/tar.gz/06b29aafb7708acef8b3669835c8a7857ebc92d2':
```

pnpm's `blockExoticSubdeps` policy (active by default in this environment,
not configured anywhere in this repo's `.npmrc`/`pnpm-workspace.yaml` — it
appears to be a pnpm 11 built-in default) rejects git/tarball-resolved
dependencies that appear as *subdependencies* rather than direct
dependencies, specifically to prevent an unpinned third party from smuggling
arbitrary code into the tree. Confirmed via `pnpm --filter @foreman/daemon
build` and `pnpm install` both failing with:

```
[ERR_PNPM_EXOTIC_SUBDEP] Exotic dependency "@electron/node-gyp" (resolved via
git-repository) is not allowed in subdependencies when blockExoticSubdeps is
enabled
```

Checked whether a newer `@electron/rebuild` avoids this: `@electron/rebuild@4.2.0`
(latest, current is pinned at `^3.7.2`) depends on plain registry
`node-gyp@^12.2.0` instead of the git-hosted `@electron/node-gyp` fork. This
looks like the legitimate fix — Electron's own tooling moved off the forked
git dependency between 3.x and 4.x — rather than something to work around
with a policy bypass.

## Scope

### Included

Upgrading `@electron/rebuild` from `^3.7.2` to a version that resolves
`node-gyp` via the npm registry (`^4.2.0` or later, whatever is current at
implementation time); regenerating `pnpm-lock.yaml` cleanly (no
`--config.blockExoticSubdeps=false` bypass in the final state — that flag is
only acceptable as a temporary local diagnostic, never in the committed
lockfile or any CI config); confirming `@electron/rebuild@4.x` is compatible
with this repo's `electron@^39.8.8` and `electron-builder@^26.8.1` versions
and that `pnpm run electron:build` (or at minimum `pnpm --filter
@foreman/daemon build` plus a native-module rebuild smoke test, since
`@electron/rebuild` backs `electron-rebuild`'s native module recompilation)
still works.

### Excluded

Upgrading `electron`, `electron-builder`, or `esbuild` themselves — only the
minimum change needed to eliminate the exotic subdependency. Disabling or
weakening the `blockExoticSubdeps` policy anywhere (that policy is doing its
job correctly here; the dependency should be fixed, not the guardrail).

## Plan

1) Confirm `@electron/rebuild@4.2.0`'s full dependency tree resolves via the
   registry with no other exotic (git/tarball) subdependencies. 2) Bump the
   root `package.json` devDependency. 3) Run `pnpm clean --lockfile && pnpm
   install` (no bypass flags) and confirm it completes successfully. 4) Spot
   check that `@electron/rebuild`'s API surface used by `electron-builder`
   hasn't changed in a way that breaks the build — `electron-builder` invokes
   it internally, so there's no direct call site in this repo's own code to
   update, but the build pipeline should still be smoke-tested. 5) Run `pnpm
   run electron:build` (or as close to it as the environment allows) to
   confirm the installer pipeline still functions.

## Acceptance criteria

- [ ] `pnpm clean --lockfile && pnpm install` (no policy-bypass flags) succeeds from a clean checkout.
- [ ] `pnpm-lock.yaml` contains no git/tarball-resolved subdependencies anywhere in the tree (verify via a search for `codeload.github.com` or similar exotic resolution patterns).
- [ ] `@electron/rebuild` is upgraded to a version resolving `node-gyp` via the registry, with the version choice and any compatibility findings recorded in this task's Implementation handoff.
- [ ] The Electron build pipeline (`electron:build` or an equivalent smoke test) still functions after the upgrade.
- [ ] No change to `blockExoticSubdeps` or any other supply-chain policy configuration.

## Validation requirements

`pnpm clean --lockfile && pnpm install` from a clean state, with no bypass
flags, must succeed. `pnpm --filter @foreman/daemon build` and `pnpm
--filter @foreman/web build` must still pass. `pnpm run electron:build` (or
documented reasoning if it can't be run in the implementation environment,
e.g. missing platform-specific build tools) should be attempted.

## Risks and assumptions

Low-to-moderate risk — this is a devDependency major-version bump
(`@electron/rebuild` 3.x -> 4.x) rather than application code, but
`electron-builder` depends on it internally for native module rebuilding
during packaging, so a behavior change there could surface only when
actually building an installer, not during `pnpm build`/tests. Assumes no
other root or transitive dependency also pulls in an exotic subdependency
once this one is fixed — re-verify the full lockfile after the fix, not just
the one package.

## Blocker

None.

## Implementation handoff

Implementer: openai-coder
Date: 2026-08-24

### Changes made

- Upgraded the root `devDependency` from `@electron/rebuild@^3.7.2` to
  `@electron/rebuild@^4.2.0` and regenerated `pnpm-lock.yaml` from a clean
  dependency state.
- Chose 4.2.0 because `npm view @electron/rebuild versions --json` showed it
  was both the latest stable 4.x release and the npm `latest` tag on the
  implementation date. `npm view @electron/rebuild@4.2.0 dependencies --json`
  showed registry `node-gyp@^12.2.0` and no `@electron/node-gyp` dependency.
  The regenerated lockfile selected registry `node-gyp@12.4.0`.
- Did not change `.npmrc`, `pnpm-workspace.yaml`, CI configuration, or any
  `blockExoticSubdeps`/supply-chain policy setting. No policy-bypass flag was
  used.

### Validation performed

- `pnpm clean --lockfile`: **PASS** using the repository-pinned pnpm 11.21.0;
  removed all workspace `node_modules` directories and `pnpm-lock.yaml`.
- The immediately chained first `pnpm install`: **FAIL (sandbox setup, before
  dependency resolution)** with `[ERR_SQLITE_ERROR] unable to open database
  file`, because pnpm's default store was below the sandbox's read-only home
  directory. Retried as `pnpm install --store-dir
  /tmp/task-036-pnpm-store`: **PASS**, with no policy-bypass flags. It resolved
  1,105 packages, installed 1,004 packages, installed
  `@electron/rebuild@4.2.0`, and completed in 24.2 seconds using pnpm 11.21.0.
  The temporary store override changes only the writable sandbox cache
  location; it does not alter dependency resolution or repository config.
- `rg -n 'codeload\\.github\\.com|git\\+https' pnpm-lock.yaml`:
  **PASS, zero matches** (`EXOTIC_MATCH_COUNT=0`). The lockfile contains
  `@electron/rebuild@4.2.0` and its plain registry `node-gyp@12.4.0` dependency.
- `pnpm --filter @foreman/daemon build`: **PASS** (`tsc --noEmit`, exit 0).
- `pnpm --filter @foreman/web build`: **PASS** (`tsc --noEmit && vite build`,
  1,803 modules transformed, exit 0). Vite emitted only its non-fatal existing
  large-chunk warning.
- `pnpm run electron:build`: **EXERCISED; packaging did not complete due to a
  sandbox cache-path limitation**. `node scripts/sync-version.js` passed and
  reported `Version already in sync: 0.8.3`. electron-builder 26.15.3 loaded
  the configuration, invoked `@electron/rebuild` for Electron 39.8.10/x64,
  installed native dependencies successfully, packaged the Linux unpacked
  application, downloaded and extracted Electron, and started both Snap and
  AppImage targets. It then failed while creating
  `/home/patrick/.cache/electron-builder/icons@1.1.0` with `ENOENT` because the
  sandbox home/cache location is read-only. This occurred after the rebuild
  integration completed and is unrelated to the `@electron/rebuild` API.
  An earlier attempt also reached and completed `@electron/rebuild`, then
  stopped when electron-builder tried to spawn a literal `pnpm` executable;
  exposing the exact pinned pnpm 11.21.0 entrypoint through `/tmp` allowed the
  later attempt to proceed to the icon-tool cache failure.

### 3.x to 4.x compatibility findings

- The upstream v4.0.0 release notes document these relevant breaking changes:
  Node.js `>=22.12.0` is required, the package is ESM-only, the default export
  was removed, and the unused `nodeGypPath` field was removed from `Rebuilder`.
  Releases 4.0.1 through 4.2.0 document fixes and additive features rather than
  further programmatic-API breaks; 4.0.1 specifically returned to registry
  `node-gyp`, and 4.2.0 added an optional jobs setting.
- Installed electron-builder 26.15.3 dynamically imports
  `@electron/rebuild`, destructures the named `rebuild` export, and calls it
  with a `RebuildOptions` object. That usage is compatible with 4.2.0's named
  ESM export and does not use the removed default export or `nodeGypPath`.
  The smoke test's successful `executing @electron/rebuild` / `completed
  installing native dependencies` phase confirms this integration in practice.
- The repository itself has no direct `@electron/rebuild` API call site to
  update.

### Assumptions, deviations, and unresolved risks

- Validation used temporary Node 22.23.2 because the sandbox-provided Node
  20.19.2 cannot execute the repository-pinned pnpm 11.21.0 (pnpm requires
  Node >=22.13 and uses `node:sqlite`). This also satisfies
  `@electron/rebuild@4.2.0`'s Node >=22.12 engine. The root manifest currently
  states only `node >=20.0.0`; environments actually running Node 20 are a
  remaining compatibility/documentation risk, but changing the project engine
  was outside this task's approved scope.
- The full Electron installer artifacts were not completed because of the
  read-only sandbox cache described above. The native rebuild integration
  itself completed successfully, so no evidence points to a rebuild API
  incompatibility.
- electron-builder also warned that expected `dist-daemon` inputs were absent
  because the requested smoke command was `electron:build`, not the broader
  `build:installer` pipeline. This was not the stopping error and is unrelated
  to the dependency upgrade.
- Acceptance checkboxes remain for independent review/human acceptance; the
  implementation agent has not marked its own work accepted.

## Review

Not reviewed.

## Human acceptance

Pending.
