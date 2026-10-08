import { Effect, Fiber } from "effect";
import { TestClock } from "effect/testing";
import { expect, test } from "bun:test";
import { startPairClients, waitForFirstClient } from "../scripts/wisp/lan/startup";

const run = <A, E>(effect: Effect.Effect<A, E>) => Effect.runPromise(effect);

test("a peer starts only after the first client's locate check finishes", async () => {
  const events: string[] = [];
  let release: (() => void) | undefined;
  const pending = new Promise<void>((resolve) => { release = resolve; });
  const started = run(startPairClients(["a", "b"], (client) => Effect.sync(() => { events.push(`start ${client}`); }), (client) => Effect.gen(function*() {
    events.push(`locate ${client}`);
    yield* Effect.promise(() => pending);
    events.push("locate passed");
  })));
  await Bun.sleep(0);
  expect(events).toEqual(["start a", "locate a"]);
  release?.();
  await started;
  expect(events).toEqual(["start a", "locate a", "locate passed", "start b"]);
});

test("a failed locate never starts the peer", async () => {
  const clients: string[] = [];
  await expect(run(startPairClients(["a", "b"], (client) => Effect.sync(() => { clients.push(client); }), () => Effect.fail(new Error("no presence table"))))).rejects.toThrow("no presence table");
  expect(clients).toEqual(["a"]);
});

test("ordinary pool startup still starts both clients without a locate check", async () => {
  const clients: string[] = [];
  await run(startPairClients(["a", "b"], (client) => Effect.sync(() => { clients.push(client); })));
  expect(clients).toEqual(["a", "b"]);
});

test("locate waits for a delayed Warcraft process rather than the native launcher", async () => {
  const events: string[] = [];
  let polls = 0;
  await run(startPairClients(["a", "b"], (client) => Effect.sync(() => { events.push(`start ${client}`); }), () => Effect.gen(function*() {
    yield* waitForFirstClient(Effect.sync(() => {
      if (polls === 3) return true;
      polls++;
      events.push("waiting for Warcraft");
      return false;
    }), Effect.succeed(false));
    events.push("locate a");
  })));
  expect(events).toEqual(["start a", "waiting for Warcraft", "waiting for Warcraft", "waiting for Warcraft", "locate a", "start b"]);
});

test("an exited native launcher fails before locate or peer startup", async () => {
  const events: string[] = [];
  await expect(run(startPairClients(["a", "b"], (client) => Effect.sync(() => { events.push(`start ${client}`); }), () => Effect.gen(function*() {
    yield* waitForFirstClient(Effect.succeed(false), Effect.succeed(true));
    events.push("locate a");
  })))).rejects.toThrow("native launcher stopped");
  expect(events).toEqual(["start a"]);
});

test("a missing Warcraft process stops at the startup deadline", async () => {
  let polls = 0;
  const exit = await Effect.runPromise(Effect.gen(function*() {
    const waiting = yield* Effect.forkChild(Effect.exit(waitForFirstClient(Effect.sync(() => { polls++; return false; }), Effect.succeed(false))));
    yield* TestClock.adjust("61 seconds");
    return yield* Fiber.join(waiting);
  }).pipe(Effect.provide(TestClock.layer())));
  expect(exit._tag).toBe("Failure");
  expect(String(exit._tag === "Failure" ? exit.cause : "")).toContain("within 60 s");
  expect(polls).toBe(240);
});
