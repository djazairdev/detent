# Release checklist (C-14′)

Every version bump and every pinned-backend upgrade (S-5) walks this list —
in order, no skips. The porcelain freeze is the item this file exists to make
unskippable.

The version bump is release-please's pull request, `chore(main): release
X.Y.Z` ([`.github/workflows/release.yml`](../.github/workflows/release.yml)):
it moves `package.json`, `package-lock.json`, `.claude-plugin/plugin.json` and
`REFEREE_VERSION` together and writes `CHANGELOG.md`, from the titles of the
pull requests merged since the last release. Walk this list on that pull
request, and merge it only when every item is green: merging tags `vX.Y.Z` and
publishes the release. A long-lived branch merged with a merge commit sets the
version through its pull request's title (`feat: …` for a minor version).

1. **Gates green on both Node lines.** `npm run parity:check`,
   `npm run prompts:check`, `npm run rules:check`, `npm run tickets:check`,
   `npm run lint`, `npm run typecheck`, `npm test` — locally and in CI
   (node 22 + 24). The two checkers joined the list at PRDR-247: both had
   existed for months and ran in no workflow, so the only thing enforcing them
   was someone remembering.
2. **Porcelain freeze re-affirmed (C-14′).** Exactly two commands and the
   five closed decisions, on both surfaces — CLI and plugin. The golden-path
   docs tests are the proof; a failure here is a major-version decision that
   belongs in the PRD first (N-6), never a test edit.
3. **Plugin validates strictly.** `npm run plugin:validate` — marketplace
   manifest, plugin manifest, `skills/`, `agents/`, all under `--strict`.
4. **Local install smoke.** `claude plugin marketplace add <repo-or-path>` →
   `claude plugin install detent@detent` → both skills present, referee
   server `plugin:detent:referee` connects from a configured project → then
   uninstall. (First executed live at T-124; re-run per release.)
5. **Retired: the N-7 self-build.** It was a release gate until 2026-10-10,
   when the maintainer retired it (N-7″, D-16′, PRDR-336); 3.1.0 is the last
   release a self-build certified. Nothing on this list waits for it. The
   number stays, so the items after it keep the numbers that code, tests and
   release notes cite. The `self-build` workflow still runs it by hand, under a
   cap you type, for anyone who wants that evidence; N-7′ says what a run reads
   and does.
6. **Version pins coherent (SEC-2/S-5).** `plugin.json` version equals
   `REFEREE_VERSION`; `pinned.agent_sdk` equals package.json's exact
   dependency; the backend pin is deliberate.
7. **Security fixtures green (SEC).** The hostile-repo fixture
   (`tests/plugin/hostile.test.ts`) and the sec suite pass; the SEC-6
   platform-merge behavior re-verified live on the current CLI.
8. **Schema discipline (F-3).** Any persisted-shape change this release
   bumped `schema_version` with a migration — never silently. A migration
   is an entry in `MIGRATIONS` (`src/kernel/migrate.ts`), tested by
   migrating a state written at the version before (F-3″).
   The 3.1.1 line, released as 3.2.0, is one event, `schema_version` 1 to 2
   (F-3″, PRDR-300): each persisted shape it changes adds its step to that
   one migration before the release (S-1‴), and none gets a version of its own.
   The line also adds these shapes, each first written at 2 (C-2⁷,
   PRDR-279). A later change to any of them is an F-3 event:
   - the conformance record, `docs/conformance.json`, which a project
     commits beside its pack;
   - the pack's schema, in `src/schemas/pack.ts`. Its version covers the
     grammar as well as the parse, so a change to what a pack must say is
     an event too;
   - DISCOVER's `pack` output, the raw, conforming or changed
     classification that its checkpoint persists.
