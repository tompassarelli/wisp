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

One test may use at most 4 s of CPU (`TEST_CEILING_S` in
[testCost](../scripts/wisp/testCost.ts), wisp:scripts/wisp/testCost.ts):
its process's user plus system time, plus the Lua32, compiler and other
children it waited for. The runner preloads
[testCostPreload](../scripts/wisp/testCostPreload.ts)
(wisp:scripts/wisp/testCostPreload.ts), which charges each test's CPU to its
file. Time outside tests (loading, `beforeAll`) is charged to the file too.

- A test over the ceiling fails:
  `test/x.test.ts: this test used 5.02 s CPU, over the 4 s ceiling per test; shrink it or move it to the farm`.
- On a whole run (no path or `-t` filter), a file whose CPU per test rises
  more than 25%, and more than 1 s, over its row in `test/cost-baseline.tsv`
  at the same test count fails the same way, naming the file. Rows are
  scaled by the run's median ratio to the baseline, so a slower machine
  compares fairly.
- A new file, or a file whose test count changed, passes under the ceiling
  and rewrites its row: commit the row with the tests.
  `TEST_COST_UPDATE=1 bun run test` rewrites every row, after a cut.
- CPU cost failures count at any CPU pressure; waiting for a CPU adds wall time, not CPU time.
- CI shards set `WISP_TEST_COST_SHARD=1` to compare their selected files with the same baseline and print the same totals.
- Every run prints the five heaviest tests and the suite's CPU, test count
  and CPU per test against the baseline:

```
suite CPU: 30.8 s for 261 tests; 0.118 s per test against the baseline's 0.120 s (-2%), this machine at 1.00x the reference
```

A test that would come near the ceiling, typically one that compiles a
fixture to 32-bit Lua, is a farm test: declare it with `farmTest` from
[farmTest](../scripts/wisp/farmTest.ts) (wisp:scripts/wisp/farmTest.ts)
instead of `test`. `bun run test` skips it; CI's farm-tests job and every
`bun wisp farm test` shard run it on each push, so it keeps its coverage.
The ceiling doesn't apply to it. Keep its cheap Bun-side twin in the suite.
Each farm shard runs the suite files with `WISP_TEST_COST_SHARD=1 bun run test`,
then its farm tests with `bun test --preload ./scripts/wisp/testCostPreload.ts`.
Farm tests keep their coverage without changing the suite baseline.

## The last line

Every run ends with the machine's CPU pressure during the run:

```
CPU pressure during this run: average 12%, peak some avg10 31% (timing tests count as inconclusive above 30%)
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
