











import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import * as BunServices from "@effect/platform-bun/BunServices";
import { Console, Effect, Exit, Schedule, Schema, Scope } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/process";
import { Namespaces } from "../../platform/services";
import { spawnLogged } from "../hostProcess";
import { type Command, UsageFailure, flagValues } from "../command";
import { LanFailure } from "../lan/join";
import { lanPluginProblem } from "../lan/plugin";
import {
  PAIR_SIDES, PROFILES, type PoolPair, agentSocket, clientName, desktopSize, pairClients, pairDirectory, poolClientsFile, poolFile, readPool, reportPort, writeJson, writePoolClients,
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

  const chosen = flagValues(args, "pair").map(Number);
  if (chosen.some((pair) => !Number.isInteger(pair) || pair < 0)) return yield* new UsageFailure({ problem: "--pair takes a pair number" });
  for (const pair of chosen.length > 0 ? chosen : Array.from({ length: pairs }, (_, index) => index)) {
    for (const side of PAIR_SIDES) yield* setupClient(clientName(pair, side), from, reportPort(pair, side), (line) => console.log(line));
  }
});


const skillScript = (skill: string, script: string) =>
  ChildProcessSpawner.ChildProcessSpawner.use((spawner) => spawner.string(ChildProcess.make("agents", ["path", skill], { stderr: "ignore" }))).pipe(
    Effect.map((path) => join(dirname(path.trim()), script)),
    Effect.mapError((failure) => new LanFailure({ problem: `agents path ${skill}: ${failure.message}` })),
  );

const desktopLauncher = (args: readonly string[]) => {
  const [given] = flagValues(args, "desktop");
  return given !== undefined ? Effect.succeed(given) : skillScript("private-desktop-development", "scripts/private-desktop.sh");
};


const capacityHelper = (args: readonly string[]) => {
  const [given] = flagValues(args, "capacity");
  return given !== undefined ? Effect.succeed(given) : skillScript("machine-capacity", "scripts/machine-capacity.mjs");
};


class PairDeferred extends Schema.TaggedError<PairDeferred>()("PairDeferred", {
  reason: Schema.String,
}) {}

const AdmissionRefusal = Schema.fromJsonString(Schema.Struct({ reason: Schema.String }));
const AgentFile = Schema.fromJsonString(Schema.Struct({ runs: Schema.optionalKey(Schema.Struct({ a: Schema.optionalKey(Schema.String), b: Schema.optionalKey(Schema.String) })) }));
const AgentProcess = Schema.fromJsonString(Schema.Struct({ pid: Schema.Int, runs: Schema.Struct({ a: Schema.String }) }));
const AgentStatus = Schema.Struct({ clients: Schema.Array(Schema.Struct({ name: Schema.String, pid: Schema.optional(Schema.Int) })) });


const readJson = <A>(file: string, schema: Schema.Decoder<A>) => Effect.try({
  try: () => readFileSync(file, "utf8"),
  catch: (cause) => new LanFailure({ problem: `read ${file}: ${cause instanceof Error ? cause.message : String(cause)}` }),
}).pipe(
  Effect.flatMap(Schema.decodeUnknownEffect(schema)),
  Effect.mapError((failure) => (failure instanceof LanFailure ? failure : new LanFailure({ problem: `${file}: ${failure.message}` }))),
);


const clientsReady = (pair: number) => Effect.tryPromise({
  try: () => fetch("http://pair/status", { unix: agentSocket(pair) }).then((response) => response.json()),
  catch: () => undefined,
}).pipe(
  Effect.flatMap(Schema.decodeUnknownEffect(AgentStatus)),
  Effect.map((status) => status.clients.length === 2 && status.clients.every(({ pid }) => pid !== undefined)),
  Effect.orElseSucceed(() => false),
);


const READY = "10 minutes";






const startPair = (pair: number, profile: string, launcher: string, capacity: string, waitSeconds: number, fps?: number) => {
  const directory = pairDirectory(pair);
  const deadline = Date.now() + waitSeconds * 1000;
  const attempt = Effect.gen(function*() {
    mkdirSync(directory, { recursive: true });
    rmSync(agentSocket(pair), { force: true });
    const waiting = yield* pairAdmission(capacity);
    if (waiting !== undefined) return yield* new PairDeferred({ reason: waiting });
    rmSync(admissionFile(directory), { force: true });

    const scope = yield* Scope.fork(yield* Effect.scope);
    return yield* Effect.gen(function*() {

      const session = yield* spawnLogged(ChildProcess.make(process.execPath, [capacity, "session", "--class", "native", "--memory-gib", "1", "--owner", `wisp-lan-pair-${pair}`, "--", process.execPath, SESSION, "--pair", String(pair), "--pool-profile", profile, "--launcher", launcher, "--capacity", capacity, ...(fps === undefined ? [] : ["--fps", String(fps)])], { stdin: "ignore" }), {
        stdout: join(directory, "session.out"),
        stderr: join(directory, "session.err"),
      });
      const step = Effect.gen(function*() {
        if (existsSync(admissionFile(directory))) return yield* new PairDeferred({ reason: (yield* readJson(admissionFile(directory), AdmissionRefusal)).reason });
        if (!(yield* session.handle.isRunning.pipe(Effect.orElseSucceed(() => false)))) {
          const code = yield* session.handle.exitCode.pipe(Effect.map(Number), Effect.orElseSucceed(() => -1));
          yield* session.written.pipe(Effect.timeoutOption("1 second"));
          if (code !== 75) return yield* new LanFailure({ problem: `its session exited with ${code}; see ${directory}/session.err and desktop-*.err` });

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
      return { ...session.handle, stop: Scope.close(scope, Exit.void) };
    }).pipe(Scope.provide(scope), Effect.onError((cause) => Scope.close(scope, Exit.failCause(cause))));
  });
  return attempt.pipe(
    Effect.tapError((failure) => failure._tag === "PairDeferred" && Date.now() < deadline ? Console.log(`pair ${pair}: the capacity helper defers it (${failure.reason}); trying again in 45 s`) : Effect.void),
    Effect.retry({ schedule: Schedule.spaced("45 seconds"), while: (failure) => failure._tag === "PairDeferred" && Date.now() < deadline }),
    Effect.catchTag("PairDeferred", (failure) => Effect.fail(new LanFailure({ problem: `the capacity helper kept deferring it for ${waitSeconds} s (${failure.reason})` }))),
    Effect.mapError((failure) => new LanFailure({ problem: `pair ${pair}: ${failure.message}` })),
  );
};






const registerPairs = (mine: readonly PoolPair[], profile: string, fps: number | undefined) => Effect.gen(function*() {
  const ids = new Set(mine.map(({ id }) => id));
  const others = ((yield* readPool)?.pairs ?? []).filter(({ id, agentSocket: socket }) => !ids.has(id) && existsSync(socket));
  const pairs = [...others, ...mine].sort((left, right) => left.id - right.id);
  writeJson(poolFile(), { profile, ...(fps === undefined ? {} : { fps }), pairs });
  writePoolClients(poolClientsFile(), pairs.flatMap(({ id, runs }) => pairClients(id, runs)));
});

const pool: Command = (args) => Effect.gen(function*() {
  const missing = lanPluginProblem();
  if (missing !== undefined) return yield* new LanFailure({ problem: `${missing}. Install the plugin there, then run wisp lan pool again` });
  const pairs = yield* number(args, "pairs", 1);
  const seconds = yield* number(args, "seconds", 0);
  const waitSeconds = yield* number(args, "wait", 1800);
  const [fpsText] = flagValues(args, "fps");
  const fps = fpsText === undefined ? undefined : Number(fpsText);
  if (args.includes("--fps") && fpsText === undefined || fps !== undefined && (!Number.isInteger(fps) || fps < 1)) return yield* new UsageFailure({ problem: "--fps takes a positive whole number" });

  const [profileText = "parity"] = flagValues(args, "pool-profile");
  const profiles = profileText.split(",");
  if (profiles.some((name) => PROFILES[name] === undefined)) return yield* new UsageFailure({ problem: `--pool-profile takes ${Object.keys(PROFILES).join(" or ")}, or one per pair separated by commas; pool clients never sign in and draw only Classic, so Reforged and Definitive need a signed-in client` });
  const profileOf = (pair: number) => profiles[pair] ?? profiles.at(-1) ?? "parity";
  const launcher = yield* desktopLauncher(args);
  const capacity = yield* capacityHelper(args);
  const sessions: { readonly exitCode: Effect.Effect<unknown, unknown> }[] = [];
  const entries: PoolPair[] = [];

  const chosen = flagValues(args, "pair").map(Number);
  const order = chosen.length > 0 ? chosen : Array.from({ length: pairs }, (_, index) => index);
  if (order.some((pair) => !Number.isInteger(pair) || pair < 0)) return yield* new UsageFailure({ problem: "--pair takes a pair number" });
  for (const [admitted, pair] of order.entries()) {
    const profile = profileOf(pair);
    const started = yield* startPair(pair, profile, launcher, capacity, waitSeconds, fps).pipe(Effect.catchTag("LanFailure", (failure) => Effect.succeed(failure)));
    if (started instanceof LanFailure) {

      yield* Console.log(`${started.problem}; the pool stays at ${admitted} pair${admitted === 1 ? "" : "s"}; waiting: ${order.slice(admitted).join(", ")}`);
      if (admitted === 0) return yield* started;
      break;
    }
    sessions.push(started);
    const agentFile = join(pairDirectory(pair), "agent.json");
    const runs = existsSync(agentFile) ? (yield* readJson(agentFile, AgentFile)).runs ?? {} : {};

    yield* Effect.addFinalizer(() => started.stop.pipe(Effect.andThen(Effect.sync(() => {
      for (const run of [runs.a, runs.b]) {
        if (run !== undefined && basename(run).startsWith("private-desktop.") && existsSync(join(run, "lifecycle-owned"))) rmSync(join(run, "active"), { force: true });
      }
    }))));
    const status = yield* agent(pair, "/status").pipe(Effect.flatMap(Schema.decodeUnknownEffect(AgentStatus)), Effect.orElseSucceed(() => ({ clients: [] })));
    const pids = new Map(status.clients.map(({ name, pid }) => [name, pid]));
    const clientsPath = join(pairDirectory(pair), "clients.json");
    writePoolClients(clientsPath, pairClients(pair, runs).map((client) => ({ ...client, name: client.name.endsWith("a") ? "a" : "b", poolName: client.name, pid: pids.get(client.name) })));
    entries.push({ id: pair, clients: clientsPath, agentSocket: agentSocket(pair), runs, appIds: { a: `steam_app_${3516115600 + pair * 2}`, b: `steam_app_${3516115601 + pair * 2}` } });
    yield* registerPairs(entries.map((entry) => ({ ...entry, profile: profileOf(entry.id) })), profileText, fps);
    yield* Console.log(`pair ${pair}: ${clientName(pair, "a")} and ${clientName(pair, "b")} running (${profile}${fps === undefined ? "" : `, ${fps} fps`}); desktops ${runs.a ?? "?"} and ${runs.b ?? "?"}`);
  }
  yield* Console.log(`pool: ${poolFile()}; clients: ${poolClientsFile()}. Ctrl-C stops it.`);

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

const SoloResult = Schema.Struct({ clients: Schema.Array(Schema.Struct({ client: Schema.String, seconds: Schema.Finite })) });


const solo: Command = (args) => Effect.gen(function*() {
  const [map] = args.filter((arg, index) => !arg.startsWith("--") && !args[index - 1]?.startsWith("--"));
  if (map === undefined || !existsSync(map)) return yield* new UsageFailure({ problem: "solo takes a built map file (MAP.w3x)" });
  const chosen = flagValues(args, "pair").map(Number);
  if (chosen.some((pair) => !Number.isInteger(pair) || pair < 0)) return yield* new UsageFailure({ problem: "--pair takes a pair number" });
  const pairs = chosen.length > 0 ? chosen : ((yield* readPool)?.pairs ?? []).filter(({ agentSocket: socket }) => existsSync(socket)).map(({ id }) => id);
  if (pairs.length === 0) return yield* new LanFailure({ problem: "no pool pair is running; start one with wisp lan pool" });
  yield* Effect.forEach(pairs, (pair) => agent(pair, "/solo", { map: resolve(map) }).pipe(
    Effect.flatMap(Schema.decodeUnknownEffect(SoloResult)),
    Effect.mapError((failure) => (failure instanceof LanFailure ? failure : new LanFailure({ problem: `pair ${pair}: ${failure.message}` }))),
    Effect.flatMap(({ clients }) => Effect.forEach(clients, ({ client, seconds }) => Console.log(`${client}: playing ${map} alone after ${seconds.toFixed(1)} s`), { discard: true })),
  ), { concurrency: "unbounded", discard: true });
});

const status: Command = (args) => Effect.gen(function*() {
  const known = yield* readPool;
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
  const [command = "", ...entered] = yield* Namespaces.use((namespaces) => namespaces.enter(state.pid, ["user", "net"], [process.execPath, join(import.meta.dir, "../lan/dummySession.ts"), String(pair), resolve(map), resolve(program), String(count), String(native.pid)]));
  const exit = yield* Effect.scoped(Effect.flatMap(
    ChildProcess.make(command, entered, {
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

export const LAN_USAGE = "setup --from INSTALL [--pairs N | --pair K...] | pool [--pairs N | --pair K...] [--pool-profile parity|visual|hfr[,...]] [--fps N] [--seconds S] | fresh MAP [--pair K] [--computers N] [--turn-ms MS] | solo MAP [--pair K...] | dummy MAP --program W3GSCLIENT [--pair K] [--count N] | speed N --pair K | status [--pair K] | end --pair K";

export const lan: Command = ([sub, ...args]) => {
  switch (sub) {
    case "setup": return setup(args);
    case "pool": return pool(args);
    case "fresh": return fresh(args);
    case "solo": return solo(args);
    case "dummy": return dummy(args);
    case "status": return status(args);
    case "speed": return speed(args);
    case "end": return end(args);
    default: return Effect.fail(new UsageFailure({ problem: `lan takes ${LAN_USAGE}` }));
  }
};
