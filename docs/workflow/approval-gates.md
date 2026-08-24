# Approval Gates

## Design approval

Meaningful work requires human approval of its intended outcome, boundaries, and
architectural direction before an implementation task is approved.

## Contract approval

Large, risky, externally visible, or cross-cutting work requires an approved
behavioral contract. Small work may use acceptance criteria in the task.

## Implementation authorization

Moving a task into `tasks/approved/` authorizes implementation of that scope. It
does not authorize adjacent changes.

## Acceptance

Implementation completion is not acceptance. After review, only the human may
move a task into `tasks/completed/`.

Approval should be recorded in the task file with the approver and date.
