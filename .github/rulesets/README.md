# The default branch's ruleset

[`main.json`](main.json) protects the default branch (C3 in the [checklist](https://github.com/djazairdev/project-template/blob/main/docs/CHECKLIST.md)). GitHub doesn't copy rulesets into a repository made from a template, and the djazairdev organisation's plan has no organisation-wide rulesets, so each repository keeps this file and imports it.

## What it does

- Nobody can delete the default branch or force-push to it, maintainers included.
- Every change goes through a pull request. Pull requests are squash-merged; a long-lived branch such as `feat/specification-phase` may be merged with a merge commit to keep its history. Either way the commit is titled by the pull request's Conventional Commit title. No approval is required, so a maintainer working alone isn't blocked; the checks below are what guard the branch.
- The CI jobs listed under `required_status_checks` must pass before a merge, and only GitHub Actions can report them (`integration_id` 15368).
- Copilot's pull requests need no extra approval, so automated pull requests aren't held.

## Before you import it

List **every job that runs the tests** in `required_status_checks`, by its name as GitHub shows it, such as `verify (22)`, and keep `PR title`, the pull request title check. Detent lists both `verify` jobs and `PR title`. A job's name is its `name:` in the workflow, with the matrix values when there is a matrix.

List the test jobs themselves, not only a job that runs after them: when a test fails, a job that `needs` it is skipped, and GitHub counts a skipped required check as passed, so the pull request could still be merged.

## Import it

A maintainer imports it once, in either way:

- **On GitHub:** *Settings → Rules → Rulesets → New ruleset → Import a ruleset*, and choose `main.json`.
- **With the GitHub CLI:**

  ```bash
  gh api repos/djazairdev/detent/rulesets --method POST --input .github/rulesets/main.json
  ```

To change the ruleset later, change `main.json` in a pull request, then update the live ruleset to match. To update it from the file, use `gh api repos/OWNER/NAME/rulesets/ID --method PUT --input .github/rulesets/main.json`, with the ID from `gh api repos/OWNER/NAME/rulesets`.
