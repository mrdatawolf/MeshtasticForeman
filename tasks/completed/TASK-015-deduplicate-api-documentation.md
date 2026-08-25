# TASK-015: Deduplicate API documentation

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

`API_PROMISES.md` and `docs/api/index.md` are not maintained as two independent copies — either one is generated from the other, or one is chosen as canonical and the other links to it.

## Context

`API_PROMISES.md` (root, 28KB) currently exists; confirm whether `docs/api/index.md` already exists or needs to be created — check during implementation, since `docs/ARCHITECTURE.md` already links to `API_PROMISES.md` as "the full contract."

## Scope

### Included

A decision (for your approval, since this is a real choice with alternatives, even if lightweight) between generation vs single-canonical-with-link; implementing whichever is chosen.

### Excluded

Rewriting API documentation content — this is strictly a dedup/structure task.

## Plan

1) Confirm current state of `docs/api/index.md` (exists as a stale copy, or doesn't exist yet). 2) Recommend to you: given `API_PROMISES.md` is the established, actively-linked root file, the simplest low-risk option is likely "keep `API_PROMISES.md` canonical, make `docs/api/index.md` a thin VitePress page that includes/links to it" rather than building a generator — but this is your call to make, not mine to decide unilaterally. 3) Implement the approved approach.

## Acceptance criteria

- [x] `API_PROMISES.md` and `docs/api/index.md` have exactly one canonical content source; `docs/api/index.md` now includes the root file with VitePress's native `@include` directive.
- [x] `docs/ARCHITECTURE.md`'s existing `../API_PROMISES.md` link remains present and accurate; the equivalent link in `docs/guide/architecture.md` is also unchanged and accurate.
- [x] The VitePress docs site (`pnpm docs:build`) builds successfully with VitePress 1.6.4 (`build complete in 4.24s`).

## Validation requirements

`pnpm docs:build` succeeds; manual check that both surfaces (root file, docs site) show consistent content.

## Risks and assumptions

This task's plan includes a small decision point I'm flagging for your explicit call rather than deciding myself, per my role boundaries.

## Blocker

None.

## Implementation handoff

### Changes made

Before this change, `docs/api/index.md` was a stale-risk full copy of the 1,171-line root `API_PROMISES.md`. It therefore created a second independently maintained copy of the API contract.

`docs/api/index.md` is now a five-line VitePress page with a short introduction and the native `<!--@include: ../../API_PROMISES.md-->` directive. This keeps the complete contract browsable at `/api/` while making root `API_PROMISES.md` the sole content source. Native inclusion avoids both a custom generator script and all hand-copy synchronization risk. It also reinforces the existing canonical-source design: `packages/web/src/App.tsx` already raw-imports root `API_PROMISES.md` directly for its in-app rendering. No TypeScript or TSX file was changed.

`API_PROMISES.md` itself was not edited. Its SHA-256 during validation was `9b5b2661942c66b7ba1285a55fc9315b431d1d051a118f5ae006488cdfad8866`.

### Validation performed

The exact command run from the repository root was:

```sh
pnpm docs:build
```

Result: pass. The successful run used locally cached pnpm 9.15.0 because the sandbox provides Node 20.19.2, while the repository-pinned pnpm 11.21.0 requires the repository-declared Node 22.13 or newer. The build emitted that engine warning but completed successfully:

```text
WARN  Unsupported engine: wanted: {"node":">=22.13.0"} (current: {"node":"v20.19.2","pnpm":"9.15.0"})
> meshtastic-foreman@0.8.3 docs:build /home/patrick/Documents/Github/MeshtasticForeman
> pnpm --filter @foreman/docs build
> @foreman/docs@1.0.0 build /home/patrick/Documents/Github/MeshtasticForeman/docs
> vitepress build .

  vitepress v1.6.4

- building client + server bundles...
✓ building client + server bundles...
- rendering pages...
✓ rendering pages...
build complete in 4.24s.
```

The generated `docs/.vitepress/dist/api/index.html` contains the thin-page introduction, the included `MeshtasticForeman API Promises` heading, and generated endpoint heading IDs, confirming that VitePress resolved the include and rendered the contract on `/api/`.

Both architecture references remain present and accurate at line 51: `docs/ARCHITECTURE.md` and `docs/guide/architecture.md` each link to root `API_PROMISES.md` via `../API_PROMISES.md`.

### Assumptions, deviations, and unresolved risks

No implementation deviation was required. The only validation-environment deviation was using cached pnpm 9.15.0 under Node 20.19.2, as noted above; VitePress itself built successfully at the declared 1.6.4 version.

The included headings render with working VitePress-generated anchor targets. However, a pre-existing mismatch remains inside the canonical contract's handwritten table of contents: for example, its link is `#get-apidevices`, while VitePress generates the endpoint heading target `#get-api-devices`. Consequently, that handwritten in-page link does not resolve in the built page. This mismatch is not caused by the include (the former copied page had the same Markdown), and correcting `API_PROMISES.md` content is explicitly outside this deduplication task.

## Review

Not reviewed.

## Human acceptance

Pending.
