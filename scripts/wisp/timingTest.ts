// The timing-test marker (wisp:docs/testing.md). A timing test asserts speed:
// a duration, a frame rate, a perf budget. `bun run test` (wisp:scripts/wisp/testRunner.ts)
// skips these among the correctness tests, then runs them alone inside an
// exclusive machine-capacity lease while sampling CPU pressure; a busy
// machine makes the result inconclusive and the test runs again, rather
// than failing. A plain `bun test` runs them like any other test.
import { test } from "bun:test";

/** Names the runner selects timing tests by (`bun test -t`). */
export const TIMING_TEST_PREFIX = "timing: ";
/** The runner's phase: "correctness" skips timing tests, "timing" runs them. */
export const TEST_PHASE_ENV = "WISP_TEST_PHASE";

/** A test that asserts speed. Everything a test checks about behavior belongs in a plain test. */
export function timingTest(name: string, body: () => unknown, timeoutMs?: number): void {
  const run = process.env[TEST_PHASE_ENV] === "correctness" ? test.skip : test;
  run(`${TIMING_TEST_PREFIX}${name}`, body as () => void, timeoutMs);
}
