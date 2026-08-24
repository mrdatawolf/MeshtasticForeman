# Task Lifecycle

The directory containing a task file is its authoritative state.

```text
proposed --human approval--> approved --assigned agent--> in-progress
in-progress --implementation handoff--> review
review --human acceptance--> completed
review --changes requested--> in-progress
```

## States

- `proposed/`: A plan exists, but implementation is not authorized.
- `approved/`: The human approved the task and it is ready to be assigned.
- `in-progress/`: An assigned specialist is actively working on it.
- `review/`: Implementation and its handoff are ready for independent review and
  human acceptance.
- `completed/`: The human accepted the work.

## Authority

- Only the human moves a task from `proposed/` to `approved/`.
- An assigned implementer moves its task from `approved/` to `in-progress/`.
- The implementer moves completed work to `review/` after recording its handoff.
- The reviewer records findings but does not implement fixes or accept the task.
- The human moves accepted work to `completed/` or returns it to `in-progress/`.

## Blocked work

Blocked is a condition, not a lifecycle directory. Leave the task in its current
state and add a prominent blocker describing what is needed, who can resolve it,
and its effect. Do not continue beyond the approved scope to bypass a blocker.

## File conventions

Use `TASK-NNN-short-description.md`. Keep the identifier and filename stable when
moving the file. Link contracts as `CONTRACT-NNN` and decisions as `ADR-NNN`.
