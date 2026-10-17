import { Effect, Fiber } from "effect";
import { expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pollFor } from "../host/cli/hostProcess";
import { acquireStartLock } from "../host/client/startLock";

const lockFile = () => join(mkdtempSync(join(tmpdir(), "wisp-start-lock-")), "client-start.lock");

test("[rule: clients start one at a time] a second start waits for the first's release and names who holds the lock", async () => {
  const path = lockFile();
  const events: string[] = [];
  const acquire = (holder: string) => acquireStartLock({ path, holder, noteEvery: 1, print: (line) => events.push(`${holder}: ${line}`) });
  await Effect.runPromise(Effect.gen(function*() {
    const release = yield* acquire("clone-a");
    events.push("clone-a starts");
    const second = yield* Effect.forkChild(Effect.gen(function*() {
      const released = yield* acquire("clone-d");
      events.push("clone-d starts");
      events.push("clone-d at its menus");
      yield* released;
    }));
    // clone-a holds the lock until clone-d has either reported waiting or started.
    yield* pollFor(30, "50 millis", Effect.sync(() => events.find((line) => line.startsWith("clone-d"))));
    events.push("clone-a at its menus");
    yield* release;
    yield* Fiber.join(second);
  }));
  const order = events.filter((line) => !line.includes(": "));
  expect(order).toEqual(["clone-a starts", "clone-a at its menus", "clone-d starts", "clone-d at its menus"]);
  expect(events.some((line) => line.startsWith("clone-d: waiting to start") && line.includes("clone-a (pid "))).toBe(true);
});
