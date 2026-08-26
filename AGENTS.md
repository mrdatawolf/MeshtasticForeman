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

## Dispatching isolated (worktree) subagents

An isolated git worktree forks from the repository's default branch (e.g.
`main`), not from whatever branch the orchestrating session is actually on.
If the real working branch (a feature branch, or uncommitted changes on the
current checkout) isn't on the default branch, a worktree subagent silently
builds on a stale base and can miss files, context, or in-flight work
entirely — with no error, since from its point of view that base is simply
"the repository."

Before dispatching a subagent into an isolated worktree:

- Commit anything the subagent needs to see — including new task files —
  to the working branch first. A worktree only sees committed history, never
  uncommitted changes sitting in the originating checkout.
- Explicitly name the real working branch in the subagent's prompt and have
  it sync onto that branch (merge or rebase) before making any changes,
  rather than letting it assume its default fork point is correct.
- After merging a subagent's work back, check for duplicate task-lifecycle
  files it may have had to reconstruct locally because it couldn't see the
  original (e.g. a stale copy left behind in `tasks/approved/` alongside the
  proper one it created in `tasks/review/`), and remove the superseded copy.

This was discovered when several task files existed only as uncommitted
changes on a feature branch; parallel worktree subagents forked from `main`
at dispatch time, never saw them, and each had to reconstruct its task file
by hand — producing duplicate lifecycle copies that needed manual
reconciliation after merging.
