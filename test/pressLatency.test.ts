import { expect, test } from "bun:test";
import { Effect, Fiber } from "effect";
import { Reader } from "../host/play/xtest";

test("the X reader hands consecutive reads consecutive bytes when one chunk answers both", async () => {
  const reader = new Reader();
  const reads = Effect.runFork(Effect.gen(function*() {
    const head = yield* reader.take(2);
    const rest = yield* reader.take(2);
    return [...head, ...rest];
  }));
  reader.push(Uint8Array.of(1, 2, 3, 4));
  expect(await Effect.runPromise(Fiber.join(reads))).toEqual([1, 2, 3, 4]);
});
