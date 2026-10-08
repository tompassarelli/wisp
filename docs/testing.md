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
