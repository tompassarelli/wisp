import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
import { PEER_STATE_SCRIPT, parsePeerState, poolablePairs } from "../host/commands/lanQueue";
import { type QueueWorld, nextFree, queueStatus, releasePair, takePair } from "../host/lan/pairQueue";

const world = (overrides: Partial<QueueWorld> = {}): QueueWorld => ({
  directory: join(mkdtempSync(join(tmpdir(), "wisp-pair-queue-")), "queue"),
  hosts: [{ name: "gex45", pairs: [7, 15], available: true }, { name: "laptop", pairs: [0], available: true }],
  alive: () => true,
  held: () => false,
  ...overrides,
});
const take = (state: QueueWorld, owner: string, pid: number, waitSeconds = 5) => Effect.runPromise(takePair(state, { owner, pid, waitSeconds }));

test("[scenario] two concurrent requests land on different pairs, one on each host", async () => {
  const state = world();
  const [first, second] = await Promise.all([take(state, "capture-a", 101), take(state, "capture-b", 102)]);
  expect(new Set([`${first.host}:${first.pair}`, `${second.host}:${second.pair}`]).size).toBe(2);
  expect([first.host, second.host].sort()).toEqual(["gex45", "laptop"]);
  const third = await take(state, "capture-c", 103);
  expect(third).toEqual({ host: "gex45", pair: 15 });
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
  const state = world({ hosts: [{ name: "gex45", pairs: [7, 15], available: true }], alive: (pid) => !dead.has(pid), held: ({ host, pair }) => host === "gex45" && pair === 7 });
  const leased = await take(state, "capture-a", 101);
  expect(leased).toEqual({ host: "gex45", pair: 15 });
  expect(nextFree(state, [])).toEqual({ host: "gex45", pair: 15 });
  dead.add(101);
  expect(await take(state, "capture-b", 102)).toEqual({ host: "gex45", pair: 15 });
});

test("[scenario] a host at its client cap is skipped until a pair frees, and a host with no cap is never skipped", () => {
  const state = world({ hosts: [{ name: "gex45", pairs: [7, 15, 16], available: true, clientLimit: 4 }, { name: "laptop", pairs: [0, 1], available: true }], held: ({ host, pair }) => host === "gex45" && pair === 16 });
  const lease = (pair: number) => ({ host: "gex45", pair, owner: "capture-a", pid: 101, since: "" });
  expect(nextFree(state, [])).toEqual({ host: "laptop", pair: 0 });
  expect(nextFree({ ...state, held: () => false }, [])).toEqual({ host: "gex45", pair: 7 });
  expect(nextFree({ ...state, held: () => false, hosts: [state.hosts[0]!] }, [lease(7), lease(15)])).toBeUndefined();
  expect(nextFree(state, [lease(7)])).toEqual({ host: "laptop", pair: 0 });
});

test("[scenario] the peer's busy pairs are the ones a live lease of its own or a live pool claim holds, and only pairs on a build that runs a pool are offered", async () => {
  const root = mkdtempSync(join(tmpdir(), "wisp-busy-pairs-"));
  const host = (await Bun.$`hostname`.text()).trim();
  const state = join(root, "wisp/lan");
  mkdirSync(join(state, "queue/leases"), { recursive: true });
  const dead = 2999999;
  writeFileSync(join(state, "queue/leases", `${host}-3.json`), JSON.stringify({ host, pair: 3, owner: "a", pid: process.pid, since: "" }));
  writeFileSync(join(state, "queue/leases", `${host}-4.json`), JSON.stringify({ host, pair: 4, owner: "a", pid: dead, since: "" }));
  writeFileSync(join(state, "queue/leases", "elsewhere-5.json"), JSON.stringify({ host: "elsewhere", pair: 5, owner: "a", pid: process.pid, since: "" }));
  for (const [pair, pid] of [[7, process.pid], [8, dead]] as const) {
    mkdirSync(join(state, `pair-${pair}`), { recursive: true });
    writeFileSync(join(state, `pair-${pair}`, "claim.json"), JSON.stringify({ pid }, null, 2));
  }
  for (const [pair, version] of [[3, "3.0.0.24268"], [7, "3.0.1.24342"]] as const) {
    const install = join(root, "data/wisp/lan/clients", `lan${pair}a/pfx/drive_c/Program Files (x86)/Warcraft III`);
    mkdirSync(install, { recursive: true });
    writeFileSync(join(install, ".build.info"), `Branch!STRING:0|Active!DEC:1|Version!STRING:0\nus|1|${version}\n`);
  }
  const state_ = parsePeerState(await Bun.$`sh -c ${PEER_STATE_SCRIPT}`.env({ ...process.env, XDG_STATE_HOME: root, XDG_DATA_HOME: join(root, "data") }).text());
  expect([...state_.busy].sort()).toEqual([3, 7]);
  expect([...state_.builds]).toEqual(expect.arrayContaining([[3, "3.0.0.24268"], [7, "3.0.1.24342"]]));
  expect(poolablePairs([3, 7, 9], state_.builds)).toEqual([3]);
});

test("[scenario] with two hosts free, each new lease goes to the host with fewer pairs in use, this host first on a tie", async () => {
  const state = world({ hosts: [{ name: "gex45", pairs: [7, 15], available: true }, { name: "laptop", pairs: [0, 1], available: true }] });
  const slots = [];
  for (const pid of [101, 102, 103, 104]) slots.push(await take(state, `capture-${pid}`, pid));
  expect(slots).toEqual([{ host: "gex45", pair: 7 }, { host: "laptop", pair: 0 }, { host: "gex45", pair: 15 }, { host: "laptop", pair: 1 }]);
});
