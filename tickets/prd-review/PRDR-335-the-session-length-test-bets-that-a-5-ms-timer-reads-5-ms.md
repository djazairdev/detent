---
id: PRDR-335
title: "The test that an init session's ledger row records its length asserts at least the 5 ms its mock claim check waits, and the length it reads is two wall-clock `Date` readings. Node counts a timer's delay from libuv's loop time, floored to the millisecond, so a 5 ms timer can fire after 4.1 ms, and a span under 5 ms reads 4 on two floored `Date` readings. Since vitest 5 landed, `verify (22)` failed on it in 4 of its 6 runs on 2026-10-10, the 3.2.0 release pull request's among them. The test will give the pipeline a clock that only its sessions move, and assert each row's length exactly"
state: OPEN
severity: major
category: weak-test
labels: ["prd-review", "flaky-test", "N-5⁗", "ci", "clock", "ledger"]
surface: ["tests/init/estimate-notes.test.ts"]
prd_refs: ["N-5⁗"]
acceptance_criteria: ["The test gives `buildPipeline` a clock through `now` (PRDR-189's seam, which `sessionDeps` hands every init session) that only the sessions move, each by a length set for its task, and asserts each ledger row's `duration_ms` equal to that length: the survey's, the triage's and the claim check's.", "No assertion in the test reads the wall clock, so its outcome depends on no timer's granularity, machine speed or Node version.", "The test still fails where `src/init/session.ts` records no length or a length of 0, takes its length from the wall clock instead of its `now` seam, or times a session from anything but its own launch.", "Falsification, against HEAD: HEAD's test reads 4 where its check waits 5 ms, in CI on Node 22 and locally."]
non_goals: ["Does NOT change `src/`: a session's length is measured as N-5⁗ says, and the 3.2.0 release was walked on that code.", "Does NOT change the waits other tests use to hold sessions in flight (`tests/init/sessions-at-once.test.ts`, `tests/eval/review-fixture.ts`, `tests/eval/run.test.ts`): they count the sessions at once and assert no length.", "Does NOT time sessions on a monotonic clock (recorded, not fixed)."]
attempts: { fix: 0, hypothesis: 0, review: 0 }
links: ["PRDR-325", "PRDR-189"]
depends_on: ["PRDR-325"]
---

# PRDR-335 — the session-length test bets that a 5 ms timer reads 5 ms

## Where this came from

`verify (22)` failed four times on 2026-10-10, each time on `tests/init/estimate-notes.test.ts:136`
with `expected 4 to be greater than or equal to 5`. `verify (24)` passed in every one of those runs.

| CI run | Commit | What it checked | `verify (22)` | `verify (24)` |
|---|---|---|---|---|
| 38065359250 | `ed7f5e0` | pull request #21, which brought vitest 5 | passed | passed |
| 38065522980, attempt 1 | `7fb3d85` | pull request #22 | **failed** | passed |
| 38065562140 | `57756ad` | main, after #21 | **failed** | passed |
| 38065522980, attempt 2 | `7fb3d85` | pull request #22, run again | passed | passed |
| 38066193908 | `d816e6d` | main, after #22 | **failed** | passed |
| 38066323494 | `721a51a` | the 3.2.0 release pull request, #23 | **failed** | passed |

Every run that day before #21 passed on both. #21 moved vitest from 3.2.7 to 5.0.3. The release
checklist merges only on green, so 3.2.0 waits on this.

## Problem

- **The test bets on the wall clock.** PRDR-325's test asserts that the claim check's ledger row
  holds a `duration_ms` of at least 5, the 5 ms its mock check waits with `setTimeout`.
  `launchOnce` (`src/init/session.ts`) times a session as two readings of its clock around the
  backend's run, and that clock is the `now` seam, `new Date()` where none is given. The test gives
  none, so the length it checks is two wall-clock readings.
- **A 5 ms timer does not take 5 ms on that clock.** Node schedules a timer from libuv's loop
  time, which it refreshes before scheduling and which counts whole milliseconds: a timer set at
  100.9 ms is due at 105, 4.1 ms later. `Date` floors each reading to the millisecond too, so a
  session that takes 4.x ms reads 4 or 5, by where the wall clock's millisecond falls. When it
  reads 4, the row is right and the assertion fails.
- **Measured on this machine** (macOS, Node 22.23.2 and 24.21.0). Of 3,000 5 ms timers per run,
  81 to 112 fired in under 5 ms of real time, the soonest at 4.117 ms. Two `Date` readings around
  the timer, with only a small JSON round trip between them, read 4 in 2 of 3,000 on Node 22; with
  a file written after the timer as well, as the mock check writes its artifact, none did here. The
  timer is not set from a stale loop time: after 20 ms of synchronous work in one loop iteration, a
  5 ms timer still took at least 4.57 ms. The floor alone makes the shortfall.
- **It now holds every merge on Node 22.** Since vitest 5, `verify (22)` failed in 4 of its 6
  runs; before it, the test passed on every run. What in vitest 5 or Node 22 moved the odds is not
  established, and need not be: the assertion asked for a property no timer gives.

## Design

- **The test's own clock.** The test gives `buildPipeline` a `now` (PRDR-189's seam, which
  `sessionDeps` passes to every init session) that only the sessions move. Its backend moves the
  clock on by a length set for each task, 3 s for the survey, 1 s for the triage and 42 s for the
  claim check, then runs the session as before.
- **Each length exactly.** The test asserts each row's task and `duration_ms` as pairs: the
  survey's 3,000, the triage's 1,000 and the check's 42,000. The lengths are then the code's doing
  alone. No timer, machine or Node version enters them, and three different lengths show that each
  row holds its own session's.
- **Tests only.** The mock's 5 ms wait stays, since the file's other tests hold checks in flight
  with it; nothing measures it now. No `src/` file changes.

### Vetoable calls

1. **An exact clock, not a looser bound.** `>= 4`, or `> 0`, would still read the wall clock, and
   would pass a length taken from the wrong clock or from the wrong start.
2. **Every session's length, not only the check's.** The rows' tasks were asserted already.
   Pairing each with its length costs one assertion and fails where a length is timed from anything
   but its own launch.
3. **Lengths of seconds, from a fixed instant.** Nothing in the three phases reads the clock but
   the sessions' timing and the progress record's `began`, which this test does not read.

## Falsification (verification protocol, item 1)

HEAD is `d816e6d`. CI ran HEAD's test there and on its parents. Run 38065562140 (main at
`57756ad`) printed what the other three print:

```
 FAIL  tests/init/estimate-notes.test.ts > N-5⁗ AUDIT says what its checks will cost before the first one starts > records each init session's task, routed effort and length on its ledger row
AssertionError: expected 4 to be greater than or equal to 5
 ❯ tests/init/estimate-notes.test.ts:136:36
 Test Files  1 failed | 227 passed (228)
```

Locally, HEAD's test body ran 300 times in one vitest process, from a scratch copy removed
afterwards and never committed. The claim check row's `duration_ms`:

| Node | 4 | 5 | 6 | 7 | 8 or more |
|---|---:|---:|---:|---:|---:|
| 24.21.0 | 4 | 28 | 220 | 42 | 6 |
| 22.23.2 | 0 | 31 | 145 | 80 | 44 |

On Node 24, 4 of the 300 read 4, where HEAD's assertion fails. On Node 22, a tenth sat on its line.
