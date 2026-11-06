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

- [ ] Each case in Scope has a recorded result: signal path, exit code, and whether the
      daemon restarted.
- [ ] Patrick's fix or no-fix decision is recorded in this task.
- [ ] If fixed, an intentional stop leaves the daemon stopped and a crash still restarts it.
- [ ] If not fixed, the reason is recorded.
- [ ] CONTRACT-008's open question 4 states the outcome.

## Validation requirements

Manual runs of each case under `start-api.sh` and under a systemd unit. If code
changes, also `pnpm lint`, `pnpm test`, and `pnpm build`.

## Risks and assumptions

- A fix must not stop the daemon from recovering after a real crash.
- Test runs must not touch a live daemon's database or radio. Use a separate data
  directory and no radio.

## Blocker

None.

## Implementation handoff

Not started.

## Review

Not reviewed.

## Human acceptance

Pending.
