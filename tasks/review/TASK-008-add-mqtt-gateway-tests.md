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

- pnpm resolution investigation found that the shell exports
  `NVM_BIN=/home/patrick/.nvm/versions/node/v24.16.0/bin` but omits it from `PATH`. The working shim
  is `/home/patrick/.nvm/versions/node/v24.16.0/bin/pnpm`, resolving through NVM Corepack to the
  repository-pinned pnpm 11.21.0 already present in the local Corepack cache. The root
  `package.json` pins `pnpm@11.21.0+sha512...`; `pnpm --version` returned `11.21.0` after prepending
  `NVM_BIN` to `PATH`. Root `node_modules/.bin` has project tools but no pnpm shim.
- Initial exact-command attempt,
  `PATH=/home/patrick/.nvm/versions/node/v24.16.0/bin:$PATH pnpm --filter @foreman/daemon test`,
  resolved pnpm but exited 1 before tests. pnpm's automatic dependency-status check attempted an
  internal install and failed opening its read-only store SQLite database with
  `[ERR_SQLITE_ERROR] unable to open database file`. No explicit `pnpm install` was run.
- Authoritative exact-command run,
  `PATH=/home/patrick/.nvm/versions/node/v24.16.0/bin:$PATH
  PNPM_CONFIG_VERIFY_DEPS_BEFORE_RUN=false pnpm --filter @foreman/daemon test`, disabled only that
  automatic pre-script dependency check and executed the requested `pnpm --filter
  @foreman/daemon test` script. Result: exit 1; 7 test files total, 5 passed / 2 failed; 144 tests
  total, 138 passed / 6 failed; duration 87.96s. All 10 gateway tests passed.
- The six exact-command failures were confined to files outside TASK-008's allowed scope:
  `src/db/__tests__/open.test.ts` had five failures (one 5000ms timeout while opening the worker DB,
  followed by four `TypeError: Cannot read properties of undefined (reading 'exec')` failures),
  and `src/__tests__/db/migrations.test.ts` had one 5000ms timeout in `migrates an empty database
  to the latest schema`. `src/mqtt/__tests__/gateway.test.ts` was not named in any failure or error.
- `packages/daemon/node_modules/.bin/vitest run
  packages/daemon/src/mqtt/__tests__/gateway.test.ts` — initial iteration: 1 file, 10 tests,
  7 passed / 3 failed due to fixture-expectation mismatches; assertions were corrected to match
  the source and protobuf runtime.
- `packages/daemon/node_modules/.bin/vitest run
  packages/daemon/src/mqtt/__tests__/gateway.test.ts` — final narrow validation: 1 file passed,
  10/10 tests passed.
- `node_modules/.bin/vitest run` from `packages/daemon` — full-suite attempt: 6 files total,
  4 passed / 2 failed; 93 tests total, 58 passed / 35 failed, plus 28 unhandled errors. All 10 new
  gateway tests passed. Untouched PGlite-backed tests could not load the then-absent installed asset
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
- The full pnpm suite is not green due exclusively to DB tests outside this task. During the earlier
  raw run the PGlite `pglite.data` asset was absent and the worker could not load its `.ts` entry;
  the asset now exists with a later timestamp, while the exact pnpm run still times out initializing
  the DB/worker. This is consistent with an incomplete or concurrently changing shared
  `node_modules` installation/runtime setup, not the mocked, DB-independent gateway tests. No
  dependency repair, source fix, or explicit install was attempted.

Unresolved risk: the two unrelated DB test files need a stable dependency installation and worker
runtime before the complete daemon suite can be demonstrated green. The requested exact pnpm
command does demonstrate that the TASK-008 gateway suite itself is green (10/10).

## Review

Not reviewed.

## Human acceptance

Pending.
