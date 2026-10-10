import { test } from "bun:test";
import { TEST_PHASE_ENV } from "./timingTest";

export const FARM_TEST_PREFIX = "farm: ";

export const FARM_TEST_RUNNING = "wispFarmTestRunning";

type Body = () => unknown;

export function farmTest(name: string, ...rest: [Body, number?] | [{ timeout?: number }, Body]): void {
  const run = process.env[TEST_PHASE_ENV] === "correctness" ? test.skip : test;
  const mark = (body: Body) => () => {
    (globalThis as Record<string, unknown>)[FARM_TEST_RUNNING] = true;
    return body();
  };
  const [body, timeout] = typeof rest[0] === "function" ? [rest[0], rest[1] as number | undefined] : [rest[1] as Body, rest[0].timeout];
  run(`${FARM_TEST_PREFIX}${name}`, mark(body) as () => void, timeout);
}
