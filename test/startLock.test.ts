import { Effect } from "effect";
import { expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { acquireStartLock } from "../scripts/wisp/startLock";

const lockFile = () => join(mkdtempSync(join(tmpdir(), "wisp-start-lock-")), "client-start.lock");

test("[rule: clients start one at a time] a second start waits for the first's release and names who holds the lock", async () => {
  const path = lockFile();
  const events: string[] = [];
  const start = (holder: string) => Effect.gen(function*() {
    const release = yield* acquireStartLock({ path, holder, noteEvery: 1, print: (line) => events.push(`${holder}: ${line}`) });
    events.push(`${holder} starts`);
    yield* Effect.sleep("600 millis");
    events.push(`${holder} at its menus`);
    yield* release;
  });
  await Effect.runPromise(Effect.all([start("clone-a"), Effect.sleep("400 millis").pipe(Effect.andThen(start("clone-d")))], { concurrency: "unbounded" }));
  const order = events.filter((line) => !line.includes(": "));
  expect(order).toEqual(["clone-a starts", "clone-a at its menus", "clone-d starts", "clone-d at its menus"]);
  expect(events.some((line) => line.startsWith("clone-d: waiting to start") && line.includes("clone-a (pid "))).toBe(true);
});

test("[rule: a start lock frees itself after its timeout] a start that never releases holds the lock only `seconds`", async () => {
  const path = lockFile();
  const lines: string[] = [];
  const stuck = await Effect.runPromise(acquireStartLock({ path, holder: "clone-a", seconds: 1, print: (line) => lines.push(line) }));
  const began = Date.now();
  const next = await Effect.runPromise(acquireStartLock({ path, holder: "clone-d", print: () => {} }));
  const waited = Date.now() - began;
  expect(waited).toBeGreaterThan(500);
  expect(waited).toBeLessThan(3000);
  await Effect.runPromise(next);
  await Effect.runPromise(stuck);
  expect(lines).toEqual(["start lock had already been released after its 1 s timeout"]);
});
