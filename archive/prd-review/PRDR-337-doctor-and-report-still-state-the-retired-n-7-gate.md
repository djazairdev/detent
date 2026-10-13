---
id: PRDR-337
title: "`detent doctor` says the shipping release passed the N-7 gate, and `detent report` carries a `self_build_gate` metric that has read `not-yet-run` since it was written. Neither holds now that N-7″ retired the gate (PRDR-336), and doctor's claim was already false for 3.2.0. Doctor will say only what is true of the SDK a release ships, and report will drop the metric, since N-7″ retires §14's N-7 row"
state: DONE
severity: minor
category: correctness
labels: ["prd-review", "N-7″", "doctor", "report", "S-5", "§14"]
surface: ["src/cli/doctor.ts", "src/cli/report.ts", "tests/cli/doctor.test.ts", "tests/cli/report.test.ts", "detent-prd-v3.md"]
prd_refs: ["N-7″", "D-16′", "S-5", "C-12", "§14"]
acceptance_criteria: ["`detent doctor`'s `agent-sdk-pin` advisory names no N-7 gate, and does not claim the shipping release passed one. It still says that the lockfile pins the SDK exactly, that nothing refuses on the mismatch, and what to set once the project has been re-verified.", "`detent report` no longer reports `self_build_gate`. Its seven other metrics are unchanged.", "N-7″ records that PRDR-337 built this."]
non_goals: ["Does NOT make the `agent_sdk` pin refuse anything (PRDR-254 stands).", "Does NOT add a live SDK check."]
attempts: { fix: 0, hypothesis: 0, review: 0 }
links: ["PRDR-336", "PRDR-254", "PRDR-042"]
depends_on: ["PRDR-336"]
---

# PRDR-337 — doctor and report still state the retired N-7 gate

## Problem

- **`detent doctor`** (`src/cli/doctor.ts`, the `agent-sdk-pin` check) prints this advisory when a
  project's `pinned.agent_sdk` differs from the SDK this Detent ships: "the lockfile pins the SDK
  exactly and the release shipping ${installed} passed the N-7 gate, so nothing refuses on this".
  3.2.0 shipped without a self-build, so its doctor makes a false claim. Once N-7″ lands, no
  release will pass that gate.
- **`detent report`** (`src/cli/report.ts`) returns `self_build_gate: { value: "not-yet-run",
  detail: "N-7 first green lands at M3; a release gate thereafter" }` for every project. It has
  never read anything but `not-yet-run`, and N-7″ retires the §14 row it stood for.

## Design

- Doctor's advisory keeps its facts and drops the claim. The lockfile pins the SDK exactly, so
  this Detent always runs the SDK it ships, and nothing refuses on the mismatch. Set the pin once
  the project has been re-verified against that SDK.
- Report drops the metric. Its seven other metrics, and their order, are unchanged.

## What changed

- **`src/cli/doctor.ts`.** The `agent-sdk-pin` advisory says: the lockfile pins the SDK exactly, so
  this Detent always runs `<installed>`, and nothing refuses on this; set `pinned.agent_sdk` to
  `<installed>` once you have re-verified this project against it. The claim that the release
  "passed the N-7 gate" is gone.
- **`src/cli/report.ts`.** `self_build_gate` leaves `METRIC_KEYS` and the report, leaving seven
  metrics. The doc-block says why.
- **`detent-prd-v3.md`.** N-7″ records that PRDR-337 built this.
- **Tests.**
  - `tests/cli/doctor.test.ts`: the advisory claims no gate and keeps its facts.
  - `tests/cli/report.test.ts`: the §14 enumeration skips the rows a v3 rule retires (N-7″ retires
    the self-build row; v2's table stays frozen), and checks that the retiring rule says so. The
    mixed run asserts the metric is gone.

## Falsification

Against `6e07422`, the three new or changed cases failed on the old code:

    tests/cli/doctor.test.ts   × and claims no gate the release did not pass
    tests/cli/report.test.ts   × the reporter has exactly one key per §14 row a v3 rule has not retired
                               × a mixed run produces every metric, with honest n/a where the denominator is empty
    Test Files  2 failed (2)
         Tests  3 failed | 30 passed (33)

The fourth new case checks that the retiring rule says so. It passed before the fix, because
PRDR-336 wrote N-7″. It is a guard, and M4 below shows it bites.

## Mutation battery

Each mutant was applied to a snapshot copy of its file. The report, doctor and release tests were
run, and the file was restored from the copy and checked with `cmp`.

| Mutant | Result |
|---|---|
| M1 doctor says the release passed the N-7 gate again | killed: the doctor case |
| M2 report regains `self_build_gate` | killed: the enumeration and the mixed run |
| M3 report drops another metric and keeps `self_build_gate` | killed: the mixed run and the resume case |
| M4 N-7″ stops retiring §14's row | killed: the retired-row case |
| M5 doctor drops the remedy | killed: the doctor case |
| M6 doctor drops the lockfile fact | killed: the doctor case |
| M7 doctor names the self-build | killed: the doctor case |

## Gates

- `npm run lint`, `typecheck`, `parity:check`, `prompts:check`, `rules:check` and
  `tickets:check`: pass, on Node 22.23.2.
- `npm run plugin`: it rewrote nothing.
- `npm test`, once, on Node 22.23.2: 228 files, 2,546 passed and 2 skipped (2,548). That is the two
  new cases more than PRDR-336.
