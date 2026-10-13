# Contributing

<!-- djazairdev-template: 1.6.0 -->

Thanks for helping. Newcomers are welcome: you don't need to be an expert, and no question is too small.

## Find something to work on

- Issues labelled [good first issue](https://github.com/djazairdev/detent/issues?q=is%3Aissue+is%3Aopen+label%3A%22good+first+issue%22) are small and well described. [help wanted](https://github.com/djazairdev/detent/issues?q=is%3Aissue+is%3Aopen+label%3A%22help+wanted%22) issues need more context but are ready for anyone.
- Comment on the issue to say you're working on it, so no one else starts the same thing. If you stop, say so.
- Found a bug, or have an idea? [Open an issue](https://github.com/djazairdev/detent/issues/new/choose). That's all it takes: there's no separate form or record to file, and no approval step before you start on an issue labelled for help.
- For anything bigger than a small fix, say in the issue how you'd do it, so we agree on the approach before you spend time on it.

## Set up

Detent is a Claude Code plugin written in TypeScript. You need:

- Node.js 22 or later;
- git, which the tests use to make scratch repositories.

You don't need a Claude account or an API key to develop Detent: the tests never call a model. You need the [Claude Code CLI](https://docs.claude.com/en/docs/claude-code) and an account only to try your change on a real project: load your checkout with `claude --plugin-dir /path/to/detent`.

[Fork the repository](https://github.com/djazairdev/detent/fork), then clone your fork and make a branch:

```bash
git clone https://github.com/<your-username>/detent
cd detent
npm ci
git switch -c fix-the-thing
```

New to the code? [docs/architecture.md](docs/architecture.md) says what each folder of `src/` does, and [docs/README.md](docs/README.md) says which documents are current.

## Run the checks

The same commands CI runs on every pull request, on Node 22 and 24:

```bash
npm run parity:check    # the parity report and the critical path are up to date
npm run prompts:check   # prompts/manifest.json pins the hash of every role prompt
npm run rules:check     # the AGENTS.md rules lint doesn't reach
npm run lint
npm run typecheck
npm test
```

Some files are generated. If a check says one is stale, regenerate it and commit it with your change:

| The check says | Run |
|---|---|
| `parity:check` fails | `npm run parity` |
| `prompts:check` fails | `npm run prompts` (you changed a file in `prompts/`) |
| `agents/<role>.md is stale` or the hook bundle is stale | `npm run plugin` (you changed a prompt, a role's tools or `src/plugin/`) |

### Docs that tests compare with the code

Some passages state what the code does, and tests check that they still match it. If you change one, change the code or the test with it, or CI fails:

- **README, Quick start:** the install commands, and `/detent:init` and `/detent:run` as the only Detent commands.
- **README, What Detent will never do:** the four refusals are stated.
- **[docs/reference.md](docs/reference.md):** each row of the Models table names a role, its model and its level, as the code routes them; each exit code's row matches its code; and the plumbing commands are listed.
- **[docs/golden-path.md](docs/golden-path.md):** only `detent init` and `detent run` appear in its commands; `init`'s phases are listed in order, with the sentence that counts them; and the three numbers measured for the `read` default (113, 132 and 124).

Wording elsewhere is free to change.

## Follow the rules

[AGENTS.md](AGENTS.md) holds the engineering rules, for people and for the agents Detent runs: no `//` comments in TypeScript, no `any` in `src/`, at most 300 lines per `src/` file, a `TODO` or a skipped test naming its issue (`#123`), and more. `npm run lint` enforces many of them; a reviewer checks the rest.

## Send a pull request

1. Make one change per pull request, on a branch of your fork (see *Set up*), with a test when you change behaviour.
2. Run the checks above.
3. Push your branch (`git push -u origin fix-the-thing`) and open the pull request. Say what it changes and why, and link the issue (`Closes #12`).
4. If CI fails and you can't tell why, say so in the pull request: we'll help.
5. Give it a title in the [Conventional Commits](https://www.conventionalcommits.org) form, `type: what it does`:

   | Title | When |
   |---|---|
   | `fix: a ceiling no longer auto-retries` | A bug fix |
   | `feat: route the planner to a cheaper model` | A new feature |
   | `feat!: rename the exit codes` | A change that could break someone who uses Detent |
   | `docs: explain the golden path` | Documentation only; also `test:`, `ci:`, `chore:`, `refactor:`, `build:`, `style:`, `perf:` |

   A scope in brackets is optional: `fix(referee): …`. A check fails until the title fits, and you can edit the title at any time.

CI runs the checks on every pull request. Pull requests are squash-merged, so the title becomes the commit's message. A maintainer may merge a long-lived branch with a merge commit instead, to keep its history; the merge commit takes the title too.

## Review

- A maintainer reviews every pull request; we may ask for changes, which is normal.
- **CI on a pull request from a fork waits until a maintainer approves the run.** That's a safety setting, not a judgement on your change.
- Answer review comments with new commits rather than a force-push, so the conversation stays readable. The squash merge tidies the history.
- A maintainer merges once CI passes and every conversation is resolved.
- Nothing is closed automatically. If a pull request goes quiet for a long time, we ask before we close it.

## AI-assisted contributions

You're welcome to use AI coding tools, on these terms:

- **You are the author.** Understand every line you submit, and be ready to explain it in review. "The model wrote it" doesn't answer a review comment.
- **Say so.** Tick the AI box in the pull request template, and name the tool and what it did. A commit may credit it in a `Co-Authored-By:` or `Assisted-by:` trailer.
- **Run the checks yourself,** and report the results you actually got.
- **Point your agent at [AGENTS.md](AGENTS.md).** Most coding agents read it on their own, and its rules bind them as they bind you. Detent's own sessions read it too, through `readRules()`.
- **No autonomous agents.** A person writes or reviews every issue, pull request and comment; an agent may not open them on its own.
- **Check what a tool finds** before you report it, and report security problems privately. An unchecked report is closed.
- **Keep private things out of AI tools:** unpublished security reports, other people's personal data, and any secret.
- Maintainers may close a low-effort generated pull request or issue without a detailed review.

## Our pledge

The maintainers reply to every newcomer's pull request within 7 days, even if only to say when we'll review it.

## Conduct and security

Everyone follows the [code of conduct](https://github.com/djazairdev/.github/blob/main/CODE_OF_CONDUCT.md). Report security problems privately, as the [security policy](https://github.com/djazairdev/detent/security/policy) says, never in a public issue.

## Licence

Detent is released under the [MIT licence](LICENSE). By submitting a contribution, you agree that it's released under the same terms, as section D.6 of [GitHub's Terms of Service](https://docs.github.com/en/site-policy/github-terms/github-terms-of-service) provides, and that you have the right to submit it. Don't submit code you didn't write unless its licence allows it to be released under MIT, and say where it came from; [ATTRIBUTIONS.md](ATTRIBUTIONS.md) records what Detent already uses.
