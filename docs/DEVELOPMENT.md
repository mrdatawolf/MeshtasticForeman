# Development Guide

## Technology stack

* TypeScript throughout, managed as a pnpm workspace (`pnpm-workspace.yaml`).
* `packages/daemon` — Node.js + Fastify backend (serial, MQTT, REST, WebSocket,
  PGlite persistence).
* `packages/web` — React frontend (Vite).
* `packages/shared` — TypeScript types shared between daemon and web.
* `electron-app/` — Electron shell used to package installers via
  `electron-builder`.
* `docs/` — VitePress documentation site (`@foreman/docs`).
* Node.js >= 22.13 (required by the pinned `pnpm@11.21.0`, which uses
  `node:sqlite`), pnpm pinned to `11.21.0` via `packageManager`.

### Version metadata

The root `package.json` is the canonical, single source of truth for the
application version. The private `packages/daemon`, `packages/web`, and
`packages/shared` packages have independent `package.json` versions and are not
required to track the root version. `scripts/sync-version.js` propagates the
root version to `electron-app/package.json` for `electron-builder`.

## Repository layout

```text
packages/daemon   Backend: DeviceManager, MqttGateway, PGlite DB, REST API, WebSocket
packages/web      React frontend: Nodes, Map, Messages, Analytics, Activity, Logs, Config
packages/shared   Shared TypeScript types
electron-app/     Electron main/preload for desktop packaging
scripts/          Build/versioning helpers (bundle-daemon.js, sync-version.js)
docs/             VitePress documentation site + project knowledge (this file, ROADMAP.md, etc.)
tasks/            DbC task board — see tasks/README.md
```

See `docs/ARCHITECTURE.md` for how these pieces fit together at runtime.

## Setup and commands

```sh
cp .env.example .env        # set MESHTASTIC_PORT at minimum
pnpm install
./start-both.sh             # or start-both.ps1 on Windows — daemon + frontend dev server
```

| Command | Purpose |
|---|---|
| `pnpm dev` | Run all packages in parallel dev mode |
| `pnpm build` | Build all workspace packages |
| `pnpm lint` | Lint all workspace packages |
| `pnpm format` | Format all workspace packages |
| `pnpm test` | Test all workspace packages |
| `pnpm build:installer` | Build web, bundle the daemon, and produce Electron installers |

`start-api.sh`/`start-frontend.sh` (and `.ps1` equivalents) start the daemon or
frontend individually. In production, the daemon serves the built frontend —
run `pnpm build` first, then start only the daemon.

## Continuous integration

The application CI workflow (`.github/workflows/ci.yml`) runs on pull requests
targeting `main`. It installs the pinned pnpm version from the root
`package.json`, then checks formatting, linting, the build, and tests as separate
steps. Keep these checks passing before requesting review.

## Dependency and runtime version review

Dependency and runtime-version drift is reviewed on a fixed quarterly schedule
rather than left to ad hoc discovery.

**Cadence and trigger:** the first business day of each calendar quarter
(January, April, July, October).

**Scope of each review:**

* Run `pnpm outdated` and review direct dependencies (root `package.json` and
  each workspace package) against published security advisories and available
  major-version upgrades. Transitive-only bumps are not the focus of this
  review.
* Check Node.js LTS/support status against the `engines.node` floor in the
  root `package.json` (currently `>=22.13.0`), and update the floor if the
  current minimum has fallen out of support.
* Check pnpm's own release/support status against the version pinned in the
  root `packageManager` field (currently `pnpm@11.21.0`), and update the pin
  if it has fallen out of support.

**Responsible party:** the project maintainer. This repository does not
currently define a team or role roster beyond the maintainer, so no other
role is assigned this responsibility.

**Output of a review:** findings are recorded as an ordinary maintenance task
(see `tasks/README.md` for the task lifecycle) rather than acted on directly;
this review process only identifies what, if anything, needs to change.

Automating a reminder for this cadence (for example, a recurring GitHub issue
template) has been discussed but not decided. It remains an optional future
enhancement for the maintainer to pursue if documentation alone proves
insufficient to keep the cadence on track.

## Coding conventions

Not yet formalized beyond what the codebase already does. Stage 1 of
`docs/ROADMAP.md` (shared ESLint config, Prettier, shared base `tsconfig`) is
where these conventions are meant to become explicit and enforced. Until then,
match existing style in the file being changed.

## Testing philosophy

No enforced test suite yet. `docs/ROADMAP.md` Stage 2 defines the intended
initial coverage (analytics endpoints, database migrations, MQTT gateway
parsing/encryption, shared WebSocket schemas, frontend WebSocket lifecycle and
pure logic) and prefers behavior-focused tests over large snapshot tests.

## Security and privacy

* All user-defined configuration (device port, MQTT credentials, ports, map
  style, etc.) is read from the root `.env` file — never hardcode secrets.
* MQTT gateway traffic is re-encrypted with the channel PSK (AES-128-CTR)
  before publishing; do not log decrypted payloads or PSKs.
