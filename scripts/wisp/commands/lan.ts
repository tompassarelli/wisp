// `wisp lan ...`: offline Warcraft III clients that play LAN matches against
// Wisp's own host, for development on your own maps (wisp:docs/lan.md).
//   setup --from INSTALL --pairs N     make the pool's clients (no Battle.net, no account)
//   pool --pairs N [--profile parity|visual|hfr] [--seconds S]
//                                      run N pairs, each in a private network namespace with only loopback
//   fresh MAP --pair K [--turn-ms MS]  host MAP on pair K and join both clients; returns once the match plays
//   status [--pair K]                  each pair's clients and current game
//   end --pair K                       end pair K's game
// Development and testing on your own offline clients and maps only: never
// signed-in Battle.net clients, never anyone else's game, not for cheating.
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { Console, Effect } from "effect";
import { type Command, UsageFailure, flagValues } from "../command";
import { LanFailure } from "../lan/join";
import {
  PAIR_SIDES, PROFILES, type PoolPair, agentSocket, clientName, desktopSize, pairClients, pairDirectory, poolClientsFile, poolFile, readPool, reportPort, writeJson,
} from "../lan/pool";
import { setupClient } from "../lan/setup";

const SESSION = join(import.meta.dir, "../lan/pairSession.ts");

const number = (args: readonly string[], name: string, fallback: number | undefined) => Effect.gen(function*() {
  const [text] = flagValues(args, name);
  if (text === undefined) {
    if (fallback === undefined) return yield* new UsageFailure({ problem: `--${name} is required` });
    return fallback;
  }
  const value = Number(text);
  return Number.isInteger(value) && value >= 0 ? value : yield* new UsageFailure({ problem: `--${name} takes a whole number` });
});

/** Talks to a pair agent over its Unix socket. */
const agent = (pair: number, path: string, body?: unknown) => Effect.tryPromise({
  try: async () => {
    const response = await fetch(`http://pair${path}`, { unix: agentSocket(pair), method: body === undefined ? "GET" : "POST", ...(body === undefined ? {} : { body: JSON.stringify(body), headers: { "content-type": "application/json" } }) });
    const value = (await response.json()) as Record<string, unknown>;
    if (!response.ok) throw new Error(String(value["error"] ?? response.status));
    return value;
  },
  catch: (cause) => new LanFailure({ problem: `pair ${pair}'s agent (${agentSocket(pair)}): ${cause instanceof Error ? cause.message : String(cause)}` }),
});

const setup: Command = (args) => Effect.gen(function*() {
  const [from] = flagValues(args, "from");
  if (from === undefined) return yield* new UsageFailure({ problem: "--from names an existing Warcraft III install folder (the one holding _retail_)" });
  const pairs = yield* number(args, "pairs", 1);
  for (let pair = 0; pair < pairs; pair++) {
    for (const side of PAIR_SIDES) yield* setupClient(clientName(pair, side), from, reportPort(pair, side), (line) => console.log(line));
  }
});

const desktopLauncher = (args: readonly string[]) => {
  const [given] = flagValues(args, "desktop");
  if (given !== undefined) return given;
  const skill = Bun.spawnSync(["agents", "path", "private-desktop-development"], { stdout: "pipe", stderr: "ignore" }).stdout.toString().trim();
  return join(dirname(skill), "scripts/private-desktop.sh");
};

/** The machine-capacity helper's script (the machine-capacity skill), or --capacity. */
const capacityHelper = (args: readonly string[]) => {
  const [given] = flagValues(args, "capacity");
  if (given !== undefined) return given;
  const skill = Bun.spawnSync(["agents", "path", "machine-capacity"], { stdout: "pipe", stderr: "ignore" }).stdout.toString().trim();
  return join(dirname(skill), "scripts/machine-capacity.mjs");
};

/**
 * Starts pair `pair`'s desktop, namespace and agent inside its own
 * machine-capacity session (class moderate: two cores and 2 GiB of headroom
 * for two parity clients), so the helper admits pairs one by one while the
 * machine has room; retries while it defers.
 */
/** MiB of memory the kernel can still give, from /proc/meminfo. */
const memoryAvailableMiB = () => Math.floor(Number(/^MemAvailable:\s+(\d+) kB$/m.exec(readFileSync("/proc/meminfo", "utf8"))?.[1] ?? 0) / 1024);
/** --greedy keeps this much memory free: it starts no pair below it. */
const GREEDY_FLOOR_MIB = 12 * 1024;

/**
 * --greedy (the owner's call: unattended runs that may use the machine fully)
 * skips the helper's admission gate but keeps a pair in a scope of the
 * helper's slice, with the same kind of ceilings, so the desktop launcher
 * recognizes it and the helper's accounting still sees it.
 */
const greedyScope = (pair: number) => [
  "systemd-run", "--user", "--scope", "--quiet", "--collect", `--unit=agent-capacity-${crypto.randomUUID().replaceAll("-", "")}.scope`, "--slice=agent-capacity.slice",
  "--property=CPUQuota=300%", "--property=MemoryHigh=6G", `--description=wisp lan pair ${pair} (greedy)`, "--",
];

const startPair = (pair: number, profile: string, launcher: string, capacity: string, waitSeconds: number, greedy = false) => Effect.tryPromise({
  try: async () => {
    const definition = PROFILES[profile];
    if (definition === undefined) throw new Error(`unknown profile ${profile}`);
    const deadline = Date.now() + waitSeconds * 1000;
    mkdirSync(pairDirectory(pair), { recursive: true });
    rmSync(agentSocket(pair), { force: true });
    while (true) {
      if (greedy && memoryAvailableMiB() < GREEDY_FLOOR_MIB) throw new Error(`only ${memoryAvailableMiB()} MiB of memory available, under the 12 GiB --greedy keeps free`);
      const scope = greedy ? greedyScope(pair) : [process.execPath, capacity, "session", "--class", "moderate", "--owner", `wisp-lan-pair-${pair}`, "--"];
      const child = Bun.spawn([...scope, process.execPath, SESSION, "--pair", String(pair), "--profile", profile, "--launcher", launcher, "--capacity", capacity], {
        stdout: Bun.file(join(pairDirectory(pair), "session.out")),
        stderr: Bun.file(join(pairDirectory(pair), "session.err")),
      });
      for (;;) {
        const exited = await Promise.race([child.exited, Bun.sleep(1000).then(() => undefined)]);
        if (exited !== undefined) break;
        const status = await fetch("http://pair/status", { unix: agentSocket(pair) }).then((response) => response.json() as Promise<{ clients: { pid?: number }[] }>).catch(() => undefined);
        if (status !== undefined && status.clients.every(({ pid }) => pid !== undefined)) return child;
      }
      if (child.exitCode !== 75) throw new Error(`its session exited with ${child.exitCode}; see ${pairDirectory(pair)}/session.err and desktop-*.err`);
      // Exit 75 is a deferral only when the helper says DEFER; it also exits 75 when it can't reach systemd --user (a user namespace, as run-bounded makes).
      const said = readFileSync(join(pairDirectory(pair), "session.err"), "utf8");
      const reason = /"decision":"DEFER","reason":"([A-Z_]+)".*?"cpuSomeAvg10":([\d.]+)/.exec(said);
      if (reason === null) throw new Error(`the capacity helper refused: ${said.trim().split("\n").slice(-2).join(" | ")}`);
      if (Date.now() > deadline) throw new Error(`the capacity helper kept deferring it for ${waitSeconds} s (${reason[1]})`);
      console.log(`pair ${pair}: the capacity helper defers it (${reason[1]}, CPU pressure ${reason[2]}%); trying again in 45 s`);
      await Bun.sleep(45_000);
    }
  },
  catch: (cause) => new LanFailure({ problem: `pair ${pair}: ${cause instanceof Error ? cause.message : String(cause)}` }),
});

const pool: Command = (args) => Effect.gen(function*() {
  const pairs = yield* number(args, "pairs", 1);
  const seconds = yield* number(args, "seconds", 0);
  const waitSeconds = yield* number(args, "wait", 1800);
  // One profile for every pair, or one per pair (parity,parity,visual): the last one repeats.
  const [profileText = "parity"] = flagValues(args, "profile");
  const profiles = profileText.split(",");
  if (profiles.some((name) => PROFILES[name] === undefined)) return yield* new UsageFailure({ problem: `--profile takes ${Object.keys(PROFILES).join(" or ")}, or one per pair separated by commas` });
  const profileOf = (pair: number) => profiles[pair] ?? profiles.at(-1) ?? "parity";
  const launcher = desktopLauncher(args);
  const capacity = capacityHelper(args);
  const children: Bun.Subprocess[] = [];
  const stop = () => {
    for (const child of children) child.kill("SIGTERM");
  };
  process.once("SIGINT", () => {
    stop();
    process.exit(130);
  });
  process.once("SIGTERM", () => {
    stop();
    process.exit(143);
  });
  const entries: PoolPair[] = [];
  // --pair K... picks which pairs and in what order the helper admits them; else 0..N-1.
  const chosen = flagValues(args, "pair").map(Number);
  const order = chosen.length > 0 ? chosen : Array.from({ length: pairs }, (_, index) => index);
  if (order.some((pair) => !Number.isInteger(pair) || pair < 0)) return yield* new UsageFailure({ problem: "--pair takes a pair number" });
  for (const [admitted, pair] of order.entries()) {
    const profile = profileOf(pair);
    const started = yield* startPair(pair, profile, launcher, capacity, waitSeconds, args.includes("--greedy")).pipe(Effect.catchTag("LanFailure", (failure) => Effect.succeed(failure)));
    if (started instanceof LanFailure) {
      // The pool is as big as the machine admits: keep the pairs that started.
      yield* Console.log(`${started.problem}; the pool stays at ${admitted} pair${admitted === 1 ? "" : "s"}`);
      if (admitted === 0) return yield* started;
      break;
    }
    const child = started;
    children.push(child);
    const agentFile = join(pairDirectory(pair), "agent.json");
    const runs = existsSync(agentFile) ? (JSON.parse(readFileSync(agentFile, "utf8")) as { runs?: Partial<Record<"a" | "b", string>> }).runs ?? {} : {};
    const status = yield* agent(pair, "/status").pipe(Effect.orElseSucceed(() => ({}) as Record<string, unknown>));
    const pids = new Map(((status["clients"] ?? []) as { name: string; pid?: number }[]).map(({ name, pid }) => [name, pid]));
    const clientsPath = join(pairDirectory(pair), "clients.json");
    writeJson(clientsPath, { clients: pairClients(pair, runs).map((client) => ({ ...client, name: client.name.endsWith("a") ? "a" : "b", poolName: client.name, pid: pids.get(client.name) })) });
    entries.push({ id: pair, clients: clientsPath, agentSocket: agentSocket(pair), runs, appIds: { a: "warcraft iii.exe", b: "warcraft iii.exe" } });
    writeJson(poolFile(), { profile: profileText, pairs: entries.map((entry) => ({ ...entry, profile: profileOf(entry.id) })) });
    writeJson(poolClientsFile(), { clients: entries.flatMap(({ id, runs: desktops }) => pairClients(id, desktops)) });
    yield* Console.log(`pair ${pair}: ${clientName(pair, "a")} and ${clientName(pair, "b")} running (${profile}); desktops ${runs.a ?? "?"} and ${runs.b ?? "?"}`);
  }
  yield* Console.log(`pool: ${poolFile()}; clients: ${poolClientsFile()}. Ctrl-C stops it.`);
  yield* Effect.tryPromise({
    try: () => (seconds > 0 ? Promise.race([Promise.all(children.map((child) => child.exited)), Bun.sleep(seconds * 1000)]) : Promise.all(children.map((child) => child.exited))),
    catch: () => new LanFailure({ problem: "the pool stopped" }),
  });
  stop();
});

const fresh: Command = (args) => Effect.gen(function*() {
  const [map] = [...flagValues(args, "map"), ...args.filter((arg, index) => !arg.startsWith("--") && !args[index - 1]?.startsWith("--"))];
  if (map === undefined || !existsSync(map)) return yield* new UsageFailure({ problem: "fresh takes a built map file (MAP.w3x or --map MAP.w3x)" });
  const pair = yield* number(args, "pair", 0);
  const [turnText] = flagValues(args, "turn-ms");
  const computers = yield* number(args, "computers", 0);
  const started = Date.now();
  const result = yield* agent(pair, "/fresh", { map, computers, ...(turnText === undefined ? {} : { turnMs: Number(turnText) }) });
  yield* Console.log(`pair ${pair}: playing ${map} after ${((Date.now() - started) / 1000).toFixed(1)} s; action log ${String(result["log"])}`);
});

const status: Command = (args) => Effect.gen(function*() {
  const known = readPool();
  if (known === undefined) return yield* new LanFailure({ problem: `no pool is running (${poolFile()} is missing); start one with wisp lan pool` });
  const [only] = flagValues(args, "pair");
  for (const { id } of known.pairs.filter(({ id }) => only === undefined || id === Number(only))) {
    const value = yield* agent(id, "/status").pipe(Effect.catchTag("LanFailure", (failure) => Effect.succeed({ error: failure.problem })));
    yield* Console.log(JSON.stringify(value));
  }
});

const end: Command = (args) => Effect.gen(function*() {
  const pair = yield* number(args, "pair", undefined);
  yield* agent(pair, "/end", {});
  yield* Console.log(`pair ${pair}: game ended`);
});

export const LAN_USAGE = "setup --from INSTALL [--pairs N] | pool [--pairs N | --pair K...] [--profile parity|visual|hfr[,...]] [--seconds S] [--greedy] | fresh MAP [--pair K] [--computers N] [--turn-ms MS] | status [--pair K] | end --pair K";

export const lan: Command = ([sub, ...args]) => {
  switch (sub) {
    case "setup": return setup(args);
    case "pool": return pool(args);
    case "fresh": return fresh(args);
    case "status": return status(args);
    case "end": return end(args);
    default: return Effect.fail(new UsageFailure({ problem: `lan takes ${LAN_USAGE}` }));
  }
};
