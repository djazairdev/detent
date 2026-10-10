# Contributing

<!-- djazairdev-template: 1.4.0 -->

Thanks for helping. Newcomers are welcome: you don't need to be an expert, and no question is too small.

## Find something to work on

- Issues labelled [good first issue](https://github.com/djazairdev/detent/issues?q=is%3Aissue+is%3Aopen+label%3A%22good+first+issue%22) are small and well described. [help wanted](https://github.com/djazairdev/detent/issues?q=is%3Aissue+is%3Aopen+label%3A%22help+wanted%22) issues need more context but are ready for anyone.
- Comment on the issue to say you're working on it, so no one else starts the same thing. If you stop, say so.
- For anything bigger than a small fix, open an issue first and agree on the approach.

## Set up

Detent is a Claude Code plugin written in TypeScript. You need Node.js 22 or later.

```bash
git clone https://github.com/djazairdev/detent
cd detent
npm ci
```

## Run the checks

The same commands CI runs on every pull request, on Node 22 and 24:

```bash
npm run parity:check    # the parity report and the critical path are up to date
npm run prompts:check   # prompts/manifest.json pins the hash of every role prompt
npm run lint
npm run typecheck
npm test
```

If `parity:check` or `prompts:check` fails, run `npm run parity` or `npm run prompts` to regenerate the file, and commit it with your change.

## Follow the rules

[AGENTS.md](AGENTS.md) holds the engineering rules, for people and for the agents Detent runs: no `//` comments in TypeScript, no `any` in `src/`, at most 300 lines per `src/` file, every test citing the ticket it closes, and more. `npm run lint` enforces many of them; a reviewer checks the rest.

## Send a pull request

1. Fork the repository and create a branch from the default branch.
2. Make one change per pull request, with a test when you change behaviour.
3. Run the checks above.
4. Open the pull request, say what it changes and why, and link the issue (`Closes #12`).
5. Give it a title in the [Conventional Commits](https://www.conventionalcommits.org) form, `type: what it does`:

   | Title | When |
   |---|---|
   | `fix: a ceiling no longer auto-retries` | A bug fix |
   | `feat: route the planner to a cheaper model` | A new feature |
   | `feat!: rename the exit codes` | A change that could break someone who uses Detent |
   | `docs: explain the golden path` | Documentation only; also `test:`, `ci:`, `chore:`, `refactor:`, `build:`, `style:`, `perf:` |

   A scope in brackets is optional: `fix(referee): …`. A check fails until the title fits, and you can edit the title at any time.

CI runs the checks on every pull request. A maintainer reviews it; we may ask for changes, which is normal. Pull requests are squash-merged, so the title becomes the commit's message. A maintainer may merge a long-lived branch with a merge commit instead, to keep its history; the merge commit takes the title too.

## Our pledge

The maintainers reply to every newcomer's pull request within 7 days, even if only to say when we'll review it.

## Conduct and security

Everyone follows the [code of conduct](https://github.com/djazairdev/.github/blob/main/CODE_OF_CONDUCT.md). Report security problems privately, as the [security policy](https://github.com/djazairdev/detent/security/policy) says, never in a public issue.

## Licence

By contributing, you agree that your work is released under the project's [MIT licence](LICENSE).
