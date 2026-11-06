# CONTRACT-013: Debug Diagnostics and Tools

Status: Proposed
Approved by:
Approved date:
Related tasks: TASK-047, TASK-048
Related ADRs: ADR-004
Depends on: CONTRACT-007 for validation and error responses

## Purpose

On 2026-11-04 a radio's firmware hung while the app kept showing `connected`.
This contract defines how the daemon decides a radio is not responding, and what
each debug tool does to the serial connection. Those rules need fixing up front
because a wrong answer either blames a healthy radio or leaves the port in a state
the user did not ask for.

## Scope

### Included

- The meaning of "responding" for a connected radio.
- The check result statuses and response shapes.
- The debug tool allowlist, and each tool's effect on connection state.
- Disconnect behavior during reconnect backoff and in-flight connects.

### Excluded

- The page layout, which belongs to TASK-047.
- The app-wide "not responding" status, which belongs to TASK-048.
- A reboot tool, config writes, factory reset, and running outside programs.
- API authentication.

## Actors

- A user on the Debug page, on the host or elsewhere on the LAN.
- `DeviceManager`, which owns the serial port while connected.
- The packet watchdog, which re-requests config after 90 seconds without a mesh
  packet.

## Inputs and outputs

- Input: `deviceId`, and an allowlisted tool ID.
- Output: check results, connection facts, and tool results as defined below.

## Preconditions

- The daemon is running. A `deviceId` must match a saved device row.
- Checks and tools take no port path from the caller.

## Required behavior

### Frame tracking

For each connection the daemon records:

- `lastFrameAt`: the time of the last `FromRadio` frame of any kind. This is
  separate from the watchdog's mesh-packet timer, which ignores non-packet frames.
- `framesThisConnection`.
- `lastConfigRequestAt`: updated by every config request, whether it comes from
  `connect()`, the watchdog, or a tool.
- `configured`: whether `DeviceConfigured` was reached for the latest request.
  `configure()` resolving proves nothing, because it resolves after its 60 second
  timeout on healthy and silent radios alike.

### Radio responding

The response window is 25 seconds, held as a code constant.

| State | Status |
|---|---|
| The daemon does not hold the port | `skipped` |
| A frame arrived after `lastConfigRequestAt` | `pass` |
| No frame since the request, and under 25 seconds have passed | `warn` (waiting) |
| No frame since the request, and 25 seconds or more have passed | `fail` |

Silence with no unanswered request is never a failure. A healthy radio can be
silent, and the watchdog's next request will test it.

### Checks

- `GET /api/debug/checks?deviceId=<id>` is read-only. `deviceId` is optional, and
  without it the response covers the daemon and every saved device.
- A check never opens a serial port, sends anything to the radio, or changes state.
- "Rerun checks" is the page calling this endpoint again, not a tool.
- Serial port permission is `skipped` where it cannot be tested without opening
  the port, including on Windows.
- Results never contain keys, PSKs, or MQTT credentials.

### Tools

`POST /api/debug/tools/:toolId` with body `{ "deviceId": "<id>" }`. The allowlist
is `reconfigure`, `disconnect`, `reconnect`, and `raw-probe`. Only one tool runs
per device at a time.

| Tool | Requires | Effect | Response |
|---|---|---|---|
| `reconfigure` | Port held | Sends a config request | `202` at once |
| `disconnect` | None | Releases the port and stops reconnecting | `200` when released |
| `reconnect` | Port not held | Starts the existing connect path | `202` at once |
| `raw-probe` | None | Runs the probe below | `200` with the result |

Progress after a `202` is visible through `device:status` events and checks.

### Disconnect

After `disconnect` returns, all of the following hold, whatever state the device
was in beforehand, including reconnect backoff and an in-flight `connect()`:

- The port is released, and the reconnect timer and packet watchdog are stopped.
- A `connect()` already in flight does not emit `connected`, start a watchdog, or
  keep the port.
- The daemon does not reconnect until `reconnect` is called or the daemon restarts.

### Raw serial probe

1. Record whether the device was held or in reconnect backoff.
2. Disconnect as above and wait for the port to be released.
3. Open the saved port at 115200 baud without `@meshtastic/core`. Never open it at
   a lower rate, because some boards treat a 1200 baud open as a bootloader request.
4. Send the wake bytes and a `wantConfigId` with a fresh nonce straight away, with
   no passive listening period.
5. Read until `configCompleteId` arrives or 25 seconds pass, then close the port.
6. If the device was held or in backoff, start a reconnect without waiting for it.

| Outcome | Meaning | User guidance |
|---|---|---|
| `healthy` | Config completed and the nonce matched | The radio is fine, so check the daemon connection |
| `partial` | Bytes arrived, but config did not complete with a matching nonce | The link or firmware is unreliable, so retry, then power-cycle |
| `no-response` | 0 bytes after the request | Power-cycle the radio, including its battery if it has one |
| `open-failed` | The port could not be opened | Check whether another program holds it |

The probe sends nothing else, writes no config, and does not keep decoded payloads.

## Postconditions and invariants

- A debug tool never changes radio configuration.
- A tool only ever opens the port saved for its `deviceId`.
- The port is closed when the probe ends, on every path including errors.
- After a probe, the connection state matches the state recorded in step 1, apart
  from a reconnect that is still in progress.

## Failure behavior

| Case | Response |
|---|---|
| Invalid body or query, or a tool ID outside the allowlist | `400` with the CONTRACT-007 validation body |
| Unknown `deviceId` | `404` with `{ "error": string }` |
| Tool already running on the device | `409` with `{ "error": string }` |
| Tool requirement not met | `409` with `{ "error": string }` |
| Daemon shuts down during a probe | The port closes and no reconnect starts |

## Interfaces

```ts
type CheckStatus = "pass" | "warn" | "fail" | "skipped";

interface DebugChecksResponse {
  generatedAt: string;
  devices: {
    deviceId: string;
    port: string;
    portHeld: boolean;
    lastFrameAt: string | null;
    framesThisConnection: number;
    lastConfigRequestAt: string | null;
    configured: boolean;
    checks: DebugCheck[];
  }[];
  // Checks that are not about one device, such as MQTT broker.
  system: DebugCheck[];
}

interface DebugCheck {
  id: string;
  title: string;
  status: CheckStatus;
  summary: string;
  cause: string | null;
  fix: string | null;
  toolIds: string[];
}

interface RawProbeResult {
  outcome: "healthy" | "partial" | "no-response" | "open-failed";
  bytesReceived: number;
  framesReceived: number;
  ownNodeId: number | null;
  durationMs: number;
  reconnecting: boolean;
}
```

## UX expectations

- `disconnect` and `raw-probe` ask for confirmation in the UI. The API does not
  enforce this.
- The probe warns that it drops the connection for up to about 30 seconds, then
  reconnects.
- `cause` and `fix` use plain language, and a failing check offers a tool button
  where a tool can help.

## Validation requirements

- One test per row of the Radio responding table, including a healthy radio that
  stays silent with no request outstanding.
- Tests for disconnect during backoff and during an in-flight `connect()`.
- Tests for each probe outcome, for port closure on error, and for state restore.
- Tests for allowlist rejection, an unknown device, and a concurrent tool.
- Manual runs against a real radio, as listed in TASK-047.

## Open questions

None.
