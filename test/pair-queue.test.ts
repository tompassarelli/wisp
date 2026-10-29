import { expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
import { type QueueWorld, nextFree, queueStatus, releasePair, takePair } from "../host/lan/pairQueue";

const world = (overrides: Partial<QueueWorld> = {}): QueueWorld => ({
  directory: join(mkdtempSync(join(tmpdir(), "wisp-pair-queue-")), "queue"),
  hosts: [{ name: "gex45", pairs: [7, 15], available: true }, { name: "laptop", pairs: [0], available: true }],
  alive: () => true,
  held: () => false,
  ...overrides,
});
const take = (state: QueueWorld, owner: string, pid: number, waitSeconds = 5) => Effect.runPromise(takePair(state, { owner, pid, waitSeconds }));

test("[scenario] two concurrent requests land on different pairs, on this host before the laptop", async () => {
  const state = world();
  const [first, second] = await Promise.all([take(state, "capture-a", 101), take(state, "capture-b", 102)]);
  expect(new Set([`${first.host}:${first.pair}`, `${second.host}:${second.pair}`]).size).toBe(2);
  expect([first, second].every((slot) => slot.host === "gex45")).toBe(true);
  const third = await take(state, "capture-c", 103);
  expect(third).toEqual({ host: "laptop", pair: 0 });
});

test("[scenario] a request waits in line for a released pair and the laptop is skipped while it is unavailable", async () => {
  const state = world({ hosts: [{ name: "gex45", pairs: [7], available: true }, { name: "laptop", pairs: [0], available: false }] });
  const held = await take(state, "capture-a", 101);
  await expect(take(state, "capture-b", 102, 1)).rejects.toThrow("no free pair within 1 s");
  const waiting = take(state, "capture-b", 102);
  await Bun.sleep(300);
  expect(queueStatus(state).waiting).toBe(1);
  await Effect.runPromise(releasePair(state.directory, held));
  expect(await waiting).toEqual(held);
});

test("[scenario] a lease whose process died frees its pair, and a pair held outside the queue is not offered", async () => {
  const dead = new Set<number>();
  const state = world({ alive: (pid) => !dead.has(pid), held: ({ host, pair }) => host === "gex45" && pair === 7 });
  const leased = await take(state, "capture-a", 101);
  expect(leased).toEqual({ host: "gex45", pair: 15 });
  expect(nextFree(state, [])).toEqual({ host: "gex45", pair: 15 });
  dead.add(101);
  expect(await take(state, "capture-b", 102)).toEqual({ host: "gex45", pair: 15 });
});
