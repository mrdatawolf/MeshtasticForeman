# TASK-002: Add a shared base TypeScript configuration

Owner role: Implementer
Assigned agent: openai-coder
Proposed by: jarvis
Proposed date: 2026-08-24
Approved by: Patrick
Approved date: 08/24/26
Related contracts: None
Related ADRs: None
Dependencies: None (independent of TASK-001; can run in parallel)

## Desired outcome

One base `tsconfig.json` at the repo root defines shared compiler options; `packages/daemon/tsconfig.json`, `packages/web/tsconfig.json`, and `packages/shared/tsconfig.json` extend it and only override what's genuinely package-specific.

## Context

All three packages currently maintain independent `tsconfig.json` files with no shared base, risking drift in strictness settings.

## Scope

### Included

Root `tsconfig.base.json`; updating the three package configs to `extends` it; preserving each package's necessary differences (e.g. web's DOM lib vs daemon's Node lib, JSX settings).

### Excluded

Changing strictness settings beyond what's needed to unify them (don't introduce new strict flags as a side effect unless called out and reviewed separately).

## Plan

1) Diff the three existing configs to find the genuinely shared subset. 2) Create `tsconfig.base.json` with that subset. 3) Update each package config to extend it, keeping only real differences. 4) Confirm `tsc --noEmit` still passes in each package (the existing `build` scripts run this).

## Acceptance criteria

- [ ] `pnpm build` (which runs `tsc --noEmit` in each package) passes for daemon, web, and shared with no new type errors.
- [ ] Each package's `tsconfig.json` extends the shared base and contains only package-specific overrides.
- [ ] No change to emitted JS/type-checking behavior beyond consolidating the config (verified by comparing `tsc --noEmit` output before/after).

## Validation requirements

`pnpm build` across all three packages, before and after, with identical (empty) error output.

## Risks and assumptions

Low risk — this is a config consolidation with no source changes. Assumes current per-package differences are intentional (e.g. `lib` settings) rather than accidental drift; flag any surprising difference found during the diff rather than silently resolving it.

## Blocker

None.

## Implementation handoff

### What changed

- Added root `tsconfig.base.json`.
- Updated `packages/daemon/tsconfig.json`, `packages/web/tsconfig.json`, and
  `packages/shared/tsconfig.json` to extend `../../tsconfig.base.json`.
- Moved the task through `approved` -> `in-progress` -> `review` with plain
  filesystem moves. Git staging and commits were explicitly delegated to a
  separate process because Git metadata is read-only in this session.

The base contains only the compiler options whose values were identical in all
three original package configs: `target: "ES2022"`, `strict: true`,
`esModuleInterop: true`, `skipLibCheck: true`, and `resolveJsonModule: true`.
No compiler flags were added. Identical-looking `include` and `exclude` arrays
remain in each package because inherited relative paths are resolved relative
to the config that declares them; placing `include: ["src"]` in the root base
would select a root `src` directory instead of each package's `src` directory.

Retained package-specific settings:

- daemon: `module`/`moduleResolution: "NodeNext"` for its Node ESM runtime;
  `outDir`, declaration/declaration-map/source-map settings for its configured
  library-style output; `rootDir: ".."` to contain imported shared-package
  source; and the `@foreman/shared` source path mapping.
- web: DOM libraries and `jsx: "react-jsx"` for React browser code;
  `module: "ESNext"` and `moduleResolution: "Bundler"` for Vite; and the
  `@foreman/shared` source path mapping. It continues to omit TypeScript
  `outDir` and emit/declaration settings because its script type-checks with
  `--noEmit` and Vite owns browser output.
- shared: `module`/`moduleResolution: "NodeNext"`, `outDir`, and
  declaration/declaration-map/source-map settings for its Node-compatible
  shared library configuration. It continues to omit `rootDir` and a path
  mapping because it does not compile another workspace package's source.

### Investigation findings

- daemon `rootDir: ".."` is intentional and necessary for the present program.
  The daemon's `@foreman/shared` path maps directly to `../shared/src/index.ts`,
  so the program includes source outside `packages/daemon`. Running
  `./node_modules/.bin/tsc --noEmit --rootDir .` from `packages/daemon` exited 2
  with TS6059 errors stating that `packages/shared/src/index.ts`,
  `ws-protocol.ts`, and `types.ts` are outside the daemon directory. The
  existing parent (`packages`) root contains both source trees and was
  preserved. Shared has no analogous cross-package source import, explaining
  why it has no explicit `rootDir`.
- web's `ESNext`/`Bundler` pair is intentional. Its build script is
  `tsc --noEmit && vite build`, its Vite config uses the React plugin, and its
  sources target React plus DOM APIs. daemon and shared are `type: "module"`
  Node packages and retain `NodeNext`/`NodeNext` instead. This is a genuine
  runtime/toolchain distinction, not three-way drift.

### Validation

Initial attempts using the requested command spelling could not start because
`pnpm` was absent from `PATH`:

```text
pnpm --filter @foreman/daemon exec tsc --noEmit
exit 127
/bin/bash: line 1: pnpm: command not found

pnpm --filter @foreman/web exec tsc --noEmit
exit 127
/bin/bash: line 1: pnpm: command not found

pnpm --filter @foreman/shared exec tsc --noEmit
exit 127
/bin/bash: line 1: pnpm: command not found
```

Before the config edits, local package binaries established the baseline:

```text
(cd packages/daemon && ./node_modules/.bin/tsc --noEmit)  # exit 0; no output
(cd packages/web && ./node_modules/.bin/tsc --noEmit)     # exit 0; no output
(cd packages/shared && ./node_modules/.bin/tsc --noEmit)  # exit 0; no output
```

After the edits, those same three commands each exited 0 with no output. Their
exact diagnostic output therefore remained identical (empty) before and after.

An existing pnpm 9.15.0 executable was then added to `PATH` for validation
(the repository declares pnpm 11.21.0):

```text
PATH="/home/patrick/.local/share/pnpm/store/v11/links/@/pnpm/9.15.0/dabcd8222099706e9d5613e2bbde82a6ffe5e77c8ba18b78fcd77c3eac869433/bin:$PATH" pnpm build
exit 0

> meshtastic-foreman@0.8.3 build /home/patrick/Documents/Github/MeshtasticForeman
> pnpm -r build

Scope: 4 of 5 workspace projects
docs build$ vitepress build .
packages/shared build$ tsc --noEmit
packages/shared build: Done
docs build: Done
packages/daemon build$ tsc --noEmit
packages/web build$ tsc --noEmit && vite build
packages/daemon build: Done
packages/web build: Done
```

The per-package builds also exited 0. daemon output:

```text
> @foreman/daemon@0.7.5 build /home/patrick/Documents/Github/MeshtasticForeman/packages/daemon
> tsc --noEmit
```

shared output:

```text
> @foreman/shared@0.1.0 build /home/patrick/Documents/Github/MeshtasticForeman/packages/shared
> tsc --noEmit
```

web output (in addition to the package/script header):

```text
vite v6.4.1 building for production...
transforming...
✓ 1863 modules transformed.
rendering chunks...
computing gzip size...
dist/index.html                                   0.58 kB │ gzip:   0.38 kB
dist/assets/logo-tz8hItV_.png                 1,698.63 kB
dist/assets/index-B46vZ9Yf.css                   69.94 kB │ gzip:  10.11 kB
dist/assets/react-force-graph-2d-DId-d9Lt.js    178.55 kB │ gzip:  57.54 kB
dist/assets/index-JRjjjHUf.js                 1,049.10 kB │ gzip: 308.34 kB
dist/assets/maplibre-gl-BuUtINCa.js           1,049.99 kB │ gzip: 282.57 kB

(!) Some chunks are larger than 500 kB after minification. Consider:
- Using dynamic import() to code-split the application
- Use build.rollupOptions.output.manualChunks to improve chunking: https://rollupjs.org/configuration-options/#output-manualchunks
- Adjust chunk size limit for this warning via build.chunkSizeWarningLimit.
✓ built in 8.77s
```

### Acceptance-criteria evidence

1. The root and all three filtered builds exited 0; daemon/shared `tsc --noEmit`
   were silent, and web advanced from its silent type-check to a successful Vite
   build without type errors.
2. All three package configs extend the root base and do not redeclare its five
   shared compiler options. Remaining compiler options are tied to each
   package's runtime, output, UI, or cross-package resolution needs; package
   input/exclusion paths remain local for correct relative-path semantics.
3. The same local `tsc --noEmit` commands exited 0 with exactly empty output
   before and after the consolidation. No source files or new compiler flags
   were changed.

### Assumptions and unresolved risks

- The successful pnpm orchestration used locally available pnpm 9.15.0 rather
  than the repository-pinned 11.21.0 because the pinned Corepack download/cache
  was unavailable in this sandbox. Direct TypeScript 5.7 package binaries and
  every requested build passed, so residual risk is limited to pnpm-version
  orchestration differences; CI or review should rerun with pnpm 11.21.0.
- The existing Vite chunk-size warning is unrelated to this config-only change.
- No Git operation was performed. Precise staging and the originally requested
  two-commit history remain for the external Git-capable process.

## Review

Not reviewed.

## Human acceptance

Pending.
