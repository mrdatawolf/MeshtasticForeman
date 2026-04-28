# Contributing to MeshtasticForeman

Thanks for contributing.

## Before you start

- Search existing issues and pull requests before opening a new one.
- For bugs, include clear reproduction steps and environment details.
- For larger features or behavior changes, open an issue first so scope is clear before implementation starts.

## Local setup

```sh
cp .env.example .env
pnpm install
./start-both.sh
```

On Windows, use `start-both.ps1`.

Useful commands:

```sh
pnpm build
pnpm test
pnpm --filter @foreman/web build
pnpm --filter @foreman/daemon build
```

## Project conventions

- User-defined variables belong in the root `.env` file.
- Keep pull requests focused. Avoid bundling unrelated fixes together.
- Do not revert unrelated user changes in a dirty worktree.
- Update docs when behavior, setup, or configuration changes.

## Pull requests

Please include:

- What changed
- Why it changed
- How you tested it
- Screenshots for UI changes when relevant

Small, reviewable PRs are preferred over large batches of unrelated work.
