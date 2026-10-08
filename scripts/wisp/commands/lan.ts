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
import { dirname, join, resolve } from "node:path";
import * as BunServices from "@effect/platform-bun/BunServices";
import { Console, Effect, Exit, Schedule, Schema, Scope } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/process";
import { spawnLogged } from "../hostProcess";
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

/** A helper's path printed by `agents path SKILL`, with `script` beside it. */
const skillScript = (skill: string, script: string) =>
  ChildProcessSpawner.ChildProcessSpawner.use((spawner) => spawner.string(ChildProcess.make("agents", ["path", skill], { stderr: "ignore" }))).pipe(
    Effect.map((path) => join(dirname(path.trim()), script)),
    Effect.mapError((failure) => new LanFailure({ problem: `agents path ${skill}: ${failure.message}` })),
  );

const desktopLauncher = (args: readonly string[]) => {
  const [given] = flagValues(args, "desktop");
  return given !== undefined ? Effect.succeed(given) : skillScript("private-desktop-development", "scripts/private-desktop.sh");
};

/** The machine-capacity helper's script (the machine-capacity skill), or --capacity. */
const capacityHelper = (args: readonly string[]) => {
  const [given] = flagValues(args, "capacity");
  return given !== undefined ? Effect.succeed(given) : skillScript("machine-capacity", "scripts/machine-capacity.mjs");
};

/** The capacity helper defers a pair: worth trying again later. */
class PairDeferred extends Schema.TaggedError<PairDeferred>()("PairDeferred", {
  reason: Schema.String,
}) {}

const StartupError = Schema.fromJsonString(Schema.Struct({ error: Schema.String }));
const AdmissionRefusal = Schema.fromJsonString(Schema.Struct({ reason: Schema.String }));
const AgentFile = Schema.fromJsonString(Schema.Struct({ runs: Schema.optionalKey(Schema.Struct({ a: Schema.optionalKey(Schema.String), b: Schema.optionalKey(Schema.String) })) }));
const AgentProcess = Schema.fromJsonString(Schema.Struct({ pid: Schema.Int, runs: Schema.Struct({ a: Schema.String }) }));
const AgentStatus = Schema.Struct({ clients: Schema.Array(Schema.Struct({ name: Schema.String, pid: Schema.optional(Schema.Int) })) });

/** Decodes a pair's JSON file. */
const readJson = <A>(file: string, schema: Schema.Decoder<A>) => Effect.try({
  try: () => readFileSync(file, "utf8"),
  catch: (cause) => new LanFailure({ problem: `read ${file}: ${cause instanceof Error ? cause.message : String(cause)}` }),
}).pipe(
  Effect.flatMap(Schema.decodeUnknownEffect(schema)),
  Effect.mapError((failure) => (failure instanceof LanFailure ? failure : new LanFailure({ problem: `${file}: ${failure.message}` }))),
);

/** Both clients' pids from the pair agent, once it answers. */
const clientsReady = (pair: number) => Effect.tryPromise({
  try: () => fetch("http://pair/status", { unix: agentSocket(pair) }).then((response) => response.json()),
  catch: () => undefined,
}).pipe(
  Effect.flatMap(Schema.decodeUnknownEffect(AgentStatus)),
  Effect.map((status) => status.clients.length === 2 && status.clients.every(({ pid }) => pid !== undefined)),
  Effect.orElseSucceed(() => false),
);

/** How long a started pair session may take until both its clients run. */
const READY = "10 minutes";

/**
 * Starts pair `pair`'s session in the caller's scope and waits until both its
 * clients run. A session that fails or is deferred is stopped before this
 * returns; a deferred one is tried again every 45 s for `waitSeconds`.
 */
const startPair = (pair: number, profile: string, launcher: string, capacity: string, waitSeconds: number, fps?: number, locateBeforePeer = false) => {
  const directory = pairDirectory(pair);
  const deadline = Date.now() + waitSeconds * 1000;
  const attempt = Effect.gen(function*() {
    mkdirSync(directory, { recursive: true });
    rmSync(agentSocket(pair), { force: true });
    const waiting = yield* Effect.try({ try: () => pairAdmission(capacity), catch: (cause) => new LanFailure({ problem: cause instanceof Error ? cause.message : String(cause) }) });
    if (waiting !== undefined) return yield* new PairDeferred({ reason: waiting });
    rmSync(admissionFile(directory), { force: true });
    // The session gets its own scope: stopped at once when this attempt fails, else held by the pool.
    const scope = yield* Scope.fork(yield* Effect.scope);
    return yield* Effect.gen(function*() {
      // The desktops' Xwayland serves the games: in the batch slice a busy machine starved it and 3.0.1 games hung before their window.
      const session = yield* spawnLogged(ChildProcess.make(process.execPath, [capacity, "session", "--class", "native", "--memory-gib", "1", "--owner", `wisp-lan-pair-${pair}`, "--", process.execPath, SESSION, "--pair", String(pair), "--pool-profile", profile, "--launcher", launcher, "--capacity", capacity, ...(locateBeforePeer ? ["--locate-before-peer"] : []), ...(fps === undefined ? [] : ["--fps", String(fps)])], { stdin: "ignore" }), {
        stdout: join(directory, "session.out"),
        stderr: join(directory, "session.err"),
      });
      const step = Effect.gen(function*() {
        if (existsSync(join(directory, "startup-error.json"))) return yield* new LanFailure({ problem: (yield* readJson(join(directory, "startup-error.json"), StartupError)).error });
        if (existsSync(admissionFile(directory))) return yield* new PairDeferred({ reason: (yield* readJson(admissionFile(directory), AdmissionRefusal)).reason });
        if (!(yield* session.handle.isRunning.pipe(Effect.orElseSucceed(() => false)))) {
          const code = yield* session.handle.exitCode.pipe(Effect.map(Number), Effect.orElseSucceed(() => -1));
          yield* session.written.pipe(Effect.timeoutOption("1 second"));
          if (code !== 75) return yield* new LanFailure({ problem: `its session exited with ${code}; see ${directory}/session.err and desktop-*.err` });
          // Exit 75 is a deferral only when the helper says DEFER; it also exits 75 when it can't reach systemd --user (a user namespace, as run-bounded makes).
          const said = readFileSync(join(directory, "session.err"), "utf8");
          const reason = /"decision":"DEFER","reason":"([A-Z_]+)".*?"cpuSomeAvg10":([\d.]+)/.exec(said);
          if (reason === null) return yield* new LanFailure({ problem: `the capacity helper refused: ${said.trim().split("\n").slice(-2).join(" | ")}` });
          return yield* new PairDeferred({ reason: `${reason[1]}, CPU pressure ${reason[2]}%` });
        }
        return yield* clientsReady(pair);
      });
      yield* step.pipe(
        Effect.repeat({ schedule: Schedule.spaced("1 second"), until: (ready) => ready }),
        Effect.timeoutOrElse({ duration: READY, orElse: () => Effect.fail(new LanFailure({ problem: `its clients weren't both running within ${READY}; see ${directory}` })) }),
      );
      return session.handle;
    }).pipe(Scope.provide(scope), Effect.onError((cause) => Scope.close(scope, Exit.failCause(cause))));
  });
  return attempt.pipe(
    Effect.tapError((failure) => failure._tag === "PairDeferred" && Date.now() < deadline ? Console.log(`pair ${pair}: the capacity helper defers it (${failure.reason}); trying again in 45 s`) : Effect.void),
    Effect.retry({ schedule: Schedule.spaced("45 seconds"), while: (failure) => failure._tag === "PairDeferred" && Date.now() < deadline }),
    Effect.catchTag("PairDeferred", (failure) => Effect.fail(new LanFailure({ problem: `the capacity helper kept deferring it for ${waitSeconds} s (${failure.reason})` }))),
    Effect.mapError((failure) => new LanFailure({ problem: `pair ${pair}: ${failure.message}` })),
  );
};

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
  const launcher = yield* desktopLauncher(args);
  const capacity = yield* capacityHelper(args);
  const sessions: { readonly exitCode: Effect.Effect<unknown, unknown> }[] = [];
  const entries: PoolPair[] = [];
  // --pair K... picks which pairs and in what order the helper admits them; else 0..N-1.
  const chosen = flagValues(args, "pair").map(Number);
  const order = chosen.length > 0 ? chosen : Array.from({ length: pairs }, (_, index) => index);
  if (order.some((pair) => !Number.isInteger(pair) || pair < 0)) return yield* new UsageFailure({ problem: "--pair takes a pair number" });
  for (const [admitted, pair] of order.entries()) {
    const profile = profileOf(pair);
    const started = yield* startPair(pair, profile, launcher, capacity, waitSeconds, fps, args.includes("--locate-before-peer")).pipe(Effect.catchTag("LanFailure", (failure) => Effect.succeed(failure)));
    if (started instanceof LanFailure) {
      // The pool is as big as the machine admits: keep the pairs that started.
      yield* Console.log(`${started.problem}; the pool stays at ${admitted} pair${admitted === 1 ? "" : "s"}; waiting: ${order.slice(admitted).join(", ")}`);
      if (admitted === 0) return yield* started;
      break;
    }
    sessions.push(started);
    const agentFile = join(pairDirectory(pair), "agent.json");
    const runs = existsSync(agentFile) ? (yield* readJson(agentFile, AgentFile)).runs ?? {} : {};
    const status = yield* agent(pair, "/status").pipe(Effect.flatMap(Schema.decodeUnknownEffect(AgentStatus)), Effect.orElseSucceed(() => ({ clients: [] })));
    const pids = new Map(status.clients.map(({ name, pid }) => [name, pid]));
    const clientsPath = join(pairDirectory(pair), "clients.json");
    writeJson(clientsPath, { clients: pairClients(pair, runs).map((client) => ({ ...client, name: client.name.endsWith("a") ? "a" : "b", poolName: client.name, pid: pids.get(client.name) })) });
    entries.push({ id: pair, clients: clientsPath, agentSocket: agentSocket(pair), runs, appIds: { a: `steam_app_${3516115600 + pair * 2}`, b: `steam_app_${3516115601 + pair * 2}` } });
    registerPairs(entries.map((entry) => ({ ...entry, profile: profileOf(entry.id) })), profileText, fps);
    yield* Console.log(`pair ${pair}: ${clientName(pair, "a")} and ${clientName(pair, "b")} running (${profile}${fps === undefined ? "" : `, ${fps} fps`}); desktops ${runs.a ?? "?"} and ${runs.b ?? "?"}`);
  }
  yield* Console.log(`pool: ${poolFile()}; clients: ${poolClientsFile()}. Ctrl-C stops it.`);
  // Closing the pool's scope (its end, a failure, Ctrl-C or SIGTERM) stops every session it started.
  const ended = Effect.forEach(sessions, (session) => Effect.ignore(session.exitCode), { concurrency: "unbounded", discard: true });
  yield* seconds > 0 ? Effect.timeoutOption(ended, `${seconds} seconds`) : ended;
}).pipe(Effect.scoped, Effect.provide(BunServices.layer));

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

const dummy: Command = (args) => Effect.gen(function*() {
  const map = args[0];
  const [program] = flagValues(args, "program");
  const pair = yield* number(args, "pair", 0);
  const count = yield* number(args, "count", 20);
  if (map === undefined || !existsSync(map) || program === undefined || !existsSync(program) || count < 1) return yield* new UsageFailure({ problem: "dummy takes MAP --program W3GSCLIENT [--pair K] [--count N]" });
  const status = yield* agent(pair, "/status");
  if (status["game"] !== undefined) return yield* new UsageFailure({ problem: `pair ${pair} has a game; end it with lan end before checking its lobby` });
  const clients = status["clients"] as { name: string; pid?: number }[];
  const native = clients.find(({ name }) => name === clientName(pair, "a"));
  if (native?.pid === undefined) return yield* new UsageFailure({ problem: `pair ${pair}'s first client is not running` });
  const state = yield* readJson(join(pairDirectory(pair), "agent.json"), AgentProcess);
  const exit = yield* Effect.scoped(Effect.flatMap(
    ChildProcess.make("nsenter", ["--target", String(state.pid), "--user", "--net", "--preserve-credentials", process.execPath, join(import.meta.dir, "../lan/dummySession.ts"), String(pair), resolve(map), resolve(program), String(count), String(native.pid)], {
      env: { XDG_RUNTIME_DIR: join(state.runs.a, "runtime") }, extendEnv: true, stdin: "ignore", stdout: "inherit", stderr: "inherit",
    }),
    (child) => child.exitCode,
  )).pipe(Effect.provide(BunServices.layer), Effect.mapError((failure) => new LanFailure({ problem: failure.message })));
  if (exit !== 0) return yield* new LanFailure({ problem: `dummy lobby check exited ${exit}` });
});

const speed: Command = (args) => Effect.gen(function*() {
  const value = Number(args[0]);
  if (!Number.isFinite(value) || value < 1 || value > 16) return yield* new UsageFailure({ problem: "speed takes a multiple between 1 and 16" });
  const pair = yield* number(args, "pair", undefined);
  yield* agent(pair, "/speed", { speed: value });
  yield* Console.log(`pair ${pair}: delivering turns at ${value}x; compare client frame progress to measure game speed`);
});

export const LAN_USAGE = "setup --from INSTALL [--pairs N | --pair K...] | pool [--pairs N | --pair K...] [--pool-profile parity|visual|hfr[,...]] [--fps N] [--seconds S] [--locate-before-peer] | fresh MAP [--pair K] [--computers N] [--turn-ms MS] | dummy MAP --program W3GSCLIENT [--pair K] [--count N] | speed N --pair K | status [--pair K] | end --pair K";

export const lan: Command = ([sub, ...args]) => {
  switch (sub) {
    case "setup": return setup(args);
    case "pool": return pool(args);
    case "fresh": return fresh(args);
    case "dummy": return dummy(args);
    case "status": return status(args);
    case "speed": return speed(args);
    case "end": return end(args);
    default: return Effect.fail(new UsageFailure({ problem: `lan takes ${LAN_USAGE}` }));
  }
};
