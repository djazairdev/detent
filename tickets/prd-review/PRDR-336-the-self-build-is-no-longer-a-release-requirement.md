---
id: PRDR-336
title: "The self-build is no longer a release requirement. N-7 made `detent init && detent run` on a folder holding only the PRD a gate on every version bump and every S-5 backend upgrade, and D-16 made the gate permanent. On 2026-10-10 the maintainer waived it for 3.2.0 and then retired it. The PRD records N-7″ and D-16′. The release checklist keeps item 5's number but no longer asks for a run. Every doc, doc-block and test that states the gate is updated to say what holds now"
state: DONE
severity: major
category: decision
labels: ["prd-review", "release", "N-7", "D-16", "user-decision", "N-6", "docs"]
surface: ["detent-prd-v3.md", "docs/release-checklist.md", "README.md", "docs/using-detent.md", "docs/implementation-plan-v3.md", ".github/workflows/release.yml", ".github/workflows/self-build.yml", "scripts/self-build.ts", "src/init/config.ts", "src/schemas/records.ts", "src/sessions/live.ts", "tests/plugin/release.test.ts", "tests/docs/prd-specification-phase.test.ts", "tests/cli/init-symbols.test.ts", "tests/cli/doctor.test.ts", "tests/oracle/pin-parity.test.ts"]
prd_refs: ["N-7", "N-7′", "D-16", "N-6", "S-5", "S-3⁗", "C-14′", "§13", "§14"]
acceptance_criteria: ["The PRD defines N-7″ once. The self-build is not a release requirement, so a version bump or an S-5 backend upgrade does not wait for it. The harness and the `self-build` workflow stay, for a maintainer to run by hand.", "The PRD defines D-16′ once: D-16 is withdrawn. The decision log's opening lines say so.", "Every v3 passage that states the gate points forward to N-7″ or D-16′: N-7′, S-3⁗, §13's MP4, and the inheritance line for §12 and §14. The Status line cites no checklist item.", "The release checklist asks for no self-build. Item 5 keeps its number and says the self-build was retired by N-7″ and D-16′, so references to items 6 to 8 stay valid. The checklist's title and introduction no longer name N-7 or D-16 as gates.", "The README has no N-7 badge and no claim that the self-build is a release requirement. It says instead what Detent's own changes and releases must pass. `docs/using-detent.md` no longer calls the greenfield path the permanent release gate.", "No workflow comment, script doc-block, src doc-block or test doc-block states the self-build as a release gate, or as the step that vets an agent SDK upgrade. Those that argued from it, for the advisory `agent_sdk` pin (PRDR-254), say what vets an upgrade now.", "Tests pin each of the above and fail on HEAD."]
non_goals: ["Does NOT delete the self-build harness (`scripts/self-build.ts`) or the `self-build` workflow.", "Does NOT change a code path. `detent doctor`'s advisory text and `detent report`'s `self_build_gate` metric are PRDR-337's.", "Does NOT rewrite history. Closed tickets, the dated plans, the v2 PRD and the measurements taken on the gate keep what they say. v3 records the amendment, as it does for every inherited rule.", "Does NOT add a live check in the self-build's place."]
attempts: { fix: 0, hypothesis: 0, review: 0 }
links: ["PRDR-337", "PRDR-254", "PRDR-278", "PRDR-208"]
depends_on: []
---

# PRDR-336 — the self-build is no longer a release requirement

## Where this came from

On 2026-10-10 the maintainer released 3.2.0 without the self-build. They waived the gate for that
release, and the PRD's Status line and the release notes say so. Later the same day they asked to
"remove N-7 as a requirement". This ticket records that decision in the PRD, as N-6 requires, and
brings every document that states the gate in line with it.

The last self-build that certified a release ran for 3.1.0. It finished 67 of 67 tickets DONE and
cost $598.36 across 303 sessions (`docs/implementation-plan-v3.md`, 3.0-16).

## Problem

- **The PRD makes the self-build a gate.** v2's N-7, which v3 inherits with §12, calls it "a
  release gate: every version bump and every pinned-backend upgrade (S-5) must pass it before
  publish". D-16 makes it "a permanent release gate". v3's §13 repeats "the permanent gate, D-16".
  N-7′ gives release-checklist item 5 the job of recording its duration and spend, and S-3⁗
  reasons from "the self-build gate (D-16)".
- **The checklist enforces it.** Item 5 is "N-7 self-build green (D-16) — the permanent gate", and
  it ends "No green, no release". The checklist's title cites D-16. Its introduction names the N-7
  gate as one of the two items the file exists to make unskippable.
- **The docs announce it.**
  - The README carries an "N-7 self-build" badge that links to the checklist, and says the gate
    "is a permanent release requirement, not a demo".
  - `docs/using-detent.md` calls the greenfield path "the permanent release gate".
  - `release.yml` cites "no green, no release" (T-142).
  - `self-build.yml` opens "the N-7 self-build release gate (D-16)".
- **Code comments argue from it.**
  - `scripts/self-build.ts` says "the permanent gate carries the tooling the runner has".
  - `src/sessions/live.ts`, `tests/oracle/pin-parity.test.ts` and `tests/cli/doctor.test.ts` rest
    the advisory `agent_sdk` pin (PRDR-254) on item 5 "putting every SDK bump through the N-7
    self-build before it ships".
  - `src/init/config.ts` and `tests/cli/init-symbols.test.ts` name "the self-build gate", and
    `src/sessions/live.ts` and `src/schemas/records.ts` call it the release gate.
- **Tests pin it.** `tests/plugin/release.test.ts` asserts:
  - that the checklist names N-7 and D-16 and says "No green, no release";
  - that the README states the self-build as a permanent release requirement.

  `tests/docs/prd-specification-phase.test.ts` reads N-7's duration and spend from item 5.

## Design

- **The PRD, by amendment, never by rewrite.** Two dated bullets follow N-7′ in §4:
  - **N-7″** says the self-build is not a release requirement, that nothing waits for it, and that
    the harness and the workflow stay for a maintainer to run by hand. It also retires §14's N-7
    row.
  - **D-16′** withdraws D-16.

  Every v3 passage that states the old rule gets a pointer at its end, as PRDR-318's do: N-7′,
  S-3⁗, §13's MP4, the inheritance line for §12 and §14, and the decision log's opening lines. The
  Status line stops citing item 5.
- **The checklist keeps its numbering.** Item 5 becomes a short retired entry. Items 6 to 8 keep
  their numbers, because code, tests, the PRD and the 3.2.0 release notes cite them:
  `src/schemas/pack.ts` and `tests/init/pack.test.ts` cite item 8. The title drops D-16, and the
  introduction names the porcelain freeze alone.
- **The docs say what holds.** The README badge goes. In its place, the paragraph says what holds:
  every change to Detent lands through a pull request whose seven checks run on Node 22 and 24,
  and every release walks the checklist. `docs/using-detent.md`, the workflow comments, and the
  script and src doc-blocks name the self-build without calling it a gate.
- **The SDK-pin argument is restated, not dropped.** `agent_sdk` still cannot move unless Detent
  moves. A Detent release still walks the checklist with the new SDK in its lockfile, and gating
  the pin would still refuse every project initialised before an upgrade. What changes is that no
  release step drives a live session through the SDK's bundled runtime any more. The doc-blocks
  say so.
- **Tests read the new rule.**
  - `tests/plugin/release.test.ts`: the T-141 and T-142 blocks assert what holds now, and a
    PRDR-336 block pins the amendment.
  - `tests/docs/prd-specification-phase.test.ts`: the N-7′ case reads N-7′'s pointer instead of
    item 5.

## Vetoable calls

1. **The harness and the workflow stay.** Retiring the requirement does not delete the tool.
   `self-build.yml` is dispatch-only and spends nothing unless someone runs it.
2. **Item 5 keeps its number** as a retired entry, rather than the list being renumbered, so that
   every citation of items 6 to 8 stays true.
3. **The README badge goes.** It linked the gate to the checklist, and a badge for a workflow run
   by hand shows a stale result.
4. **The code is PRDR-337's, in its own pull request.** This one changes no behaviour and cuts no
   release. `detent doctor` says the shipping release "passed the N-7 gate", and `detent report`
   carries a `self_build_gate` metric. Both stay until PRDR-337 lands, and N-7″ says so.
5. **No live check replaces the self-build.** Choosing one is the maintainer's call. This ticket
   records the gap rather than closing it.
6. **History keeps its text.** Closed tickets, the dated plans, the v2 PRD and the measurements
   "on the first self-build gate" describe what was true when they were written.

## What changed

- **`detent-prd-v3.md`.**
  - Two dated bullets follow N-7′ in §4. **N-7″** says the self-build is not a release
    requirement, that nothing waits for it, and that item 5 is retired with its number kept. It
    says the harness and the `self-build` workflow stay for a maintainer to run, retires §14's
    N-7 row, and names what stays until PRDR-337. **D-16′** withdraws D-16.
  - Forward pointers sit at the end of N-7′, S-3⁗ and §13's MP4. The inheritance line names N-7″
    for §12 and §14, and the decision log's opening lines name D-16′.
  - The Status line says the gate was retired, and no longer cites item 5.
- **`docs/release-checklist.md`.**
  - Item 5 is "Retired: the N-7 self-build". It says when the self-build was retired and by what,
    why the number stays, and that the workflow still runs it by hand.
  - The title drops D-16, and the introduction names the porcelain freeze alone.
  - Item 8 says the 3.1.1 line shipped as 3.2.0.
- **`README.md`.** The N-7 badge is gone. The paragraph now says that every change to Detent
  lands through a pull request that must pass its seven checks on Node 22 and 24, and that every
  release walks the checklist.
- **`docs/using-detent.md`.** The greenfield path is the one the self-build takes. It is no
  longer called the permanent release gate.
- **`docs/implementation-plan-v3.md`.** MP4 carries the retirement. The §5 changelog gains
  3.0-35: 3.2.0, the retirement, and where the record has been kept since 3.0-34.
- **Comments.**
  - `release.yml` and `self-build.yml`.
  - `scripts/self-build.ts`: its header, and S-3⁗'s note.
  - `src/init/config.ts`, `src/schemas/records.ts` and `src/sessions/live.ts`: the builder's note,
    and the SDK pin's argument.
  - `tests/cli/init-symbols.test.ts`, `tests/cli/doctor.test.ts` and
    `tests/oracle/pin-parity.test.ts`.

  The SDK pin's argument now says that a release walks the checklist with the new SDK in its
  lockfile, and that the vetting this gives is the checklist's gates, not a live session.
- **Tests.**
  - `tests/plugin/release.test.ts`:
    - T-142 asserts the checklist's items and that the release pull request merges only on green.
    - T-141 asserts the README's new statement.
    - A PRDR-336 block pins the amendment, the forward pointers, the retired item 5 with items 6
      to 8 keeping their numbers, the README and the guide, and nine phrases absent from the nine
      files they stood in.
  - `tests/docs/prd-specification-phase.test.ts`: the N-7′ case reads N-7′'s pointer and a
    retired item 5.

## Falsification

Against HEAD `29fd0b5`, before any edit, the new and changed cases ran on the old text:

    tests/docs/prd-specification-phase.test.ts  × N-7 keeps the raw PRD … no checklist item waits for it since N-7″
    tests/plugin/release.test.ts                × says what Detent's own changes and releases pass
                                                × the PRD defines N-7″ and D-16′ once each
                                                × every v3 passage that stated the gate points forward
                                                × the checklist asks for no self-build, and item 5 keeps its number, retired
                                                × the README and the guide state no release gate
                                                × no comment that stated the gate states it still
    Test Files  2 failed (2)
         Tests  7 failed | 38 passed (45)

All seven passed after the change, together with `tests/docs/prd-requirement-ids.test.ts`: 3
files, 58 tests.

## Mutation battery

Each mutant was applied to a snapshot copy of its file. The three docs tests were run, and the file
was restored from the copy and checked with `cmp`.

| Mutant | Result |
|---|---|
| M1 the README regains the N-7 badge | killed: the README and the guide |
| M2 N-7′ loses its pointer | killed: the N-7′ case and the pointers case |
| M3 N-7″ is defined twice | killed: `prd-requirement-ids.test.ts` and the definitions case |
| M4 item 5 asks for the run again | killed: the checklist case |
| M5 the list is renumbered and item 5 deleted | killed: the checklist case and the N-7′ case |
| M6 `release.yml` says "no green, no release" again | killed: the comments case |
| M7 `live.ts` rests the pin on item 5 again | killed: the comments case |
| M8 the Status line cites item 5 again | killed: the pointers case |
| M9 a blank line detaches S-3⁗'s pointer | killed: the pointers case |
| M10 D-16′ is deleted | killed: the definitions case |

## Gates

- `npm run lint`, `typecheck`, `parity:check`, `prompts:check`, `rules:check` and
  `tickets:check`: pass, on Node 22.23.2.
- `npm run plugin`: it rewrote nothing. The src edits are doc-blocks, and the hook bundle carries
  none.
- `npm test`, once, on Node 22.23.2: 228 files, 2,544 passed and 2 skipped (2,546). That is the
  five PRDR-336 cases more than before.

## Recorded, not fixed

- **No release step drives a live session through the agent SDK any more.** The self-build was the
  only one. It ran `detent init && detent run` on the runtime the SDK bundles, so an SDK upgrade
  was proven live before it shipped. The checklist's other live step, SEC-6, runs the `claude` on
  PATH, not the runtime the SDK bundles. An SDK bump is now vetted by the gates alone, and the
  sessions those gates run are mock sessions. If the maintainer wants a live check back, a cheap
  one is `detent doctor --smoke` from a configured project, as part of item 6 or item 7. It runs
  one smoke session through the live backend, so it spends a little. That choice is theirs.
- **The 3.2.0 release notes cite items 5 to 8 by number.** Keeping the numbering keeps them true.
- **The code still states the gate**, until PRDR-337 lands: `detent doctor`'s advisory and
  `detent report`'s `self_build_gate`.
