# TASK-031: Standardize structured logging with context

Owner role: Implementer
Assigned agent: openai-coder
Proposed by: jarvis
Proposed date: 2026-08-24
Approved by:
Approved date:
Related contracts: None
Related ADRs: None
Dependencies: None (benefits from following TASK-024/025's splits for natural per-module logger injection points, but not a hard blocker)

## Desired outcome

Logging is structured (not ad hoc `console.log`) and attaches useful context — device ID, packet ID, operation, error cause — consistently across the daemon.

## Context

Confirmed current logging is via plain `console.log`/`console.error` with manually-formatted prefixes (e.g. `[db]`, `[mqtt]`, `[bot]` seen throughout `db/open.ts`, `mqtt/gateway.ts`, `device-manager.ts`).

## Scope

### Included

Choosing a structured logging approach (Fastify already has a built-in logger — evaluate reusing it daemon-wide vs. a separate structured logger, propose to you if there's a real tradeoff); replacing ad hoc `console.log`/`console.error` calls with structured log calls carrying device ID, packet ID, operation name, and error cause where applicable.

### Excluded

Log aggregation/shipping infrastructure (out of scope — this is about structuring what the daemon emits, not where it goes).

## Plan

1) Evaluate Fastify's built-in logger (already a dependency) as the daemon-wide logging mechanism vs. introducing a separate one — recommend to you based on findings. 2) Define the standard context fields (device ID, packet ID, operation, error cause) and a consistent log-call convention. 3) Migrate `console.log`/`console.error` call sites incrementally, prioritizing the highest-value areas first (device connection lifecycle, MQTT gateway, error paths).

## Acceptance criteria

- [x] A single structured logging approach is used consistently across the daemon, replacing ad hoc `console.log`/`console.error`.
- [x] Log entries related to device/packet operations include device ID, packet ID, operation name, and error cause where applicable.
- [x] No decrypted MQTT payloads or PSKs appear in log output (per `docs/DEVELOPMENT.md`'s existing security requirement) — explicitly verify this isn't regressed by adding more context to logs.

## Validation requirements

Manual review of log output during a representative daemon run (device connect, message send/receive, MQTT publish) confirming structured, contextual entries and confirming no secret material leaks into logs.

## Risks and assumptions

The security constraint (never log decrypted payloads/PSKs) is the main risk here — adding "more context" to logs could accidentally violate it if not carefully scoped; treat this as a hard constraint on the acceptance criteria, not just a nice-to-have.

## Blocker

None.

## Implementation handoff

Implemented by openai-coder on 2026-08-25.

### Changes made

- Added a daemon-wide `createLogger(tag)` wrapper with structured context fields,
  explicit Error serialization, per-module tags, and a concise documented call
  convention.
- Chose a lightweight wrapper instead of Fastify's instance logger because daemon
  logging also occurs before Fastify construction, during shutdown, in standalone
  scripts, and in classes that do not otherwise depend on Fastify. Pino is not a
  direct daemon dependency despite being present transitively through Fastify.
- Kept the logger's output boundary on `console.log`/`warn`/`error`, producing a
  single `[tag] human message {structured context}` argument. This deliberately
  preserves `ConsoleLog.install()` capture, tag parsing, ring-buffer snapshots,
  live `entry` emission, and the websocket `log:entry`/`log:snapshot` pipeline.
- Migrated 146 application console call sites across database startup/migrations,
  daemon lifecycle, device handlers/lifecycle, MQTT, websocket and coverage routes,
  hardware-model sync, and terrain-cache scripts. The only remaining console uses
  are the logger output boundary and the intentional `ConsoleLog` monkey-patch.
- Added a focused logger test covering structured Error/context output and an
  end-to-end logger-to-`ConsoleLog` tagged `LogEntry` capture assertion.
- Updated the MQTT shutdown and shutdown-timeout test assertions to expect the
  intentional tagged structured lines while preserving their existing behavior checks.
- Reviewed all log calls and encryption/decryption paths in MQTT gateway,
  publishing, inbound handling, transport, node persistence, and codec modules.
  No PSK/key, raw message/envelope/packet, payload buffer, decoded data object, or
  plaintext/ciphertext is logged. MQTT boundary errors use sanitized name/code or
  generic failure markers rather than upstream messages.

### Validation performed

- Validation used NVM Node 22.22.3 and cached pnpm 11.21.0 from
  `packages/daemon`.
- Updated eight stale assertions in `device-manager.test.ts` to require the new
  tagged structured warning shape while retaining their existing behavior checks.
- Full, unfiltered `pnpm test`: passed with exit 0. Final Vitest summary:
  `Test Files 14 passed (14)` and `Tests 218 passed (218)`; 0 failures. Duration
  was 90.98 seconds.
- `pnpm exec tsc --noEmit`: passed with exit 0 and no diagnostics.
- `pnpm lint`: passed with exit 0; ESLint reported no diagnostics.
- `pnpm format:check`: passed with exit 0; all matched files use Prettier code
  style.
- `git diff --check`: passed.
- Source inventory found no application `console.*` calls outside `logger.ts` and
  the intentional `activity/console-log.ts` capture implementation.

### Assumptions and deviations

- Fastify's built-in access logs remain Fastify/Pino framework output; every daemon
  application call site uses the new wrapper. Disabling access logs was not needed
  to standardize application logging and would remove existing diagnostics.
- No physical device or configured MQTT broker was available, so automated device,
  MQTT parsing/encryption, websocket, and logger-capture tests plus static security
  review replaced the requested representative live hardware/broker run.
- MQTT error detail is intentionally less verbose than elsewhere: original boundary
  error messages are excluded because they could theoretically embed payload or key
  material. Sanitized name/code objects remain structured error causes.
- Existing uncommitted changes in overlapping source and test files were preserved;
  formatting was limited to files touched by this logging task.

### Unresolved risks

- Review should exercise a real device connect/message flow and configured broker
  publish/receive flow to confirm operational log usefulness and absence of secret
  material in the actual third-party runtime.
- The `ConsoleLog.install()` monkey-patch is intentionally retained as the UI capture
  boundary. A future logger transport change must preserve or replace that pipeline
  explicitly; bypassing console would stop live activity-log delivery.

## Review

Not reviewed.

## Human acceptance

Pending.
