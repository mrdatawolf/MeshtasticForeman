# TASK-052: Resolve the start-api restart loop on intentional stop

Owner role: Implementer
Assigned agent: general-purpose subagent
Proposed by: Claude, at Patrick Moon's request
Proposed date: 2026-11-06
Approved by: Patrick
Approved date: 2026-11-06
Related contracts: CONTRACT-008 (open question 4)
Related ADRs: None
Dependencies: None

## Desired outcome

We know whether `start-api.sh` restarts the daemon after someone intends to stop it.
The problem is then either fixed or recorded as not worth fixing.

## Context

`start-api.sh` runs the daemon in an unconditional loop:

```bash
while true; do
    pnpm --filter @foreman/daemon dev || true
    ...
    sleep 1
done
```

Since TASK-029, a graceful shutdown ends in `process.exit(0)`, and the loop treats
that like any other exit. `Samples/foreman-api.service` runs this script with
`Restart=on-failure`.

Nobody has observed the problem yet. These are hypotheses to test:

- `systemctl stop` signals the whole control group, so the bash wrapper may die with
  the daemon and the loop may not restart anything.
- Ctrl-C may behave differently. Bash can continue a script when its foreground child
  handles `SIGINT` and exits normally, so a clean exit could restart the daemon.
- `pnpm` and the `dev` script sit between the loop and the daemon. They may affect
  whether signals arrive and which exit code the loop sees.

## Scope

### Included

- Test what happens for `systemctl stop`, Ctrl-C, `SIGTERM` sent only to the daemon
  process, a crash, and a double signal.
- Record the results in this task, including whether the daemon restarted.
- Recommend a fix or no fix, and get Patrick's decision before changing behavior.
- If a fix is approved, implement it in `start-api.sh` or the sample units, keeping
  automatic restart after a crash.
- Update CONTRACT-008's open question 4 with the outcome.

### Excluded

- Changing the shutdown sequence in `packages/daemon/src/index.ts`, unless the chosen
  fix needs a distinct exit code. That change would need Patrick's approval.
- The Electron or Windows launch paths.
- Correcting the older install paths in the sample units.

## Plan

1. Run each stop and crash case and record the result.
2. Bring the findings and a recommendation to Patrick.
3. If approved, implement the fix and repeat the same cases.

## Acceptance criteria

- [x] Each case in Scope has a recorded result: signal path, exit code, and whether the
      daemon restarted.
- [x] Patrick's fix or no-fix decision is recorded in this task.
- [x] If fixed, an intentional stop leaves the daemon stopped and a crash still restarts it.
- [x] If not fixed, the reason is recorded. Not applicable, because this was fixed.
- [x] CONTRACT-008's open question 4 states the outcome.

## Validation requirements

Manual runs of each case under `start-api.sh` and under a systemd unit. If code
changes, also `pnpm lint`, `pnpm test`, and `pnpm build`.

## Risks and assumptions

- A fix must not stop the daemon from recovering after a real crash.
- Test runs must not touch a live daemon's database or radio. Use a separate data
  directory and no radio.

## Findings

Recorded 2026-11-06. Plan steps 1 and 2 only. No fix has been implemented.

### Summary

- **The restart loop is a smaller problem than expected.** `systemctl stop` and a
  single Ctrl-C both leave the daemon stopped. A daemon restarts after an intentional
  stop only when `SIGTERM` goes to the daemon alone, on a double Ctrl-C during shutdown,
  or when the wrapper was started with `SIGINT` ignored.
- **The same wrapper chain has a bigger problem under systemd: `systemctl stop` cuts the
  graceful shutdown short.** Bash dies at once, so systemd treats the main process as
  gone and moves to `final-sigterm`, which signals what is left in the control group.
  The daemon takes that second signal and leaves before closing PGlite.
- **The live service shows this on every recorded stop.** Its journal since 2026-10-01
  has 8 `shutdown begun` lines, 0 `shutdown complete` lines and 0 `PGlite worker` step
  lines. The startups that followed log `removing stale database lock`.
- A crash restarts the daemon in every case tested. The loop is what recovers it.

### Hypotheses

| Hypothesis | Result |
|---|---|
| `systemctl stop` kills the wrapper with the daemon, so nothing restarts | Confirmed, with the shutdown problem above |
| Ctrl-C can restart the daemon after a clean exit | Refuted for a normal foreground terminal. `pnpm` dies of `SIGINT` even though the daemon exits 0, so bash exits too. Holds only if the wrapper inherited `SIGINT` ignored |
| `pnpm` and `dev` affect signals and exit codes | Confirmed. See "Chain behaviour" |

### Results

"Loop saw" is the `pnpm` exit status as bash saw it. "None" means bash was already dead
and the loop never saw an exit. Runs marked "held" kept one `POST` in flight, so the
`HTTP server` step could not finish and shutdown ran long.

| Case | Signal path | Loop saw | Daemon exit | Restarted | Evidence |
|---|---|---|---|---|---|
| `systemctl stop`, fast shutdown, plain unit (same settings as the deployed unit) | systemd `SIGTERM` to control group; bash and `pnpm` die by signal 15, then `final-sigterm` | None | **Aborted.** Last line `retention sweep`, no `PGlite worker`, no `shutdown complete` | No. Stop took 90 s, `Result=timeout` | Real, 2 of 2, no hook. See "Stop comparison" |
| `systemctl stop`, fast shutdown, my `ExecStopPost` added | Same | None | Clean, `shutdown complete`. **This is a measurement artefact**: the extra step appears to give the daemon time to finish first | No. `Result=success`, `code=killed status=TERM` | Real, 2 of 2, but not the deployed setup |
| `systemctl stop`, held | As above, then `final-sigterm` | None | **Aborted about 35-80 ms after the signal.** No `shutdown complete`, no timeout line | No | Real, also no-hook and without `ExecStopPost` |
| `systemctl stop` equivalent, no systemd: one `SIGTERM` each to bash, `pnpm`, `sh`, node | Direct to those exact PIDs | None | Clean (fast). Held: survives the full 10 s, then exit 124 | No | Real; this is the control for the row above |
| Ctrl-C, foreground group | Pty `^C`; `SIGINT` to bash, `pnpm`, `sh`, node. Node exits, `pnpm` dies by signal 2, bash dies by signal 2 | None | Clean. Held: exit 124 after 10 s while bash and `pnpm` wait | No | Real pty, also no-hook |
| `SIGTERM` to daemon only | Node alone | 0 | Clean, exit 0. Held: exit 124 | **Yes**, loop saw 124 when held | Real, also no-hook and under a unit |
| Crash: `SIGKILL` to node | Node alone | 137 | Killed | Yes | Real, also no-hook and under a unit (`NRestarts=0`, the loop recovered it) |
| Crash: real `fatalError` (`API_PORT=not-a-number`, no TTY) | None; startup failure | 1 | Exit 1 after the 5 s wait | Yes, repeatedly | Real |
| Double signal: 2 `SIGTERM` to daemon, 6 ms apart | Node alone | 1 | Second signal took `exit(1)`; no `shutdown complete` | **Yes** | Real |
| Double Ctrl-C, 6 ms or 300 ms (held) apart | Pty `^C` twice; `pnpm` died of `SIGTERM`, not `SIGINT` | 143 | No `shutdown complete` | **Yes**, bash stays in the loop | Real pty |
| Double signal under systemd: stop, then `SIGTERM` to daemon 6 ms later | Control group, then node | None | No `shutdown complete` | No | Real |

Extra cases, beyond the Scope list:

| Case | Result | Evidence |
|---|---|---|
| Ctrl-C with the wrapper's `SIGINT` ignored, as for a job started with `&` from a non-interactive script | Bash ignores it, loop saw 130, **restarted**. This began as a harness mistake (see Method). It is not a test of `start-both.sh`, whose fallback path also has a trap, and that path remains untested | Real for that condition |
| Terminal closed (pty master gone) | Bash and node died by `SIGHUP`. No graceful shutdown, no restart | Real pty |
| `SIGTERM` to `pnpm` only, held | `pnpm` does not forward it. The daemon is orphaned and keeps the port, loop saw 143, and each restart fails with exit 1 | Real |
| `SIGKILL` to bash under a unit | Systemd sent `SIGTERM` to the rest and the daemon shut down cleanly, `Result=signal`. A systemd restart was **not observed**, because the unit was still in `stop-sigterm` at 8 s and my cleanup stopped it | Real, inconclusive on restart |

### Live service evidence

Read-only from the journal of `meshtasticforeman-api.service`, which has a real radio
and database. The deployed unit has `KillMode=control-group` and `Restart=on-failure`.

- Patrick's stop at 14:42:20 ran `websocket clients`, `HTTP server`, `MQTT gateway`,
  `serial devices` and `retention sweep`, in about 23 ms. `PGlite worker` and
  `database lock` never ran. The unit reached inactive in the same second.
- 8 of 8 stops since 2026-10-01 have no `shutdown complete`. The stale lock message is
  on each following startup in the part of the log reviewed (2026-10-28 onward).
- This conflicts with CONTRACT-008, which says `postmaster.pid` is absent after a clean
  shutdown.
- Database health was not checked, because the rules forbid opening `pglite-data`. The
  evidence shows an unclean close, not data loss.

### Chain behaviour

- Process chain: `bash start-api.sh` -> `pnpm` -> `sh -c` -> `node`, all in one process
  group.
- On `SIGTERM`, bash and `sh` die at once and `pnpm` within about 20 ms. The daemon
  outlives all of them, so the main PID is gone while the daemon is still working.
- On a single `SIGINT`, `pnpm` waits for the daemon, then dies by `SIGINT`. Bash treats
  that as an interrupt and exits. This depends on the `pnpm` and `sh` behaviour, not on
  `start-api.sh`.
- `pnpm` turns a `SIGKILL` of the daemon into exit 137.

**How certain the mechanism is.** `SubState=final-sigterm` is observed, and a single
`SIGTERM` without systemd lets the daemon run for 10 s. That the second signal is
`SIGTERM`, and that the daemon exits through `process.exit(1)` at `index.ts:157`, is
inferred. No `strace` was available and the daemon's exit status was not captured in
these runs.

### Stop comparison

Added after the first report, at the coordinator's request. It followed a real-radio run
in a user unit, where the `pnpm` chain stalled for 90 s after `retention sweep` and direct
node stopped in 62 ms. These runs used no radio, no hook and no `ExecStopPost`. Each row
ran twice with matching results.

| Chain | Shutdown | Stop took | Last daemon log line | Node after stop | Result |
|---|---|---|---|---|---|
| `start-api.sh` (`pnpm --filter`) | Fast | **90 s** | `retention sweep` | Gone by 0.27 s, cgroup empty | `timeout` |
| `start-api.sh` (`pnpm --filter`) | Held | **90 s** | `websocket clients` | Gone by 0.27 s, cgroup empty | `timeout` |
| Direct node | Fast | 0.05 s | `shutdown complete` (11-12 ms) | Gone | `success` |
| Direct node | Held | 10 s | `shutdown timed out` | Gone after exit 124 | `exit-code` |

- **Same stall, without the radio.** The last line and the 90 s match the radio run, so
  the radio is not needed for it. The radio run has a real serial step and mine does not.
- **The daemon does not linger.** Node is gone by the first sample after stop begins, and
  `cgroup.events` shows `populated 0`. Systemd then sits in `final-sigterm` for the full
  timeout with nothing left to wait for.
- **The broken log pipe guess is refuted here.** Node's stdout and stderr are the same
  journald socket as the main process. Output does not pass through `pnpm`.
- **The stall has a likely cause outside this repo.** The user manager logged `Failed to
  add control inotify watch descriptor ... No space left on device` 164 times today, with
  `max_user_watches` at 65536. Without that watch it would never hear that the cgroup
  emptied. This is a strong inference, not proven, because changing the limit needs
  `sudo`.
- **`pnpm` is what exposes it.** With direct node, the main process is the daemon, so
  systemd learns of its exit from the process itself and does not need the cgroup event.
- **The real system-level stop did not stall.** It reached inactive in the same second at
  14:42:20 with `Result=success`. The system manager has a separate inotify allowance as
  root. So the 90 s stall should not be expected from the deployed service, but the
  aborted shutdown is present in both.

Earlier 90 s stalls in these runs have the same shape: every held `systemctl stop`, after
`SIGKILL` to bash, and 1 of 10 restart-then-stop runs that had `ExecStopPost`.

**Correction to the first report.** It said a fast `systemctl stop` was clean and treated
the abort as depending on a long shutdown. All those fast runs, including the no-hook
control, had `ExecStopPost` in the unit. The plain unit aborts even a 12 ms shutdown, which
agrees with the live journal.

### Method

- Worktree `start-api.sh`, unmodified. `.env` is git-ignored: empty `MESHTASTIC_PORT`,
  `ENABLE_MQTT=false`, `BOT_ENABLED=false`, `API_HOST=127.0.0.1`, `API_PORT=38127`, and
  `PGLITE_DIR` in the scratchpad. The log line `PGlite ready` showed that path, and
  `/api/devices` returned `[]`. With no port and no saved devices, `reconnectSaved()`
  opens nothing. No radio was used, so serial shutdown was skipped in these runs.
- **Systemd:** `systemd-run --user --unit=t052-<case>-<pid>.service` with
  `Restart=on-failure`, `RestartSec=3` and `KillMode=control-group`, then
  `systemctl --user stop`. These are real systemd stops, on the user manager rather than
  the system manager.
- **Ctrl-C:** a real pty from `script -qfc`. `\003` went through the line discipline,
  with `isig` on and the foreground process group checked. That is a real terminal
  interrupt, except that `script` rather than an interactive shell is the parent.
- **Exit codes:** a `DEBUG` trap sourced through `BASH_ENV` logged `$?` without editing
  the script. No-hook control runs matched for Ctrl-C, daemon `SIGTERM`, crash and
  `systemctl stop`. `pnpm` and bash exit order came from a 5 ms `/proc` poller.
- **`ExecStopPost`:** units used it to record the exit result, except the `nopost` runs
  and the "Stop comparison" runs. It changes the outcome of a fast `systemctl stop`, so
  only the runs without it represent the deployed unit.
- **Held shutdown:** a half-sent `POST /api/proposals` stands in for a slow shutdown. It
  is an approximation, used only for timing. The double Ctrl-C at 6 ms is also tighter
  than a person can type; the 300 ms held run is the realistic one.
- **Discarded run:** the first Ctrl-C run reported a restart, but `SigIgn` showed bash
  had inherited `SIGINT` ignored from `&` in the harness. The harness was corrected and
  the masks were checked. That run now appears only as the labelled extra case.
- PIDs came from walking down from each wrapper, and every run ended with no leftovers.
  The live daemon's PIDs were unchanged through the checks until Patrick stopped the
  service at 14:42:20, as he told the coordinator.

### Recommendation: fix

Fix `start-api.sh`. The restart loop alone would not justify a change, but every
production stop currently skips the PGlite close that CONTRACT-008 requires.

Proposed change, **not yet tested**:

```bash
stopping=0
trap 'stopping=1' INT TERM
cd "$ROOT/packages/daemon"
while true; do
    rc=0
    node --env-file=../../.env --import tsx/esm src/index.ts || rc=$?
    if [ "$stopping" -eq 1 ] || [ "$rc" -eq 0 ]; then
        exit 0
    fi
    echo ""
    echo "  Daemon exited — restarting..."
    echo ""
    sleep 1
done
```

- **Why it should work:** bash runs a trap only after its foreground child exits, so the
  main PID stays alive until the daemon finishes and `final-sigterm` has nothing to hit.
- **It keeps crash recovery:** `SIGKILL` (137), `fatalError` (1) and any other non-zero
  exit still restart, because `stopping` stays 0.
- **It covers the restart cases:** daemon-only `SIGTERM` exits 0 and stays stopped, and a
  double Ctrl-C sets `stopping`. `Restart=on-failure` does not restart after exit 0, and
  `process.exit(0)` is reached only from the shutdown coordinator.
- **Removing `pnpm` is required:** a trap alone should not be enough, because `pnpm` dies
  within about 20 ms of `SIGTERM`, which would return control to bash while the daemon
  is still shutting down.
- **Direct node has been measured, but not this script:** with no `pnpm` or bash, a
  fast stop was clean in 0.05 s and a held stop ran the full 10 s. The real-radio run
  agrees. The loop and trap remain untested.

Risks:

- The `dev` command would be duplicated in `start-api.sh`, so the two could drift.
- Signalling only the wrapper would no longer stop the daemon. `start-both.sh`'s
  background fallback does `kill "$API_PID"`. On Ctrl-C the group also gets `SIGINT`, but
  that path must be tested.
- Do not "fix" that by running node with `&` and forwarding `SIGTERM` from a trap. A
  control-group stop would then deliver two signals and recreate this bug.
- Exit 124 with `stopping=0` (daemon-only `SIGTERM` that timed out) would restart.
- The double-signal `exit(1)` under Ctrl-C would be treated as a stop, which is the
  intent. A real crash that lands during a stop also would not restart.
- The fix does not reach the deployed copy until `~/Scripts/MeshtasticForeman` is
  updated.

Alternatives rejected:

| Option | Why not |
|---|---|
| No fix | Every production stop keeps skipping the PGlite close |
| `KillMode=mixed` | Sends `SIGKILL` to the daemon once bash dies, which is worse |
| Point the unit straight at node, without the script | Sound under systemd, but leaves terminal use unchanged and needs a reinstall of each unit |
| Change the daemon's double-signal rule | Reverses CONTRACT-008 open question 5 and is excluded by this task |

If approved, Plan step 3 reruns these cases, including held `systemctl stop`, and checks
for `shutdown complete` and no `postmaster.pid`.

### Decision needed from Patrick

1. Fix or no fix.
2. If fix: is running node directly, without `pnpm`, acceptable?
3. If fix: should exit 0 always mean stay stopped, and should exit 124 restart?
4. Should `fs.inotify.max_user_watches` be raised, or the watchers using it be found? It
   needs `sudo` and is outside this repo. It would also test the cause of the 90 s stall.

## Blocker

None. Patrick chose to fix this on 2026-11-06.

## Implementation handoff

Task: TASK-052
Implementer: Claude (main session, after the general-purpose subagent's investigation)
Date: 2026-11-06

### Decision

Patrick approved the recommended fix: run node directly, and stay stopped on exit 0 or a
requested stop. Any other exit restarts, including 124 with no stop requested.

### Changes made

- `start-api.sh` runs node directly and sets a trap, so it outlives the daemon.
- `start-both.sh`'s no-terminal fallback sends `SIGTERM` to the daemon rather than the
  wrapper, and does nothing extra on Ctrl-C, which already reached the daemon.
- CONTRACT-008's open question 4 records the outcome.

### Validation performed

All on the real scripts with a temporary database. Stop times are for the user manager.

| Case | Stop time | `shutdown complete` | Restarted | Stale lock left |
|---|---|---|---|---|
| `systemctl --user stop`, no radio | 86 ms | Yes | No | No |
| `systemctl --user stop`, real radio | 72 ms | Yes | No | No |
| `SIGTERM` to the daemon only | n/a | Yes | No | Not checked |
| `SIGKILL` to the daemon | n/a | n/a | Yes | Not checked |
| Stop after that crash restart | 60 ms | Yes | No | Not checked |
| Ctrl-C on a real pty | About 0.1 s | Yes | No | Not checked |
| `start-both.sh` fallback, `SIGTERM` | n/a | Yes | No | Not checked |
| `start-both.sh` fallback, Ctrl-C | n/a | Yes | No | No |

The 90 second stall did not occur in these runs, because the wrapper now outlives the
daemon. `start-api.sh` and `start-both.sh` pass `bash -n`. No TypeScript changed, and
`pnpm test` passed on `main` immediately before this work (539 tests).

### Assumptions and deviations

- The `start-both.sh` runs used a copy with no terminal emulator and a `sleep` in place
  of the frontend. The Ctrl-C run had a parent shell, as a real terminal would.
- `start-both.sh` runs its `SIGTERM` trap only after its foreground command exits. With
  the real frontend, the daemon is therefore not told to stop until the frontend exits.
  This timing is unchanged and was left alone.
- `.vscode/settings.json` now excludes `.claude/worktrees` from file watching. A VS Code
  process held 64,841 inotify watches and the limit was reported as 65,536, and removing
  worktrees lowered it to 37,204. Raising the limit was not needed.

### Unresolved risks

- **Not yet proven on the real service.** `~/Scripts/MeshtasticForeman` runs older code
  and must be updated. After the next `systemctl stop`, its journal should show
  `shutdown complete` and the following start should not log a stale lock.
- The `dev` command now exists in both `package.json` and `start-api.sh`, and the two
  could drift.
- A crash during a requested stop does not restart, which is the intent.
- `start-api.ps1` was not changed or tested.

### Documentation updated

CONTRACT-008 open question 4.

## Review

Not reviewed.

## Human acceptance

Pending.
