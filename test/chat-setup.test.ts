import { expect, test } from "bun:test";
import { Effect, Exit, Fiber } from "effect";
import { TestClock } from "effect/testing";
import { confirmedCommand, openObservedChat, type ChatEntry } from "../scripts/wisp/chatSetup";

test("a missed Return ends at chat entry before command text or input execution", async () => {
  let text = false, input = false;
  const entry: ChatEntry = { available: true, open: false, modified: 1 };
  const run = Effect.gen(function*() {
    yield* openObservedChat({ name: "lan2a" }, Effect.sync(() => entry), Effect.void);
    text = true;
    input = true;
  });
  const result = await Effect.runPromise(Effect.gen(function*() {
    const fiber = yield* Effect.forkChild(run, { startImmediately: true });
    yield* TestClock.adjust("9 seconds");
    return yield* Fiber.await(fiber);
  }).pipe(Effect.provide(TestClock.layer())));
  expect(Exit.isFailure(result)).toBe(true);
  expect(String(result._tag === "Failure" && result.cause)).toContain("new chat entry after Return");
  expect(String(result._tag === "Failure" && result.cause)).toContain("lan2a");
  expect(text).toBe(false);
  expect(input).toBe(false);
});

test("old open receipt is closed by Return and only a fresh open transition permits typing", async () => {
  let entry: ChatEntry = { available: true, open: true, modified: 1 };
  let returns = 0;
  await Effect.runPromise(openObservedChat({ name: "a" }, Effect.sync(() => entry), Effect.sync(() => {
    returns++;
    entry = { ...entry, open: returns === 2, modified: entry.modified + 1 };
  })));
  expect(returns).toBe(2);
});

test("input starts only after both new requested receipts; a stale or wrong receipt cannot release it", async () => {
  let a = { revision: 1, command: "old" }, b = a;
  let input = false;
  const target = (name: string, read: () => typeof a) => ({ client: { name }, read: Effect.sync(read), requested: (current: typeof a, before: typeof a | undefined) => current.revision > (before?.revision ?? 0) && current.command === "quick archer" });
  await Effect.runPromise(Effect.gen(function*() {
    const fiber = yield* Effect.forkChild(confirmedCommand("quick archer", [target("a", () => a), target("b", () => b)], Effect.sync(() => { a = { revision: 2, command: "quick archer" }; })).pipe(Effect.tap(() => Effect.sync(() => { input = true; }))), { startImmediately: true });
    yield* TestClock.adjust("1 second");
    expect(input).toBe(false);
    b = { revision: 2, command: "wrong" };
    yield* TestClock.adjust("1 second");
    expect(input).toBe(false);
    b = a;
    yield* TestClock.adjust("100 millis");
    yield* Fiber.join(fiber);
  }).pipe(Effect.provide(TestClock.layer())));
  expect(input).toBe(true);
});

test("missing requested map receipt ends setup with selected client and no input", async () => {
  let input = false;
  const result = await Effect.runPromise(Effect.gen(function*() {
    const fiber = yield* Effect.forkChild(confirmedCommand("quick", [{ client: { name: "lan2b" }, read: Effect.succeed(undefined), requested: () => true }], Effect.void).pipe(Effect.tap(() => Effect.sync(() => { input = true; }))), { startImmediately: true });
    yield* TestClock.adjust("9 seconds");
    return yield* Fiber.await(fiber);
  }).pipe(Effect.provide(TestClock.layer())));
  expect(Exit.isFailure(result)).toBe(true);
  expect(String(result._tag === "Failure" && result.cause)).toContain("quick map receipt");
  expect(String(result._tag === "Failure" && result.cause)).toContain("lan2b");
  expect(input).toBe(false);
});
