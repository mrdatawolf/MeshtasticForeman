# TASK-008: Add MQTT gateway tests

Owner role: Implementer
Assigned agent: openai-coder
Proposed by: jarvis
Proposed date: 2026-08-24
Approved by: Patrick
Approved date: 08/24/26
Related contracts: None
Related ADRs: None
Dependencies: TASK-003 recommended, not a hard blocker

## Desired outcome

`mqtt/gateway.ts`'s topic parsing, PSK expansion, encryption/decryption, inbound packet normalization, and malformed-input handling are covered by tests before TASK-025 (Stage 5 gateway split) touches this file.

## Context

`mqtt/gateway.ts` is 960 lines. Confirmed private methods relevant here: `_handleInbound` (topic parsing, channel/gateway extraction, handles the double-slash "no city level" edge case explicitly commented in the source), `_expandPsk`, `_decrypt`, `_encrypt`, `_handleMeshPacket`, `_handleJsonInbound`, `_upsertFromData`. This is a genuine test-before-refactor prerequisite for TASK-025, exactly like TASK-007 is for TASK-012.

## Scope

### Included

Tests for topic-string parsing (including the documented double-slash edge case for missing city-level topics, and the `rootTopic === "all"` special case), PSK expansion/AES-128-CTR encrypt+decrypt round trips, `_handleInbound` normalizing both encrypted and cleartext inbound packets, and malformed/truncated payload handling (should not crash the gateway).

### Excluded

Any restructuring of `gateway.ts` itself (TASK-025).

## Plan

1) Extract or directly test the topic-parsing logic inside `_handleInbound` with a table of real and edge-case topic strings. 2) Test `_expandPsk`/`_encrypt`/`_decrypt` round trips against known test vectors (or self-consistency: encrypt then decrypt recovers plaintext). 3) Test `_handleMeshPacket`'s encrypted-vs-already-decrypted branching. 4) Feed malformed protobuf bytes into the inbound path and assert graceful failure (logged, not thrown/crashing).

## Acceptance criteria

- [ ] Topic parsing is tested including the double-slash/missing-city-level case and the `"all"` root-topic special case.
- [ ] PSK expansion and AES-128-CTR encrypt/decrypt are tested with round-trip and known-vector assertions.
- [ ] Inbound packet normalization is tested for both encrypted and cleartext variants.
- [ ] At least one malformed/truncated-input test confirms the gateway does not crash or leave the MQTT client in a bad state.

## Validation requirements

`pnpm --filter @foreman/daemon test`; do not log decrypted payloads or PSKs in test output per `docs/DEVELOPMENT.md`'s security note — use synthetic test keys only.

## Risks and assumptions

Must not use any real channel PSKs, even for test fixtures — use clearly-synthetic key material.

## Blocker

None.

## Implementation handoff

Implemented `packages/daemon/src/mqtt/__tests__/gateway.test.ts` with 10 unit tests. The tests
mock MQTT connection/publication while exercising the real gateway implementation and protobuf
schemas. No production source was changed.

Acceptance-criteria evidence:

- Topic parsing: `parses encrypted topics and filters the missing-city double slash` verifies
  `msh/US/CA/CentralCoast//2/e/...` normalizes to `US/CA/CentralCoast`; `parses JSON topic
  metadata before delegating` verifies the JSON topic branch; `skips non-2/e topics without
  throwing` verifies graceful filtering; and `subscribes to "#" when rootTopic is "all"` verifies
  the wildcard subscription special case through `start()` and the mocked MQTT connect handler.
- PSK and crypto: `expands sentinel, direct-length, padded, truncated, and all-zero PSKs` covers
  every `_expandPsk` branch; `round-trips plaintext with AES-128-CTR` covers encrypt/decrypt
  symmetry; and `matches a fixed AES-128-CTR known vector` asserts the hardcoded ciphertext
  `bc9848bbb4088190e3018abe47a71209` for a synthetic counting-pattern key, fixed nonce inputs,
  and fixed plaintext.
- Inbound normalization: `parses encrypted topics and filters the missing-city double slash`
  constructs and decrypts an encrypted `ServiceEnvelope`; `normalizes an already-decoded inbound
  packet` constructs the cleartext variant; both assert normalized `_upsertFromData` inputs.
  `passes encrypted mesh bytes through and re-encrypts decoded mesh data` additionally verifies
  both `_handleMeshPacket` publication branches by decoding the published envelopes.
- Malformed input: `contains malformed encrypted protobuf and JSON payloads` asserts both returned
  promises resolve; the MQTT client remains usable and no exception escapes.

Validation performed (all commands and exact outcomes):

- `pnpm --filter @foreman/daemon test -- src/mqtt/__tests__/gateway.test.ts` — could not start,
  exit 127: `pnpm: command not found`.
- `corepack pnpm --filter @foreman/daemon test -- src/mqtt/__tests__/gateway.test.ts` — failed
  before tests, exit 1: Corepack could not create its cache under the read-only home filesystem.
- `COREPACK_HOME=/tmp/task008-corepack corepack pnpm --filter @foreman/daemon test --
  src/mqtt/__tests__/gateway.test.ts` — failed before tests, exit 1: Corepack attempted to obtain
  pnpm from `registry.npmjs.org`, but network access is unavailable.
- `packages/daemon/node_modules/.bin/vitest run
  packages/daemon/src/mqtt/__tests__/gateway.test.ts` — initial iteration: 1 file, 10 tests,
  7 passed / 3 failed due to fixture-expectation mismatches; assertions were corrected to match
  the source and protobuf runtime.
- `packages/daemon/node_modules/.bin/vitest run
  packages/daemon/src/mqtt/__tests__/gateway.test.ts` — final narrow validation: 1 file passed,
  10/10 tests passed.
- `node_modules/.bin/vitest run` from `packages/daemon` — full-suite attempt: 6 files total,
  4 passed / 2 failed; 93 tests total, 58 passed / 35 failed, plus 28 unhandled errors. All 10 new
  gateway tests passed. Pre-existing PGlite-backed tests could not load the absent installed asset
  `node_modules/.pnpm/@electric-sql+pglite@0.4.6/node_modules/@electric-sql/pglite/dist/pglite.data`;
  worker tests also reported unknown `.ts` extension for `src/db/pglite.thread.ts`.
- `packages/daemon/node_modules/.bin/prettier --check
  packages/daemon/src/mqtt/__tests__/gateway.test.ts` — could not start, exit 127: binary absent.
- `packages/daemon/node_modules/.bin/eslint
  packages/daemon/src/mqtt/__tests__/gateway.test.ts` — could not start, exit 127: binary absent.

Assumptions and deviations:

- A minimal `PGlite` cast is used because all DB-writing calls under test are replaced by spies;
  malformed JSON returns before querying. This keeps these tests unit-scoped and independent of
  the incomplete PGlite installation.
- Test keys other than the gateway's documented public default-key expansion expectation are
  explicitly synthetic byte patterns. No private/real channel PSK fixture is used, and tests add
  no logging of decrypted plaintext or key bytes.
- The required pnpm full-suite green result could not be demonstrated because pnpm is unavailable
  and the existing dependency installation lacks a required PGlite runtime asset. No dependency
  installation or out-of-scope repository repair was attempted.

Unresolved risk: a correctly provisioned environment should rerun
`pnpm --filter @foreman/daemon test` to confirm the expected complete green aggregate. The new
gateway suite itself is green (10/10) with the installed Vitest runner.

## Review

Not reviewed.

## Human acceptance

Pending.
