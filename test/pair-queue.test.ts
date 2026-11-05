import { expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
import { type QueueWorld, takePair } from "../host/lan/pairQueue";

const world = (overrides: Partial<QueueWorld> = {}): QueueWorld => ({
  directory: join(mkdtempSync(join(tmpdir(), "wisp-pair-queue-")), "queue"),
  hosts: [{ name: "gex45", pairs: [7, 15], available: true }, { name: "laptop", pairs: [0], available: true }],
  alive: () => true,
  holder: () => undefined,
  ...overrides,
});
const take = (state: QueueWorld, owner: string, pid: number, waitSeconds = 5, session = "") => Effect.runPromise(takePair(state, { owner, pid, waitSeconds, session }));

test("[scenario] a request from a session whose own pool holds a pair is granted it with every other pair held and the host at its client cap, and the same request from an unrelated session waits", async () => {
  const holders = new Map([[7, "other-session"], [15, ""], [16, "makgora-1"]]);
  const state = world({ hosts: [{ name: "gex45", pairs: [7, 15, 16], available: true, clientLimit: 6 }], holder: ({ pair }) => holders.get(pair) });
  await expect(take(state, "capture-other", 102, 1, "unrelated-session")).rejects.toThrow("no free pair within 1 s");
  await expect(take(state, "capture-outside", 103, 1)).rejects.toThrow("no free pair within 1 s");
  expect(await take(state, "capture-own", 101, 5, "makgora-1")).toEqual({ host: "gex45", pair: 16 });
  await expect(take(state, "capture-own-again", 104, 1, "makgora-1")).rejects.toThrow("no free pair within 1 s");
});
