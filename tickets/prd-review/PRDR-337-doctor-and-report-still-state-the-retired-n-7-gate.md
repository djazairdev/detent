---
id: PRDR-337
title: "`detent doctor` says the shipping release passed the N-7 gate, and `detent report` carries a `self_build_gate` metric that has read `not-yet-run` since it was written. Neither holds now that N-7″ retired the gate (PRDR-336), and doctor's claim was already false for 3.2.0. Doctor will say only what is true of the SDK a release ships, and report will drop the metric, since N-7″ retires §14's N-7 row"
state: OPEN
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
