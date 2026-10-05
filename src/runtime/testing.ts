// Test registry shared by Bun and Lua: tests register here, and each runtime's
// runner executes the registry. No host APIs, so it compiles to Lua unchanged.

export type TestCase = { name: string; run: () => void };
export const registeredTests: TestCase[] = [];

export function test(name: string, run: () => void): void {
  registeredTests.push({ name, run });
}

export class AssertionFailure {
  constructor(public readonly message: string) {}
}

function fail(message: string): never {
  throw new AssertionFailure(message);
}

export function assertTrue(value: boolean): void {
  if (value !== true) fail("expected true");
}

export function assertFalse(value: boolean): void {
  if (value !== false) fail("expected false");
}

/** Exact equality (Object.is semantics except that 0 equals -0). */
export function assertEquals<T>(actual: T, expected: T, message?: string): void {
  if (actual !== expected) fail(`${message === undefined ? "" : `${message}: `}expected ${String(expected)}, actual ${String(actual)}`);
}

export function assertNear(actual: number, expected: number, delta: number): void {
  if (Math.abs(actual - expected) > delta) fail(`expected ${expected} within ${delta}, actual ${actual}`);
}

export function assertGreaterThan(actual: number, bound: number): void {
  if (!(actual > bound)) fail(`expected more than ${bound}, actual ${actual}`);
}

export function assertLessThan(actual: number, bound: number): void {
  if (!(actual < bound)) fail(`expected less than ${bound}, actual ${actual}`);
}

/** The value, or a failure when it is undefined. */
export function assertDefined<T>(value: T | undefined, what = "value"): T {
  if (value === undefined) fail(`expected ${what} to be defined`);
  return value;
}
