// The farm-test marker (wisp:docs/testing.md "Test cost"). A test whose CPU
// would come near the per-test ceiling (wisp:scripts/wisp/testCost.ts) keeps
// its coverage on the farm: CI's farm-tests job and every farm shard run it on
// each push, while `bun run test` skips it among the correctness tests and the
// ceiling does not apply to it. A plain `bun test` runs it like any other test.
import { test } from "bun:test";
import { TEST_PHASE_ENV } from "./timingTest";

/** Names CI selects farm tests by (`bun test -t`). */
export const FARM_TEST_PREFIX = "farm: ";
/** Set while a farm test runs, so wisp:scripts/wisp/testCostPreload.ts exempts it from the ceiling. */
export const FARM_TEST_RUNNING = "wispFarmTestRunning";

type Body = () => unknown;

/** A test too heavy for the suite's per-test ceiling; same arguments as `test`. */
export function farmTest(name: string, ...rest: [Body, number?] | [{ timeout?: number }, Body]): void {
  const run = process.env[TEST_PHASE_ENV] === "correctness" ? test.skip : test;
  const mark = (body: Body) => () => {
    (globalThis as Record<string, unknown>)[FARM_TEST_RUNNING] = true;
    return body();
  };
  const [body, timeout] = typeof rest[0] === "function" ? [rest[0], rest[1] as number | undefined] : [rest[1] as Body, rest[0].timeout];
  run(`${FARM_TEST_PREFIX}${name}`, mark(body) as () => void, timeout);
}
