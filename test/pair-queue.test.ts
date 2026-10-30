import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
import { PEER_STATE_SCRIPT, localHolder, parseIdle, parsePeerState, poolablePairs, reclaimOrphan } from "../host/commands/lanQueue";
import { markOf } from "../host/lan/claim";
import { holdPair } from "../host/lan/custody";
import { readHealth, recordFailure, recordPassed } from "../host/lan/pairHealth";
import { alive, claimFile, exeOf, installOf, leaseDirectory, missingClients, retailOf, writeJson } from "../host/lan/pool";
import { type QueueWorld, expireIdle, nextFree, queueStatus, releasePair, takePair } from "../host/lan/pairQueue";

const world = (overrides: Partial<QueueWorld> = {}): QueueWorld => ({
  directory: join(mkdtempSync(join(tmpdir(), "wisp-pair-queue-")), "queue"),
  hosts: [{ name: "gex45", pairs: [7, 15], available: true }, { name: "laptop", pairs: [0], available: true }],
  alive: () => true,
  holder: () => undefined,
  ...overrides,
});
const until = async (check: () => boolean) => {
  for (const deadline = Date.now() + 5000; !check() && Date.now() < deadline;) await Bun.sleep(10);
};
const trapped = async (script: string) => {
  const child = Bun.spawn(["sh", "-c", `${script}; echo trapped; while :; do sleep 0.1; done`], { stdin: "ignore", stdout: "pipe", stderr: "ignore" });
  const reader = child.stdout.getReader();
  await reader.read();
  reader.releaseLock();
  return child;
};
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
  await until(() => queueStatus(state).waiting === 1);
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

test("[scenario] the peer's pair states parse into idle seconds, infinity for a pair with no agent, zero for one its driver holds, and the undriven seconds of a dead pair", () => {
  const parsed = parseIdle(`7\t{"state":"idle","idleSeconds":412}\n8\t{"state":"busy","idleSeconds":0}\n9\tnone\n10\tnot json\n11\t{"state":"dead","idleSeconds":700,"down":["lan11b"]}\n`);
  expect([...parsed]).toEqual([[7, 412], [8, 0], [9, Number.POSITIVE_INFINITY], [11, 700]]);
});

const inStateHome = async (body: () => Promise<void>) => {
  const previous = process.env["XDG_STATE_HOME"];
  process.env["XDG_STATE_HOME"] = mkdtempSync(join(tmpdir(), "wisp-pair-state-"));
  try {
    await body();
  } finally {
    if (previous === undefined) delete process.env["XDG_STATE_HOME"];
    else process.env["XDG_STATE_HOME"] = previous;
  }
};

test("[scenario] a pair whose pool failed to start is listed unhealthy and skipped by lease take until a start passes on it", () => inStateHome(async () => {
  const state = world({ hosts: [{ name: "gex45", pairs: [7, 15], available: true }], health: ({ pair }) => readHealth(pair) });
  expect(nextFree(state, [])).toEqual({ host: "gex45", pair: 7 });
  recordFailure(7, "lan7a isn't running");
  expect(await take(state, "capture-a", 101)).toEqual({ host: "gex45", pair: 15 });
  await expect(take(state, "capture-b", 102, 1)).rejects.toThrow("no free pair within 1 s");
  expect(queueStatus(state).health).toEqual([
    { host: "gex45", pair: 7, healthy: false, failures: 1, problem: "lan7a isn't running" },
    { host: "gex45", pair: 15, healthy: true, failures: 0 },
  ]);
  recordPassed(7);
  expect(await take(state, "capture-b", 102)).toEqual({ host: "gex45", pair: 7 });
}));

test("[scenario] a live pool whose custodian session has exited holds its pair for nobody, so the queue offers the pair", () => inStateHome(async () => {
  const custodian = Bun.spawn(["sleep", "30"], { stdin: "ignore", stdout: "ignore", stderr: "ignore" });
  writeJson(claimFile(7), { pair: 7, owner: "tyrande-portraits", session: "tyrande-portraits", ...markOf(process.pid), agent: markOf(custodian.pid) });
  expect(localHolder(7)).toBe("tyrande-portraits");
  custodian.kill();
  await custodian.exited;
  expect(localHolder(7)).toBeUndefined();
}));

test("[scenario] the peer reports each recorded pair's start failures", async () => {
  const root = mkdtempSync(join(tmpdir(), "wisp-peer-health-"));
  mkdirSync(join(root, "wisp/lan/pair-4"), { recursive: true });
  writeFileSync(join(root, "wisp/lan/pair-4/health.json"), JSON.stringify({ failures: 2, problem: "lan4b isn't running", at: "" }, null, 2));
  const peer = parsePeerState(await Bun.$`sh -c ${PEER_STATE_SCRIPT}`.env({ ...process.env, XDG_STATE_HOME: root, XDG_DATA_HOME: join(root, "data") }).text());
  expect([...peer.failures]).toEqual([[4, 2]]);
});

test("[scenario] a pair whose client install the disk reclaim removed is missing that client, so neither the queue nor a pool start uses it", () => {
  const previous = process.env["XDG_DATA_HOME"];
  process.env["XDG_DATA_HOME"] = mkdtempSync(join(tmpdir(), "wisp-pair-data-"));
  try {
    for (const name of ["lan9a", "lan9b", "lan4a", "lan6a", "lan6b"]) {
      mkdirSync(join(retailOf(name), "x86_64"), { recursive: true });
      writeFileSync(exeOf(name), "");
      if (name !== "lan6a") writeFileSync(join(installOf(name), ".build.info"), "");
    }
    expect([missingClients(9), missingClients(4), missingClients(4, true), missingClients(5), missingClients(6)]).toEqual([[], ["lan4b"], [], ["lan5a", "lan5b"], ["lan6a"]]);
  } finally {
    if (previous === undefined) delete process.env["XDG_DATA_HOME"];
    else process.env["XDG_DATA_HOME"] = previous;
  }
});

test("[scenario] a pool start on a pair leased to another session is refused naming the lease's holder, in line or not, and the leasing session's own start passes", () => inStateHome(async () => {
  const previousPlaytest = process.env["PLAYTEST_STATE"];
  process.env["PLAYTEST_STATE"] = join(tmpdir(), "wisp-no-playtest-state.json");
  try {
    const host = (await Bun.$`hostname`.text()).trim();
    mkdirSync(join(leaseDirectory(), "leases"), { recursive: true });
    writeFileSync(join(leaseDirectory(), "leases", `${host}-7.json`), JSON.stringify({ host, pair: 7, owner: "capture-sweep", pid: process.pid, session: "sc-capture-sweep", since: "2026-10-30T02:00:00Z" }));
    const refusal = (session: string, queued: boolean) => Effect.runPromise(Effect.scoped(holdPair(7, { session, owner: session }, queued)).pipe(Effect.flip, Effect.map((failure) => failure.message)));
    for (const queued of [false, true]) {
      const said = await refusal("sc-760-d0146", queued);
      expect(said).toContain("leased to capture-sweep (fleet session sc-capture-sweep)");
      expect(said).toContain(`pid ${process.pid}`);
    }
    expect(await refusal("", false)).toContain("leased to capture-sweep");
    const started = (pair: number, session: string) => Effect.runPromise(Effect.scoped(holdPair(pair, { session, owner: session }, false)).pipe(Effect.as("started")));
    expect(await started(7, "sc-capture-sweep")).toBe("started");
    expect(await started(8, "sc-760-d0146")).toBe("started");
  } finally {
    if (previousPlaytest === undefined) delete process.env["PLAYTEST_STATE"];
    else process.env["PLAYTEST_STATE"] = previousPlaytest;
  }
}));

test("[scenario] a lease on a pair whose pool outlived its custodian is granted only once that pool has exited, and fails when the pool will not stop", () => inStateHome(async () => {
  const claim = (pid: number) => writeJson(claimFile(7), { pair: 7, owner: "smashcraft-653", session: "smashcraft-653", ...markOf(pid), agent: { pid: 2999999, start: 1 } });
  const pool = await trapped("trap 'sleep 1; exit 0' TERM");
  claim(pool.pid);
  await Effect.runPromise(reclaimOrphan(7, 10));
  expect(alive(pool.pid)).toBe(false);
  const stuck = await trapped("trap '' TERM");
  claim(stuck.pid);
  await expect(Effect.runPromise(reclaimOrphan(7, 1))).rejects.toThrow("still running 1 s after its stop");
  stuck.kill("SIGKILL");
  await stuck.exited;
}));
