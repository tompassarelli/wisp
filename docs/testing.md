# Testing

`bun run test` runs the whole suite through
[testRunner](../scripts/wisp/testRunner.ts) (wisp:scripts/wisp/testRunner.ts).
A failure means the code is wrong, never that the machine was busy. The
tests need Lua 5.3 built with `LUA_32BITS` (`LUA=/path/to/lua32`; see the
[README](../README.md)).

## Correctness tests

Every ordinary `test` checks behavior, and none depends on how fast the
machine is. They count frames, steps and events instead of reading the
clock. Where a test waits on something real (a child process starting, a
file appearing), it waits for that thing. Its timeout only catches a hang:
the runner gives each test two minutes, about ten times the slowest test on
a quiet machine. They run first, under whatever load the machine has.

wisp:test/blank-lines.test.ts keeps TypeScript sources free of leading
blank lines and runs of blank lines outside strings. It skips test/stack/
and test/throw/, whose stack-trace tests pin their line numbers.

## Timing tests

A test that asserts speed, such as a duration, a frame rate or a perf
budget, is a timing test. Declare it with `timingTest` from
[timingTest](../scripts/wisp/timingTest.ts) (wisp:scripts/wisp/timingTest.ts)
instead of `test`:

```ts
import { timingTest } from "../scripts/wisp/timingTest";

timingTest("twelve unit state cases complete within two seconds", () => {
  const before = performance.now();
  play();
  expect(performance.now() - before).toBeLessThanOrEqual(2000);
});
```

Keep the behavior the timed code must produce in a plain `test`, so that a
busy machine can't hide a wrong result.

The runner skips timing tests among the correctness tests. Then it runs each
file that has timing tests on its own, inside an `exclusive` machine-capacity
lease that it takes itself, and samples `/proc/pressure/cpu` every half second.
Other agents' batch leases can keep an exclusive lease from being admitted for
a long time. After three minutes in the queue, the runner runs the timing tests
without the lease, and CPU pressure alone decides whether a failure counts.
If a timing test fails while CPU pressure (some avg10) was above
`BUSY_PRESSURE` (30%), it reports `inconclusive: machine busy (pressure N%)`
instead of failing. It then waits up to ten minutes for the pressure to drop
and runs the test again, up to three runs in total. A timing test that fails
while the machine is quiet fails the run.

The threshold comes from measurement on the 24-core development machine. Other
agents usually hold CPU pressure at 20–25%, and Wisp's timing tests passed at
every pressure measured, up to 77% under 48 extra busy loops. Their budgets
are 2.5 to 40 times their quiet-machine times. A timing test that fails at or
below 30% failed on an ordinarily loaded machine, so the failure counts.

Without the machine-capacity helper, as on CI, the timing tests run without a
lease, and pressure is still sampled. Inside another capacity lease they run
in that lease, because an exclusive lease would wait for the caller's own lease
to end.

A plain `bun test` still runs timing tests like any other test.

## Test cost

A test's cost is counted in deterministic quantities, never CPU seconds
([testCost](../scripts/wisp/testCost.ts), wisp:scripts/wisp/testCost.ts):

- Lua32 instructions its Lua children run, at most 280M per test (4 s at the
  reference runner's 70M per second). The runner preloads
  [testCostPreload](../scripts/wisp/testCostPreload.ts)
  (wisp:scripts/wisp/testCostPreload.ts), which points `LUA` and
  `TOWARD_ZERO_LUA` at wrappers that count instructions in millions with a
  count hook. A child that sets its own hook stops its count.
- Headless client frames it steps, at most 80,000 per test (about 4 s on a
  farm runner at the suite's heaviest frame rate).
- TypeScript compilation has no deterministic counter: GitHub's farm runners
  refuse `perf_event_open` (perf_event_paranoid 4), so compile-heavy tests
  are bounded only by the 60 s hang timeout (`TEST_TIMEOUT_MS` in
  wisp:scripts/wisp/testRunner.ts).

Time outside tests (loading, `beforeAll`) is charged to the file.

- A test over a ceiling fails:
  `test/x.test.ts: this test stepped 90000 headless frames, over the 80000-frame ceiling per test; shrink it or move it to the farm`.
- No file's cost is compared with a baseline, and CPU and wall-clock budgets
  are judged only in timing tests and exclusive-lease perf measurements
  (wisp#114, smashcraft#394).
- Every run prints the five heaviest tests by CPU, Lua32 instructions and
  frames, and the suite's CPU, test count and CPU per test, without gating CPU:

```
suite CPU: 14.7 s for 238 tests; 0.062 s per test (reported, not gated)
```

A test that would come near the ceiling, typically one that compiles a
fixture to 32-bit Lua, is a farm test: declare it with `farmTest` from
[farmTest](../scripts/wisp/farmTest.ts) (wisp:scripts/wisp/farmTest.ts)
instead of `test`. `bun run test` skips it; CI's farm-tests job and every
`bun wisp farm test` shard run it on each push, so it keeps its coverage.
The ceilings don't apply to it. Keep its cheap Bun-side twin in the suite.
Each farm shard runs the suite files with `bun run test`,
then its farm tests with `bun test --preload ./scripts/wisp/testCostPreload.ts`.
Farm tests keep their coverage outside the suite's ceiling.

## The last line

Every run ends with the machine's CPU pressure during the run:

```
CPU pressure during this run: average 12%, peak some avg10 31% (timing verdicts count as inconclusive above 30%)
```

The run exits 0 when everything passed and 1 on any failure. It exits 75 when
nothing failed but a timing test stayed inconclusive because the machine never
got quiet.

## In a consuming project

A game uses the same runner from its own root, for example
`"test": "bun node_modules/wisp/scripts/wisp/testRunner.ts"`, and marks its
timing tests with `timingTest` from `wisp/scripts/wisp/timingTest`. Arguments
pass through to `bun test`, so path filters also select timing files.

A project whose own runner spreads the correctness tests over several
processes sets `WISP_TEST_PHASE=correctness` and the hang-only
`--timeout` (`TEST_TIMEOUT_MS`) on them, then runs
`timingTests(timingTestFiles(root, filters), args, print)` from the same
module for the timing phase, and reports with `INCONCLUSIVE_EXIT`.
