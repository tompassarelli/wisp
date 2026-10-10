import { test } from "bun:test";

export const TIMING_TEST_PREFIX = "timing: ";

export const TEST_PHASE_ENV = "WISP_TEST_PHASE";

export function timingTest(name: string, body: () => unknown, timeoutMs?: number): void {
  const run = process.env[TEST_PHASE_ENV] === "correctness" ? test.skip : test;
  run(`${TIMING_TEST_PREFIX}${name}`, body as () => void, timeoutMs);
}
