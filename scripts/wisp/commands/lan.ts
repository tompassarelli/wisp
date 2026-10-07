// `wisp lan ...`: offline Warcraft III clients that play LAN matches against
// Wisp's own host, for development on your own maps (wisp:docs/lan.md).
//   setup --from INSTALL --pairs N     make the pool's clients (no Battle.net, no account)
//   pool --pairs N [--pool-profile parity|visual|hfr] [--seconds S]
//                                      run N pairs, each in a private network namespace with only loopback
//   fresh MAP --pair K [--turn-ms MS]  host MAP on pair K and join both clients; returns once the match plays
//   status [--pair K]                  each pair's clients and current game
//   speed N --pair K                   deliver game turns N times sooner (1 restores real time)
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
import { admissionFile, pairAdmission } from "../lan/admission";

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
  // --pair K... makes only those pairs, so a pool already running elsewhere is left alone.
  const chosen = flagValues(args, "pair").map(Number);
  if (chosen.some((pair) => !Number.isInteger(pair) || pair < 0)) return yield* new UsageFailure({ problem: "--pair takes a pair number" });
  for (const pair of chosen.length > 0 ? chosen : Array.from({ length: pairs }, (_, index) => index)) {
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

const startPair = (pair: number, profile: string, launcher: string, capacity: string, waitSeconds: number, fps?: number) => Effect.tryPromise({
  try: async () => {
    const definition = PROFILES[profile];
    if (definition === undefined) throw new Error(`unknown profile ${profile}`);
    const deadline = Date.now() + waitSeconds * 1000;
    mkdirSync(pairDirectory(pair), { recursive: true });
    rmSync(agentSocket(pair), { force: true });
    while (true) {
      const waiting = pairAdmission(capacity);
      if (waiting !== undefined) {
        if (Date.now() >= deadline) throw new Error(waiting);
        console.log(`pair ${pair}: waiting (${waiting}); trying again in 45 s`);
        await Bun.sleep(45_000);
        continue;
      }
      rmSync(admissionFile(pairDirectory(pair)), { force: true });
      const scope = [process.execPath, capacity, "session", "--class", "moderate", "--owner", `wisp-lan-pair-${pair}`, "--"];
      const child = Bun.spawn([...scope, process.execPath, SESSION, "--pair", String(pair), "--pool-profile", profile, "--launcher", launcher, "--capacity", capacity, ...(fps === undefined ? [] : ["--fps", String(fps)])], {
        stdout: Bun.file(join(pairDirectory(pair), "session.out")),
        stderr: Bun.file(join(pairDirectory(pair), "session.err")),
      });
      let refused: string | undefined;
      for (;;) {
        const exited = await Promise.race([child.exited, Bun.sleep(1000).then(() => undefined)]);
        if (existsSync(admissionFile(pairDirectory(pair)))) {
          refused = (JSON.parse(readFileSync(admissionFile(pairDirectory(pair)), "utf8")) as { reason: string }).reason;
          child.kill("SIGTERM");
          await child.exited;
          break;
        }
        if (exited !== undefined) break;
        const status = await fetch("http://pair/status", { unix: agentSocket(pair) }).then((response) => response.json() as Promise<{ clients: { pid?: number }[] }>).catch(() => undefined);
        if (status !== undefined && status.clients.length === 2 && status.clients.every(({ pid }) => pid !== undefined)) return child;
      }
      if (refused === undefined && child.exitCode !== 75) throw new Error(`its session exited with ${child.exitCode}; see ${pairDirectory(pair)}/session.err and desktop-*.err`);
      // Exit 75 is a deferral only when the helper says DEFER; it also exits 75 when it can't reach systemd --user (a user namespace, as run-bounded makes).
      const said = readFileSync(join(pairDirectory(pair), "session.err"), "utf8");
      const reason = /"decision":"DEFER","reason":"([A-Z_]+)".*?"cpuSomeAvg10":([\d.]+)/.exec(said);
      if (reason === null && refused === undefined) throw new Error(`the capacity helper refused: ${said.trim().split("\n").slice(-2).join(" | ")}`);
      if (Date.now() >= deadline) throw new Error(`the capacity helper kept deferring it for ${waitSeconds} s (${refused ?? reason?.[1]})`);
      console.log(`pair ${pair}: the capacity helper defers it (${refused ?? reason?.[1]}, CPU pressure ${reason?.[2] ?? "?"}%); trying again in 45 s`);
      await Bun.sleep(45_000);
    }
  },
  catch: (cause) => new LanFailure({ problem: `pair ${pair}: ${cause instanceof Error ? cause.message : String(cause)}` }),
});

/**
 * Several pools run at once (one per agent, each on its own pairs), so a pool
 * merges its pairs into pool.json and clients.json instead of replacing them:
 * it keeps every other pair whose agent socket still exists.
 */
const registerPairs = (mine: readonly PoolPair[], profile: string, fps: number | undefined) => {
  const ids = new Set(mine.map(({ id }) => id));
  const others = (readPool()?.pairs ?? []).filter(({ id, agentSocket: socket }) => !ids.has(id) && existsSync(socket));
  const pairs = [...others, ...mine].sort((left, right) => left.id - right.id);
  writeJson(poolFile(), { profile, ...(fps === undefined ? {} : { fps }), pairs });
  writeJson(poolClientsFile(), { clients: pairs.flatMap(({ id, runs }) => pairClients(id, runs)) });
};

const pool: Command = (args) => Effect.gen(function*() {
  const pairs = yield* number(args, "pairs", 1);
  const seconds = yield* number(args, "seconds", 0);
  const waitSeconds = yield* number(args, "wait", 1800);
  const [fpsText] = flagValues(args, "fps");
  const fps = fpsText === undefined ? undefined : Number(fpsText);
  if (args.includes("--fps") && fpsText === undefined || fps !== undefined && (!Number.isInteger(fps) || fps < 1)) return yield* new UsageFailure({ problem: "--fps takes a positive whole number" });
  // One profile for every pair, or one per pair (parity,parity,visual): the last one repeats.
  const [profileText = "parity"] = flagValues(args, "pool-profile");
  const profiles = profileText.split(",");
  if (profiles.some((name) => PROFILES[name] === undefined)) return yield* new UsageFailure({ problem: `--pool-profile takes ${Object.keys(PROFILES).join(" or ")}, or one per pair separated by commas` });
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
    const started = yield* startPair(pair, profile, launcher, capacity, waitSeconds, fps).pipe(Effect.catchTag("LanFailure", (failure) => Effect.succeed(failure)));
    if (started instanceof LanFailure) {
      // The pool is as big as the machine admits: keep the pairs that started.
      yield* Console.log(`${started.problem}; the pool stays at ${admitted} pair${admitted === 1 ? "" : "s"}; waiting: ${order.slice(admitted).join(", ")}`);
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
    entries.push({ id: pair, clients: clientsPath, agentSocket: agentSocket(pair), runs, appIds: { a: `steam_app_${3516115600 + pair * 2}`, b: `steam_app_${3516115601 + pair * 2}` } });
    registerPairs(entries.map((entry) => ({ ...entry, profile: profileOf(entry.id) })), profileText, fps);
    yield* Console.log(`pair ${pair}: ${clientName(pair, "a")} and ${clientName(pair, "b")} running (${profile}${fps === undefined ? "" : `, ${fps} fps`}); desktops ${runs.a ?? "?"} and ${runs.b ?? "?"}`);
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

const speed: Command = (args) => Effect.gen(function*() {
  const value = Number(args[0]);
  if (!Number.isFinite(value) || value < 1 || value > 16) return yield* new UsageFailure({ problem: "speed takes a multiple between 1 and 16" });
  const pair = yield* number(args, "pair", undefined);
  yield* agent(pair, "/speed", { speed: value });
  yield* Console.log(`pair ${pair}: delivering turns at ${value}x; compare client frame progress to measure game speed`);
});

export const LAN_USAGE = "setup --from INSTALL [--pairs N | --pair K...] | pool [--pairs N | --pair K...] [--pool-profile parity|visual|hfr[,...]] [--fps N] [--seconds S] | fresh MAP [--pair K] [--computers N] [--turn-ms MS] | speed N --pair K | status [--pair K] | end --pair K";

export const lan: Command = ([sub, ...args]) => {
  switch (sub) {
    case "setup": return setup(args);
    case "pool": return pool(args);
    case "fresh": return fresh(args);
    case "status": return status(args);
    case "speed": return speed(args);
    case "end": return end(args);
    default: return Effect.fail(new UsageFailure({ problem: `lan takes ${LAN_USAGE}` }));
  }
};
