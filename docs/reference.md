# Reference

The models Detent runs, what `detent run`'s exit codes mean, and the plumbing commands.

## Models

Every session runs on Claude Opus 5.5 or Claude Sonnet 5.5. `init` writes this
routing to `.detent/config.json`:

| Roles | Model | Effort |
|---|---|---|
| `planner`, `plan_review`, `audit`, `spec_write`, `spec_review` | `claude-opus-5-5` | `max` |
| `review`, `diagnose`, `informed_fix` | `claude-opus-5-5` | `xhigh` |
| `implement`, `blind_fix`, `review_fix`, `research` | `claude-sonnet-5-5` | `xhigh` |

The roles that judge, plan and specify run on Opus; the roles that write code
run on Sonnet. Edit `model_routing` and `effort_routing` in
`.detent/config.json` to change either.

A config written by an earlier Detent
keeps its own routing: `detent doctor`, and `init` and `run` before their first
session, name each role still on a model a newer default supersedes, with the
line that moves it. Sessions run on the Claude Code the Agent SDK bundles, not
the `claude` on your PATH, so `doctor` also fails on a routed model that
runtime cannot serve.

A role that runs several tasks can have one of them routed apart under a
`role/task` key of `effort_routing`, such as `audit/verify_claims` for AUDIT's
claim checks; its other tasks keep the role's level. A first `init` names the
keys. The defaults route a task below its role's level only after it meets the
bar on Detent's evaluation sets, and one has: a VALIDATE reviewer's first-round
review (`spec_review/review`) runs at `high`, which found every blocker of the
review set, and 124 of its 132 majors where `max` found 126, for less than half
of what `max` spent. A verification stays at `max`. A config written by an
earlier Detent keeps its first-round reviews at `max` until
`"spec_review/review": "high"` is added to its `effort_routing`. AUDIT's claim
checks stay at `max` too, since no cheaper setup found every wrong claim, and
nor did `max` itself on a second run.

In `run`, a ticket's risk and Detent's own checks raise these levels, and never
lower them. A ticket the plan labels risky, or whose surface meets a glob of the
config's `risk` list, runs its implement, fix and review sessions at `max`. Each
attempt that fails a gate, has its premise falsified, or is sent back by its
review runs the ticket's next implement or fix session one level higher, up to
`max`, and says so on the ticket. A ticket whose surface meets one that stopped
for you or was falsified earlier in the run starts one level higher.

## Exit codes

`run` exit codes are public API:

| Code | Meaning |
|---|---|
| `0` | plan complete |
| `10` | human-gated items remain |
| `2` | not ready (no or unapproved plan, binding drift) |
| `1` | error |

## Plumbing

Documented, scriptable, and never required on the golden path ([golden-path.md](golden-path.md)):
`detent status`, `detent report`, `detent doctor`, `detent approve <id>`,
`detent requeue <id>`, `detent unclaim <id>`, `detent amend <AM-id>`, `detent verify sync`,
`detent verify lifecycle`.

`detent verify lifecycle` lists the lifecycle scripts a project's manifests declare (`postinstall`,
`prepare`, a gate's `pretest`, and the rest npm runs), each with its body and hash. Detent runs
none of them, until an operator approves a body with `--approve <script>`. A run then executes
that body where npm would have, and an edited body waits for a new approval.

`detent amend <AM-id>` shows an amendment a session filed against the specification pack, and
decides it with `--approve`, `--edit <file>` or `--reject <reason>`. An applied amendment waits for
`detent init`, which re-validates the pack and re-plans the slices it changed.

`detent status` also shows how the plan is running, for the plan and for each
slice: tickets done, and done in their first generation, stops for you,
falsifications by cause, budget breaches, review rounds, cost and time at work,
with the builds that made the plan and its pack; then what `init` spent on each
phase. A run records the same figures in its journal when it ends. They are
evidence for deciding which planning mechanisms stay, and they gate nothing.
`detent status` then counts `run`'s sessions by why each ran at its level:
its role's, raised for its ticket's risk, or raised by evidence, with what each
group cost.
While `init` is in a costly step, `detent status` shows the step, the units done
and left, what they have spent so far, and an estimated finish from the figures
its note gave; after a stop, it shows the step the stop left and how far it got.
