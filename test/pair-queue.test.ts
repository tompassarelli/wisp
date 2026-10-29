import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
import { PEER_STATE_SCRIPT, parseIdle, parsePeerState, poolablePairs } from "../host/commands/lanQueue";
import { type QueueWorld, expireIdle, nextFree, queueStatus, releasePair, takePair } from "../host/lan/pairQueue";

const world = (overrides: Partial<QueueWorld> = {}): QueueWorld => ({
  directory: join(mkdtempSync(join(tmpdir(), "wisp-pair-queue-")), "queue"),
  hosts: [{ name: "gex45", pairs: [7, 15], available: true }, { name: "laptop", pairs: [0], available: true }],
  alive: () => true,
  holder: () => undefined,
  ...overrides,
});
const take = (state: QueueWorld, owner: string, pid: number, waitSeconds = 5, session = "") => Effect.runPromise(takePair(state, { owner, pid, waitSeconds, session }));

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
  const state = world({ hosts: [{ name: "gex45", pairs: [7, 15], available: true }], alive: (pid) => !dead.has(pid), holder: ({ host, pair }) => (host === "gex45" && pair === 7 ? "" : undefined) });
  const leased = await take(state, "capture-a", 101);
  expect(leased).toEqual({ host: "gex45", pair: 15 });
  expect(nextFree(state, [])).toEqual({ host: "gex45", pair: 15 });
  dead.add(101);
  expect(await take(state, "capture-b", 102)).toEqual({ host: "gex45", pair: 15 });
});

test("[scenario] a host at its client cap is skipped until a pair frees, and a host with no cap is never skipped", () => {
  const state = world({ hosts: [{ name: "gex45", pairs: [7, 15, 16], available: true, clientLimit: 4 }, { name: "laptop", pairs: [0, 1], available: true }], holder: ({ host, pair }) => (host === "gex45" && pair === 16 ? "" : undefined) });
  const lease = (pair: number) => ({ host: "gex45", pair, owner: "capture-a", pid: 101, since: "" });
  expect(nextFree(state, [])).toEqual({ host: "laptop", pair: 0 });
  expect(nextFree({ ...state, holder: () => undefined }, [])).toEqual({ host: "gex45", pair: 7 });
  expect(nextFree({ ...state, holder: () => undefined, hosts: [state.hosts[0]!] }, [lease(7), lease(15)])).toBeUndefined();
  expect(nextFree(state, [lease(7)])).toEqual({ host: "laptop", pair: 0 });
});

test("[scenario] a request from a session whose own pool holds a pair is granted it with every other pair held and the host at its client cap, and the same request from an unrelated session waits", async () => {
  const holders = new Map([[7, "other-session"], [15, ""], [16, "smashcraft-1"]]);
  const state = world({ hosts: [{ name: "gex45", pairs: [7, 15, 16], available: true, clientLimit: 6 }], holder: ({ pair }) => holders.get(pair) });
  await expect(take(state, "capture-other", 102, 1, "unrelated-session")).rejects.toThrow("no free pair within 1 s");
  await expect(take(state, "capture-outside", 103, 1)).rejects.toThrow("no free pair within 1 s");
  expect(await take(state, "capture-own", 101, 5, "smashcraft-1")).toEqual({ host: "gex45", pair: 16 });
  await expect(take(state, "capture-own-again", 104, 1, "smashcraft-1")).rejects.toThrow("no free pair within 1 s");
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
    writeFileSync(join(state, `pair-${pair}`, "claim.json"), JSON.stringify({ pair, owner: "lane", session: "smashcraft-1", pid, start: 1, agent: { pid: dead, start: 1 } }, null, 2));
  }
  for (const [pair, version] of [[3, "3.0.0.24268"], [7, "3.0.1.24342"]] as const) {
    const install = join(root, "data/wisp/lan/clients", `lan${pair}a/pfx/drive_c/Program Files (x86)/Warcraft III`);
    mkdirSync(install, { recursive: true });
    writeFileSync(join(install, ".build.info"), `Branch!STRING:0|Active!DEC:1|Version!STRING:0\nus|1|${version}\n`);
  }
  const state_ = parsePeerState(await Bun.$`sh -c ${PEER_STATE_SCRIPT}`.env({ ...process.env, XDG_STATE_HOME: root, XDG_DATA_HOME: join(root, "data") }).text());
  expect([...state_.busy].sort()).toEqual([[3, ""], [7, "smashcraft-1"]]);
  expect([...state_.builds]).toEqual(expect.arrayContaining([[3, "3.0.0.24268"], [7, "3.0.1.24342"]]));
  expect(poolablePairs([3, 7, 9], state_.builds)).toEqual([3]);
});

test("[scenario] with two hosts free, each new lease goes to the host with fewer pairs in use, this host first on a tie", async () => {
  const state = world({ hosts: [{ name: "gex45", pairs: [7, 15], available: true }, { name: "laptop", pairs: [0, 1], available: true }] });
  const slots = [];
  for (const pid of [101, 102, 103, 104]) slots.push(await take(state, `capture-${pid}`, pid));
  expect(slots).toEqual([{ host: "gex45", pair: 7 }, { host: "laptop", pair: 0 }, { host: "gex45", pair: 15 }, { host: "laptop", pair: 1 }]);
});

const leaseFor = (state: QueueWorld, slot: { host: string; pair: number }, owner: string, secondsAgo: number) => {
  mkdirSync(join(state.directory, "leases"), { recursive: true });
  writeFileSync(join(state.directory, "leases", `${slot.host}-${slot.pair}.json`), JSON.stringify({ ...slot, owner, pid: process.pid, since: new Date(Date.now() - secondsAgo * 1000).toISOString() }));
};

test("[scenario] a lease whose pair has been idle for five minutes is released with a log line naming its holder, and a busy or younger lease is kept", async () => {
  const idle = new Map([["gex45:7", 400], ["gex45:15", 0], ["laptop:0", 400]]);
  const state = world({ idleness: () => Effect.succeed(idle) });
  leaseFor(state, { host: "gex45", pair: 7 }, "capture-idle", 900);
  leaseFor(state, { host: "gex45", pair: 15 }, "capture-busy", 900);
  leaseFor(state, { host: "laptop", pair: 0 }, "capture-new", 60);
  await Effect.runPromise(expireIdle(state));
  expect(queueStatus(state).leases.map((lease) => lease.owner).sort()).toEqual(["capture-busy", "capture-new"]);
  const log = readFileSync(join(state.directory, "released.log"), "utf8");
  expect(log).toContain("released idle lease gex45:7 held by capture-idle");
  expect(log).toContain(`pid ${process.pid}`);
});

test("[scenario] a lease on a pair whose state cannot be read is kept, and one on a pair with no agent is released once the lease itself is five minutes old", async () => {
  const state = world({ idleness: () => Effect.succeed(new Map([["laptop:0", Number.POSITIVE_INFINITY]])) });
  leaseFor(state, { host: "gex45", pair: 7 }, "capture-unread", 900);
  leaseFor(state, { host: "laptop", pair: 0 }, "capture-no-agent", 900);
  await Effect.runPromise(expireIdle(state));
  expect(queueStatus(state).leases.map((lease) => lease.owner)).toEqual(["capture-unread"]);
});

test("[scenario] a request blocked behind an idle lease takes its pair once the lease is released", async () => {
  const state = world({ hosts: [{ name: "gex45", pairs: [7], available: true }], idleness: () => Effect.succeed(new Map([["gex45:7", 600]])) });
  leaseFor(state, { host: "gex45", pair: 7 }, "capture-idle", 900);
  expect(await take(state, "capture-next", 202)).toEqual({ host: "gex45", pair: 7 });
});

test("[scenario] the peer's pair states parse into idle seconds, infinity for a pair with no agent and zero for one playing", () => {
  const parsed = parseIdle(`7\t{"state":"idle","idleSeconds":412}\n8\t{"state":"busy","idleSeconds":0}\n9\tnone\n10\tnot json\n`);
  expect([...parsed]).toEqual([[7, 412], [8, 0], [9, Number.POSITIVE_INFINITY]]);
});
