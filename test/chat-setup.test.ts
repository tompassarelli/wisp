import { expect, test } from "bun:test";
import { Effect, Exit, Fiber } from "effect";
import { TestClock } from "effect/testing";
import { confirmedCommand, openObservedChat, type ChatEntry } from "../scripts/wisp/chatSetup";

test("[spec docs/watch.md] two missed Returns end at chat entry before command text or input execution", async () => {
  let text = false, input = false, returns = 0;
  const entry: ChatEntry = { available: true, open: false, modified: 1 };
  const run = Effect.gen(function*() {
    yield* openObservedChat({ name: "lan2a" }, Effect.sync(() => entry), Effect.sync(() => { returns++; }));
    text = true;
    input = true;
  });
  const result = await Effect.runPromise(Effect.gen(function*() {
    const fiber = yield* Effect.forkChild(run, { startImmediately: true });
    yield* TestClock.adjust("18 seconds");
    return yield* Fiber.await(fiber);
  }).pipe(Effect.provide(TestClock.layer())));
  expect(Exit.isFailure(result)).toBe(true);
  expect(String(result._tag === "Failure" && result.cause)).toContain("new chat entry after Return");
  expect(String(result._tag === "Failure" && result.cause)).toContain("lan2a");
  expect(text).toBe(false);
  expect(input).toBe(false);
  expect(returns).toBe(2);
});

test("[spec docs/watch.md] input starts only after both new requested receipts; a stale or wrong receipt cannot release it", async () => {
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
