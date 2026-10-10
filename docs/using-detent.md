# Using Detent

Moved from the README, which keeps the golden path.

## Works with existing and new projects

**Existing projects** are the primary case, however far along: Detent binds
to the repo's own verification commands, plans from your planning documents,
and works on a run branch: the existing code and history are read, never
rewritten. Scope the document to the work that REMAINS; the generated
tickets are presented for your approval before anything runs, and they are
editable: prune any the codebase already satisfies. If a stale ticket
slips through, the session discovers the premise is already met, signals it,
and stops rather than writing duplicate code. Start from a green suite:
gates run your own commands, and pre-existing failures would be blamed on
the first ticket. Plan increment by increment: an approved plan stays
frozen, and `detent init --replan` starts the next one.

**New projects** need only a folder containing the planning document:
Detent derives the stack, scaffolds through its own bootstrap ticket, and
builds from nothing. That path is the permanent release gate: every Detent
release must build Detent's own walking skeleton from its own PRD.

## Your working tree

During a run Detent works in a per-ticket git worktree under
`.detent/worktrees/`, merged `--no-ff` into the run branch when the ticket is
done — never into your base branch. Your own checkout is left alone.

`--no-worktree` runs in your checkout instead. Say so deliberately: in that mode
Detent resets uncommitted tracked changes at resume, moves untracked files it
does not own aside, and stages the tree when a ticket finalizes. Those are the
right behaviours for a tree Detent owns and the wrong ones for yours.
