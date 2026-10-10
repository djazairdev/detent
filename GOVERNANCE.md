# Governance

This document says who runs the project, how decisions are made, and how that can change.

## Roles

- **Maintainers** set the project's direction and scope, review and merge pull requests, publish releases, handle security reports, and act as moderators under the [code of conduct](https://github.com/djazairdev/.github/blob/main/CODE_OF_CONDUCT.md). They are listed below and in [`.github/CODEOWNERS`](.github/CODEOWNERS), so GitHub asks them to review each pull request.
- **Contributors** are everyone who opens an issue, answers a question, reviews, translates, or writes documentation or code.
- **Triagers** are trusted contributors who may label, assign and close issues. The role exists for when the project needs it.

### Maintainers

| Name | GitHub |
|---|---|
| Amine Yagoub | [@AmineYagoub](https://github.com/AmineYagoub) |

## How decisions are made

- **What Detent does** is decided in its [PRD](detent-prd-v3.md) and the [implementation plan](docs/implementation-plan-v3.md); the PRD wins over every other document. Propose a change in an issue, and a maintainer decides and amends the PRD. Adding a command or a decision class is a major version (C-14′).
- **How code is written** is decided in [AGENTS.md](AGENTS.md) and [CONTRIBUTING.md](CONTRIBUTING.md). A change to either is a pull request that explains why.
- **Everything else** is settled in the issue or pull request where it comes up. Maintainers aim for agreement. When there is none, a maintainer decides and writes down why.

## Becoming a maintainer

Steady, careful contributions and reviews over several months, and good judgement in discussion, can lead to an invitation to triage and later to maintain. The maintainers decide together and add the new maintainer here and to CODEOWNERS. A maintainer who steps back is thanked and removed from both.

## Changing this document

By pull request, with a maintainer's approval.
