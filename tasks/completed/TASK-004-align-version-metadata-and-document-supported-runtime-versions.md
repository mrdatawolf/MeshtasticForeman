# TASK-004: Align version metadata and document supported runtime versions

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

Root `package.json` is the single source of truth for the application
version. The setup guide states supported Node.js/pnpm versions.

## Context

Version metadata previously drifted across four values: root `package.json`
(0.8.0), daemon/web `package.json` (0.7.5), shared (0.1.0), and `VERSION.txt`
(0.8.3). The human has resolved the source-of-truth question directly: root
`package.json` is canonical, now set to 0.8.3 (`VERSION.txt`'s last value),
and `VERSION.txt` has been deleted. Per-package versions in
`packages/daemon`, `packages/web`, and `packages/shared` do not need to track
root — those packages are `"private": true` and may version independently.
`scripts/sync-version.js` already reads root `package.json` as its source and
propagates it into `electron-app/package.json` so `electron-builder` stamps
the correct installer version — that script needs no redesign, only
confirmation it still runs cleanly now that `VERSION.txt` is gone.

Deleting `VERSION.txt` broke a live code path, not just documentation:
`start-both.sh`, `start-api.sh`, `start-frontend.sh` (and their `.ps1`
equivalents) all read `VERSION.txt` to print the version banner, and the
`.sh` scripts run under `set -euo pipefail` — with `VERSION.txt` gone, `grep`
exits non-zero and the script aborts before launching anything. This has
already been fixed directly (outside the normal task-approval flow, since it
was blocking the app from starting at all): all six scripts now read the
version from root `package.json` (`node -p "require('.../package.json').version"`
in the `.sh` scripts, `(Get-Content package.json -Raw | ConvertFrom-Json).version`
in the `.ps1` scripts) instead of `VERSION.txt`.

## Scope

### Included

Confirming `scripts/sync-version.js` runs correctly against the now-current
root version with `VERSION.txt` removed; running it so
`electron-app/package.json` picks up 0.8.3; leaving `packages/daemon`,
`packages/web`, and `packages/shared` versions as independently-managed
fields (no forced alignment); adding a "Supported versions" note to
`SETUP.md` (Node >= 20, pnpm per `packageManager`); updating the one
remaining stale reference to `VERSION.txt` in `docs/ROADMAP.md` (line ~43).
The six startup-script breakages are already fixed (see Context) — this
task's implementer should verify that fix rather than redo it.

### Excluded

Bumping the actual product version number as part of this task (this is a
metadata-consistency fix, not a release). Forcing `packages/daemon`,
`packages/web`, or `packages/shared` versions to match root — that was
explicitly ruled out by the human's decision.

## Plan

1) Confirm `scripts/sync-version.js` runs cleanly with `VERSION.txt` absent (it doesn't read that file, so this should be a no-op check, not a code change). 2) Run it and confirm `electron-app/package.json` is updated to 0.8.3. 3) Verify the six startup scripts (already patched to read root `package.json` instead of `VERSION.txt`) still launch correctly on both bash and PowerShell. 4) Add the Node/pnpm version note to `SETUP.md`. 5) Update the stale `VERSION.txt` reference in `docs/ROADMAP.md` (line ~43) to reflect that root `package.json` is now the sole source of truth.

## Acceptance criteria

- [ ] Root `package.json` is documented as the canonical version source in `docs/DEVELOPMENT.md`.
- [ ] `electron-app/package.json`'s version matches root `package.json` after running `scripts/sync-version.js`.
- [ ] `packages/daemon`, `packages/web`, and `packages/shared` are explicitly *not* required to match root version (documented, not silently left ambiguous).
- [ ] `SETUP.md` states the minimum supported Node.js and pnpm versions.
- [ ] No remaining reference to `VERSION.txt` anywhere in the repository (docs, scripts, CI, installer config) — only `docs/ROADMAP.md` line ~43 is known to still mention it as of this writing.
- [ ] `start-both.sh`/`start-api.sh`/`start-frontend.sh` and their `.ps1` equivalents launch successfully and print the correct version (already patched; verify, don't redo).

## Validation requirements

Run `node scripts/sync-version.js` and confirm `electron-app/package.json` reflects 0.8.3; run `pnpm build:installer` (or at least the `electron:build` version-sync step) to confirm nothing depending on the removed `VERSION.txt` breaks; `grep -rn "VERSION.txt" .` (excluding `node_modules`) returns nothing.

## Risks and assumptions

Low risk, purely metadata. The source-of-truth question that previously required human judgment is now resolved: root `package.json` is canonical, `VERSION.txt` is gone, and subfolder package versions are intentionally independent.

## Blocker

None.

## Implementation handoff

Implementer: OpenAI Codex
Date: 2026-08-24

### Changes made in this session

- Ran `node scripts/sync-version.js`; it propagated the canonical root version
  from 0.8.0 to 0.8.3 in `electron-app/package.json`.
- Replaced the placeholder prerequisite in root `SETUP.md` with supported
  versions: Node.js 20.0.0 or newer and the pinned pnpm 11.21.0.
- Added version-metadata guidance to `docs/DEVELOPMENT.md`: root
  `package.json` is canonical, the three private workspace packages version
  independently, and `scripts/sync-version.js` supplies the Electron package
  version used by `electron-builder`.
- Moved this task with plain filesystem `mv` from `tasks/approved/` to
  `tasks/in-progress/`, and will move it to `tasks/review/` after completing
  this handoff. At the human's direction, the orchestrator—not this
  implementer—will perform all Git lifecycle staging and commits outside the
  sandbox.

### Previously completed and verified

- The root `package.json` version was already 0.8.3; this session did not bump
  the product version.
- `VERSION.txt` had already been deleted.
- All six root startup scripts had already been changed to read the version
  from root `package.json`. This session inspected them and made no changes.
- `docs/ROADMAP.md` had already been rewritten to say "Align version
  metadata" without naming the deleted version file. This session made no
  change to it.

### Validation performed

- `node scripts/sync-version.js` printed
  `Syncing version: 0.8.0 → 0.8.3`; reading
  `electron-app/package.json` afterward confirmed `"version": "0.8.3"`.
- `bash -n start-both.sh`, `bash -n start-api.sh`, and
  `bash -n start-frontend.sh` each passed with no diagnostic output.
- Inspection confirmed each shell script uses
  `node -p "require('$ROOT/package.json').version"` and each PowerShell script
  uses `(Get-Content "$root\package.json" -Raw | ConvertFrom-Json).version`.
  PowerShell execution was intentionally not attempted, per task direction.
- Repository-wide `grep -rn "VERSION.txt" . --include="*" -I | grep -v
  node_modules` found only historical prose in this task file; there were no
  live code, documentation, CI, or installer references.
- Package inspection reported `daemon: private=true, version=0.7.5`,
  `web: private=true, version=0.7.5`, and
  `shared: private=true, version=0.1.0`; these versions were left unchanged.

### Acceptance criteria evidence

- **Canonical source documented:** `docs/DEVELOPMENT.md` explicitly identifies
  root `package.json` as the canonical, single application-version source.
- **Electron version synchronized:** root and `electron-app/package.json` are
  both 0.8.3 after the sync command.
- **Private versions independent:** `docs/DEVELOPMENT.md` explicitly says
  `packages/daemon`, `packages/web`, and `packages/shared` are private,
  independently versioned, and need not track root.
- **Supported runtime documented:** root `SETUP.md` states Node.js >= 20.0.0
  and pinned pnpm 11.21.0.
- **Deleted-file references removed:** the full-repository grep found only
  historical occurrences in this task file.
- **Startup readers verified:** all six read root `package.json`; all three
  shell scripts pass `bash -n`.

### Assumptions and deviations

- Root `SETUP.md` is canonical because `README.md` designates it as the current
  setup guide; `docs/SETUP.md` was intentionally left untouched as directed.
- Validation followed the revised human direction: shell scripts were syntax
  checked and PowerShell scripts inspected, but startup processes were not
  launched and PowerShell was not executed.
- No Git command was used after the revised instruction. Git staging,
  lifecycle rename detection, and commits remain the orchestrator's work.

### Unresolved risks

- No product-behavior risk identified. The only remaining operational step is
  for the orchestrator to stage the exact scoped paths and commit the lifecycle
  moves and content changes.

## Review

Not reviewed.

## Human acceptance

Pending.
