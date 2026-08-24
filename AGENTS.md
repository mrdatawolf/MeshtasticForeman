# Agent Operating Instructions

Read `CLAUDE.md` first. It is the foundational project handbook. This file adds
operational detail for agents and does not override it.

## Instruction precedence

Apply instructions in this order:

1. Direct human instructions for the current task.
2. `CLAUDE.md` foundational rules.
3. This file and any more local `AGENTS.md` applying to the files being changed.
4. Approved contracts for the behavior in their scope.
5. Current project documentation and accepted ADRs.
6. The approved task plan and acceptance criteria.

More specific instructions clarify broader ones but do not silently contradict
them. Surface unresolved conflicts to the human before proceeding.

## Before working

1. Read the applicable task file and repository guidance.
2. Confirm that the task is in the correct lifecycle directory.
3. Read linked contracts, ADRs, architecture, and development documentation.
4. Stay within the assigned role and scope.

Implementation requires a task in `tasks/approved/`. When assigned, the
implementer moves it to `tasks/in-progress/`. See
`docs/workflow/lifecycle.md` for all transition rules.

## During work

- Preserve unrelated behavior and user changes.
- Record material assumptions and raise decisions that exceed the approved scope.
- Validate changes in proportion to their risk and acceptance criteria.
- Update durable documentation when approved behavior or architecture changes.
- Do not mark your own implementation accepted.

## Handoffs

Use the templates in `docs/templates/`. A handoff must state what changed, what
was validated, any deviations or assumptions, and any unresolved risks.
