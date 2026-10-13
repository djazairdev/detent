# Detent

[![ci](https://github.com/djazairdev/detent/actions/workflows/ci.yml/badge.svg)](https://github.com/djazairdev/detent/actions/workflows/ci.yml)
[![release](https://img.shields.io/github/v/release/djazairdev/detent?display_name=tag&sort=semver)](https://github.com/djazairdev/detent/releases)
[![license: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![node ≥ 22](https://img.shields.io/badge/node-%E2%89%A5%2022-brightgreen.svg)](.github/workflows/ci.yml)
[![Good first issues](https://img.shields.io/github/issues/djazairdev/detent/good%20first%20issue?label=good%20first%20issues&color=7057ff)](https://github.com/djazairdev/detent/issues?q=is%3Aissue+is%3Aopen+label%3A%22good+first+issue%22)
[![Improvements](https://img.shields.io/github/issues/djazairdev/detent/enhancement?label=improvements&color=a2eeef)](https://github.com/djazairdev/detent/issues?q=is%3Aissue+is%3Aopen+label%3Aenhancement+sort%3Areactions-%2B1-desc)

Detent turns planning documents into merged, reviewed, test-gated code using
fresh, single-purpose Claude Code sessions whose every consequential move is
admitted by a deterministic referee.

Planning tools (spec-kit, Superpowers, BMAD and their peers) write excellent
documents. Those documents are Detent's *input*. Detent is the referee
underneath that layer: it makes the run auditable, budgeted, and contained,
whichever way the plan was written.

- **An auditable state machine**: every admitted transition is journaled to
  `transitions.jsonl`; the run's ground truth is never a chat log.
- **Hard budgets**: attempt and spend ceilings you set yourself; a ceiling
  never auto-retries, it presents a human decision.
- **Verification bound to your project, with drift halts**: Detent executes
  your repo's own test/lint/build commands, and halts for re-baselining if
  they change mid-run.
- **Per-ticket write containment**: a deny-enforced hook holds every session
  inside its ticket's declared surface; allow-rules cannot shadow it.

Detent is held to the standard it enforces: every change to Detent lands
through a pull request that must pass its six checks on Node 22 and 24, and
every release walks [the release checklist](docs/release-checklist.md).

Detent is built and maintained in Algeria, as part of [djazairdev](https://github.com/djazairdev).

## Quick start

You need [Claude Code](https://docs.claude.com/en/docs/claude-code) and
Node.js 22 or later. Sessions run on your Claude login, or on an API key in
`ANTHROPIC_API_KEY`, and spend its usage: `init` estimates the cost of each
costly step before it starts.

1. Install the plugin:

   ```bash
   claude plugin marketplace add djazairdev/detent
   claude plugin install detent@detent
   ```

2. Open Claude Code at the root of your project's git repository, and plan the
   work from your planning documents:

   ```
   /detent:init
   ```

   Detent checks your documents, settles what they leave open with defaults
   you can veto, and shows you the plan for approval.

3. Run the approved plan:

   ```
   /detent:run
   ```

   Each ticket is built in a fresh session, tested with your project's own
   commands and reviewed, on a `detent/run-<id>` branch. Your base branch is
   never touched.

What each step does is in [docs/golden-path.md](docs/golden-path.md). Using
Detent on an existing or a new project, and what it does to your working tree,
is in [docs/using-detent.md](docs/using-detent.md). The models it runs, its exit
codes and the plumbing commands are in [docs/reference.md](docs/reference.md).

## What Detent will never do

- Write to your base branch: work happens on a `detent/run-<id>` branch.
- Transition on a claim: only artifacts and exit codes move a ticket forward.
- Redefine a gate mid-run: if a verification command changes in flight,
  Detent halts and asks you to re-baseline.
- Own your tooling: `.detent/` never contains your project's configuration.

## Make your first contribution

1. Pick an issue labelled [good first issue](https://github.com/djazairdev/detent/issues?q=is%3Aissue+is%3Aopen+label%3A%22good+first+issue%22).
2. Comment on it to say you're working on it.
3. Follow [CONTRIBUTING.md](CONTRIBUTING.md) to set up, test and open a pull request, and the rules in [AGENTS.md](AGENTS.md).
4. We reply to newcomers' pull requests within 7 days. A review or a merge may take longer.

You can help without writing code, too: improve the docs, or run Detent on a project of yours and report what went wrong.

## Feedback

- [Ask a question](https://github.com/orgs/djazairdev/discussions/categories/q-a)
- [Report a bug](https://github.com/djazairdev/detent/issues/new?template=bug.yml)
- [Suggest an improvement](https://github.com/djazairdev/detent/issues/new?template=idea.yml), or 👍 the [improvements](https://github.com/djazairdev/detent/issues?q=is%3Aissue+is%3Aopen+label%3Aenhancement+sort%3Areactions-%2B1-desc) you want most
- [Propose a new project](https://github.com/djazairdev/djazair.dev/discussions/categories/ideas) for Algeria
- Follow djazairdev on [Facebook](https://www.facebook.com/djazairdev) and [X](https://x.com/djazairdev) for news

Ask in Arabic, Tamazight, French or English. Code, docs and issue titles are in English, so everyone can search them. Report security problems [privately](https://github.com/djazairdev/detent/security/policy), never in an issue.

## License

[MIT](LICENSE).

---

Part of [djazairdev](https://github.com/djazairdev): growing Algeria's open-source community through useful projects, welcoming first contributions and collaboration. Find more projects in the [djazair.dev Hub](https://djazair.dev/en/hub/). Everyone follows our [code of conduct](https://github.com/djazairdev/.github/blob/main/CODE_OF_CONDUCT.md).
