import { existsSync, linkSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { userInfo } from "node:os";
import * as BunServices from "@effect/platform-bun/BunServices";
import { Console, Effect, Exit, Schema, Scope } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/process";
import { Namespaces } from "../os/platform/services";
import { collect, pollUntil, spawnLogged } from "../cli/hostProcess";
import { type Command, UsageFailure, describeCause, flagValues, portFlag, wholeFlag } from "../cli/command";
import { CLEAR, type Impairment, clearedAlready, impairCommands, impairmentSummary } from "../lan/netem";
import { LanFailure } from "../lan/join";
import { lanPluginProblem } from "../lan/plugin";
import { ensurePackager } from "../compile/mapBuild";
import {
  PAIR_SIDES, agentFile, agentPidFile, agentSocket, alive, clientName, lanPlayRefusal, mapPackager, networkFlagProblem, pairClients, pairSides, pairCustody, pairDirectory, pairEntryFile, pairsHeldBy, livePairs, poolClientsFile, poolFile, poolHolder, poolHolderFile, poolOwners, playtestPairRefusal, readPool, reportPort, stopAgent, stopPairScopes, writeJson, writePoolClients, wrongUser,
} from "../lan/pool";
import { PROFILES, desktopSize } from "../os/warcraft/clientProfiles";
import { DEFAULT_BUILD, profileFor } from "../client/builds";
import { setupClient } from "../lan/setup";
import { CapacityDeferred, admissionFile, capacityDeferral, deferredExit, pairAdmission, retryWhileDeferred } from "../lan/admission";

const SESSION = join(import.meta.dir, "../lan/pairSession.ts");

const number = (args: readonly string[], name: string, fallback: number | undefined) => Effect.suspend(() => {
  const value = wholeFlag(args, name, fallback === undefined ? {} : { fallback });
  return value instanceof UsageFailure ? Effect.fail(value) : value === undefined ? Effect.fail(new UsageFailure({ problem: `--${name} is required` })) : Effect.succeed(value);
});

const agent = (pair: number, path: string, body?: unknown) => Effect.tryPromise({
  try: async () => {
    const response = await fetch(`http://pair${path}`, { unix: agentSocket(pair), method: body === undefined ? "GET" : "POST", ...(body === undefined ? {} : { body: JSON.stringify(body), headers: { "content-type": "application/json" } }) });
    const value = (await response.json()) as Record<string, unknown>;
    if (!response.ok) throw new Error(String(value["error"] ?? response.status));
    return value;
  },
  catch: (cause) => new LanFailure({ problem: `pair ${pair}'s agent (${agentSocket(pair)}): ${describeCause(cause)}` }),
});

/** The process that drives the pair: this command's caller, past the package-script wrappers (`bun run wisp`, `bun wisp`, `bun GAME`) that exit with it. */
const driverPid = Effect.try(() => {
  let pid = process.ppid;
  for (let depth = 0; depth < 8; depth++) {
    const [, ...words] = readFileSync(`/proc/${pid}/cmdline`, "utf8").split("\0");
    const verb = words.find((word) => !word.startsWith("-"));
    if (readFileSync(`/proc/${pid}/comm`, "utf8").trim() !== "bun" || verb === undefined || /[./]/.test(verb)) return pid;
    pid = Number(readFileSync(`/proc/${pid}/stat`, "utf8").split(") ")[1]?.split(" ")[1]);
  }
  return pid;
}).pipe(Effect.orElseSucceed(() => process.ppid));

const setup: Command = (args) => Effect.gen(function*() {
  const [from] = flagValues(args, "from");
  if (from === undefined) return yield* new UsageFailure({ problem: "--from names an existing Warcraft III install folder (the one holding _retail_)" });
  const pairs = yield* number(args, "pairs", 1);
  const [build = DEFAULT_BUILD] = flagValues(args, "build");
  if (profileFor(build) === undefined) return yield* new UsageFailure({ problem: `--build ${build} has no build profile in builds/` });

  const chosen = flagValues(args, "pair").map((value) => wholeFlag(["--pair", value], "pair"));
  if (!chosen.every((pair) => typeof pair === "number")) return yield* new UsageFailure({ problem: "--pair takes a pair number" });
  for (const pair of chosen.length > 0 ? chosen : Array.from({ length: pairs }, (_, index) => index)) {
    for (const side of PAIR_SIDES) yield* setupClient(clientName(pair, side), from, build, reportPort(pair, side), (line) => console.log(line));
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

const AdmissionRefusal = Schema.fromJsonString(Schema.Struct({ reason: Schema.String }));
const AgentFile = Schema.fromJsonString(Schema.Struct({ runs: Schema.optionalKey(Schema.Struct({ a: Schema.optionalKey(Schema.String), b: Schema.optionalKey(Schema.String) })) }));
const AgentProcess = Schema.fromJsonString(Schema.Struct({ pid: Schema.Int, network: Schema.optionalKey(Schema.Boolean), runs: Schema.Struct({ a: Schema.String }) }));
const AgentStatus = Schema.Struct({ clients: Schema.Array(Schema.Struct({ name: Schema.String, pid: Schema.optional(Schema.Int) })) });

const readJson = <A>(file: string, schema: Schema.Decoder<A>) => Effect.try({
  try: () => readFileSync(file, "utf8"),
  catch: (cause) => new LanFailure({ problem: `read ${file}: ${describeCause(cause)}` }),
}).pipe(
  Effect.flatMap(Schema.decodeUnknownEffect(schema)),
  Effect.mapError((failure) => (failure instanceof LanFailure ? failure : new LanFailure({ problem: `${file}: ${failure.message}` }))),
);

const clientsReady = (pair: number, network: boolean) => Effect.tryPromise({
  try: () => fetch("http://pair/status", { unix: agentSocket(pair) }).then((response) => response.json()),
  catch: () => undefined,
}).pipe(
  Effect.flatMap(Schema.decodeUnknownEffect(AgentStatus)),
  Effect.map((status) => status.clients.length === pairSides(network).length && status.clients.every(({ pid }) => pid !== undefined)),
  Effect.orElseSucceed(() => false),
);

const READY = "10 minutes";

const holdPair = (pair: number) => pairCustody(pair).pipe(Effect.andThen(Effect.acquireRelease(
  Effect.try({
    try: () => {
      const file = poolHolderFile(pair);
      const known = existsSync(file);
      const holder = Number(known ? readFileSync(file, "utf8").trim() : "");
      if (Number.isInteger(holder) && holder > 0 && holder !== process.pid && alive(holder)) throw new LanFailure({ problem: `it is held by wisp lan pool ${holder}; stop that pool first` });
      if (holder === process.pid) return;
      mkdirSync(pairDirectory(pair), { recursive: true });
      if (known) rmSync(file);
      const next = `${file}.${process.pid}.next`;
      writeFileSync(next, `${process.pid}\n`);
      try {
        linkSync(next, file);
      } finally {
        rmSync(next, { force: true });
      }
    },
    catch: (cause) => cause instanceof LanFailure ? cause : new LanFailure({ problem: `hold pair ${pair}: ${describeCause(cause)}` }),
  }),
  () => Effect.sync(() => {
    if (existsSync(poolHolderFile(pair)) && readFileSync(poolHolderFile(pair), "utf8").trim() === String(process.pid)) rmSync(poolHolderFile(pair), { force: true });
  }),
).pipe(Effect.andThen(Effect.gen(function*() {
  const refusal = yield* playtestPairRefusal(pair);
  if (refusal !== undefined) return yield* new LanFailure({ problem: refusal });
})))));

const outlivedStop = (name: string, lease: string) => Console.log(`${name} outlived its stop (lease ${lease}); killing its scope`);

const startPair = (pair: number, profile: string, launcher: string, capacity: string, waitSeconds: number, network: boolean, fps?: number) => {
  const directory = pairDirectory(pair);
  const attempt = Effect.gen(function*() {
    mkdirSync(directory, { recursive: true });
    rmSync(agentSocket(pair), { force: true });
    rmSync(agentFile(pair), { force: true });
    rmSync(agentPidFile(pair), { force: true });
    const outlived = yield* stopPairScopes(pair, outlivedStop);
    if (outlived.length > 0) return yield* new LanFailure({ problem: `${outlived.join(" and ")} from its last start outlived the stop of ${outlived.length === 1 ? "its" : "their"} capacity scope` });
    const waiting = yield* pairAdmission(capacity);
    if (waiting !== undefined) return yield* new CapacityDeferred({ reason: waiting });
    rmSync(admissionFile(directory), { force: true });

    const scope = yield* Scope.fork(yield* Effect.scope);
    return yield* Effect.gen(function*() {

      const session = yield* spawnLogged(ChildProcess.make(process.execPath, [capacity, "session", "--class", "native", "--memory-gib", "1", "--owner", `wisp-lan-pair-${pair}`, "--", process.execPath, SESSION, "--pair", String(pair), "--pool-profile", profile, "--launcher", launcher, "--capacity", capacity, ...(fps === undefined ? [] : ["--fps", String(fps)]), ...(network ? ["--network"] : [])], { stdin: "ignore", forceKillAfter: "90 seconds" }), {
        stdout: join(directory, "session.out"),
        stderr: join(directory, "session.err"),
      });
      yield* Effect.addFinalizer(() => stopAgent(pair));
      const step = Effect.gen(function*() {
        if (existsSync(admissionFile(directory))) return yield* new CapacityDeferred({ reason: (yield* readJson(admissionFile(directory), AdmissionRefusal)).reason });
        if (!(yield* session.handle.isRunning.pipe(Effect.orElseSucceed(() => false)))) {
          const code = yield* session.handle.exitCode.pipe(Effect.map(Number), Effect.orElseSucceed(() => -1));
          yield* session.written.pipe(Effect.timeoutOption("1 second"));
          if (!deferredExit(code)) return yield* new LanFailure({ problem: `its session exited with ${code}; see ${directory}/session.err and desktop-*.err` });

          const said = readFileSync(join(directory, "session.err"), "utf8");
          const deferred = capacityDeferral(said);
          if (deferred?.cpuSomeAvg10 === undefined) return yield* new LanFailure({ problem: `the capacity helper refused: ${said.trim().split("\n").slice(-2).join(" | ")}` });
          return yield* new CapacityDeferred({ reason: `${deferred.reason}, CPU pressure ${deferred.cpuSomeAvg10}%` });
        }
        return yield* clientsReady(pair, network);
      });
      yield* pollUntil(step, {
        until: (ready) => ready, every: "1 second", within: READY,
        onTimeout: () => Effect.fail(new LanFailure({ problem: `its clients weren't both running within ${READY}; see ${directory}` })),
      });
      return { ...session.handle, stop: Scope.close(scope, Exit.void) };
    }).pipe(Scope.provide(scope), Effect.onError((cause) => Scope.close(scope, Exit.failCause(cause))));
  });
  return holdPair(pair).pipe(Effect.andThen(retryWhileDeferred(attempt, {
    seconds: waitSeconds,
    waiting: (reason) => `pair ${pair}: the capacity helper defers it (${reason})`,
    exhausted: (reason) => new LanFailure({ problem: `the capacity helper kept deferring it for ${waitSeconds} s (${reason})` }),
  })), Effect.mapError((failure) => new LanFailure({ problem: `pair ${pair}: ${failure.message}` })));
};

const PUBLISH_ROUNDS = 5;

const publishPool = (profile: string, fps: number | undefined) => Effect.gen(function*() {
  let pairs = livePairs();
  for (let round = 0; round < PUBLISH_ROUNDS; round++) {
    writeJson(poolFile(), { profile, ...(fps === undefined ? {} : { fps }), owner: { uid: process.getuid?.() ?? 0, user: userInfo().username }, pairs });
    yield* writePoolClients(poolClientsFile(), pairs.flatMap(({ id, runs, network }) => pairClients(id, runs, pairSides(network === true))));
    const now = livePairs();
    if (JSON.stringify(now) === JSON.stringify(pairs)) return;
    pairs = now;
  }
});

const pool: Command = (args) => Effect.gen(function*() {
  const missing = lanPluginProblem();
  if (missing !== undefined) return yield* new LanFailure({ problem: `${missing}. Install the plugin there, then run wisp lan pool again` });
  const pairs = yield* number(args, "pairs", 1);
  const seconds = yield* number(args, "seconds", 0);
  const waitSeconds = yield* number(args, "wait", 1800);
  const fps = wholeFlag(args, "fps", { min: 1 });
  if (fps instanceof UsageFailure) return yield* fps;
  const networkProblem = networkFlagProblem(args);
  if (networkProblem !== undefined) return yield* new UsageFailure({ problem: networkProblem });
  const network = args.includes("--network");

  const [profileText = "parity"] = flagValues(args, "pool-profile");
  const profiles = profileText.split(",");
  if (profiles.some((name) => PROFILES[name] === undefined)) return yield* new UsageFailure({ problem: `--pool-profile takes ${Object.keys(PROFILES).join(" or ")}, or one per pair separated by commas; pool clients never sign in and draw only Classic, so Reforged needs a signed-in client` });
  const profileOf = (pair: number) => profiles[pair] ?? profiles.at(-1) ?? "parity";
  const launcher = yield* desktopLauncher(args);
  const capacity = yield* capacityHelper(args);
  yield* ensurePackager(mapPackager());
  const sessions:{ readonly exitCode: Effect.Effect<unknown, unknown> }[] = [];

  const chosen = flagValues(args, "pair").map((value) => wholeFlag(["--pair", value], "pair"));
  if (!chosen.every((pair) => typeof pair === "number")) return yield* new UsageFailure({ problem: "--pair takes a pair number" });
  const order = chosen.length > 0 ? chosen : Array.from({ length: pairs }, (_, index) => index);
  for (const [admitted, pair] of order.entries()) {
    const profile = profileOf(pair);
    const started = yield* startPair(pair, profile, launcher, capacity, waitSeconds, network, fps).pipe(Effect.catchTag("LanFailure", (failure) => Effect.succeed(failure)));
    if (started instanceof LanFailure) {

      yield* Console.log(`${started.problem}; the pool stays at ${admitted} pair${admitted === 1 ? "" : "s"}; waiting: ${order.slice(admitted).join(", ")}`);
      if (admitted === 0) return yield* started;
      break;
    }
    sessions.push(started);
    const agentFile = join(pairDirectory(pair), "agent.json");
    const runs = existsSync(agentFile) ? (yield* readJson(agentFile, AgentFile)).runs ?? {} : {};

    yield* Effect.addFinalizer(() => started.stop.pipe(Effect.andThen(stopPairScopes(pair, outlivedStop)), Effect.andThen(Effect.sync(() => {
      for (const run of [runs.a, runs.b]) {
        if (run !== undefined && basename(run).startsWith("private-desktop.") && existsSync(join(run, "lifecycle-owned"))) rmSync(join(run, "active"), { force: true });
      }
      rmSync(pairEntryFile(pair), { force: true });
    })), Effect.andThen(publishPool(profileText, fps)), Effect.ignore));
    const status = yield* agent(pair, "/status").pipe(Effect.flatMap(Schema.decodeUnknownEffect(AgentStatus)), Effect.orElseSucceed(() => ({ clients: [] })));
    const pids = new Map(status.clients.map(({ name, pid }) => [name, pid]));
    const clientsPath = join(pairDirectory(pair), "clients.json");
    yield* writePoolClients(clientsPath, pairClients(pair, runs, pairSides(network)).map((client) => ({ ...client, name: client.name.endsWith("a") ? "a" : "b", poolName: client.name, pid: pids.get(client.name) })));
    writeJson(pairEntryFile(pair), { id: pair, clients: clientsPath, agentSocket: agentSocket(pair), runs, appIds: { a: `steam_app_${3516115600 + pair * 2}`, b: `steam_app_${3516115601 + pair * 2}` }, profile, ...(network ? { network } : {}) });
    yield* publishPool(profileText, fps);
    yield* Console.log(network
      ? `pair ${pair}: ${clientName(pair, "a")} running alone with network for solo games (${profile}${fps === undefined ? "" : `, ${fps} fps`}); desktop ${runs.a ?? "?"}`
      : `pair ${pair}: ${clientName(pair, "a")} and ${clientName(pair, "b")} running (${profile}${fps === undefined ? "" : `, ${fps} fps`}); desktops ${runs.a ?? "?"} and ${runs.b ?? "?"}`);
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
  const turnSteps = turnText?.split(",").map(Number);
  if (turnSteps?.some((step) => !Number.isInteger(step) || step < 1)) return yield* new UsageFailure({ problem: "--turn-ms takes whole milliseconds: one period (25) or a repeating cycle (17,17,16)" });
  const computers = yield* number(args, "computers", 0);
  const started = Date.now();
  const result = yield* agent(pair, "/fresh", { map, computers, driver: yield* driverPid, ...(turnSteps === undefined ? {} : { turnSteps }) });
  yield* Console.log(`pair ${pair}: playing ${map} after ${((Date.now() - started) / 1000).toFixed(1)} s; action log ${String(result["log"])}`);
});

const relayed: Command = (args) => Effect.gen(function*() {
  const [map] = args.filter((arg, index) => !arg.startsWith("--") && !args[index - 1]?.startsWith("--"));
  if (map === undefined || !existsSync(map)) return yield* new UsageFailure({ problem: "relayed takes a built map file (MAP.w3x)" });
  const pair = yield* number(args, "pair", 0);
  const turnMs = yield* number(args, "turn-ms", 8);
  const [bin] = flagValues(args, "relay-bin");
  if (bin === undefined) return yield* new UsageFailure({ problem: "relayed takes --relay-bin DIR, the folder holding the relay and relay-agent binaries" });
  const raiseHeadroomMs = wholeFlag(args, "raise-headroom-ms");
  if (raiseHeadroomMs instanceof UsageFailure) return yield* raiseHeadroomMs;
  const started = Date.now();
  const result = yield* agent(pair, "/relayed", { map: resolve(map), relay: resolve(bin, "relay"), agent: resolve(bin, "relay-agent"), turnMs, driver: yield* driverPid, ...(raiseHeadroomMs === undefined ? {} : { raiseHeadroomMs }) });
  yield* Console.log(`pair ${pair}: playing ${map} through a relay after ${((Date.now() - started) / 1000).toFixed(1)} s; logs ${String(result["folder"])}`);
});

const SoloResult = Schema.Struct({ clients: Schema.Array(Schema.Struct({ client: Schema.String, seconds: Schema.Finite })) });

const solo: Command = (args) => Effect.gen(function*() {
  const [map] = args.filter((arg, index) => !arg.startsWith("--") && !args[index - 1]?.startsWith("--"));
  if (map === undefined || !existsSync(map)) return yield* new UsageFailure({ problem: "solo takes a built map file (MAP.w3x)" });
  const chosen = flagValues(args, "pair").map((value) => wholeFlag(["--pair", value], "pair"));
  if (!chosen.every((pair) => typeof pair === "number")) return yield* new UsageFailure({ problem: "--pair takes a pair number" });
  const pairs = chosen.length > 0 ? chosen : ((yield* readPool)?.pairs ?? []).filter(({ agentSocket: socket }) => existsSync(socket)).map(({ id }) => id);
  if (pairs.length === 0) return yield* new LanFailure({ problem: "no pool pair is running; start one with wisp lan pool" });
  const driver = yield* driverPid;
  yield* Effect.forEach(pairs, (pair) => agent(pair, "/solo", { map: resolve(map), driver }).pipe(
    Effect.flatMap(Schema.decodeUnknownEffect(SoloResult)),
    Effect.mapError((failure) => (failure instanceof LanFailure ? failure : new LanFailure({ problem: `pair ${pair}: ${failure.message}` }))),
    Effect.flatMap(({ clients }) => Effect.forEach(clients, ({ client, seconds }) => Console.log(`${client}: playing ${map} alone after ${seconds.toFixed(1)} s`), { discard: true })),
  ), { concurrency: "unbounded", discard: true });
});

const status: Command = (args) => Effect.gen(function*() {
  const known = yield* readPool;
  if (known === undefined) return yield* new LanFailure({ problem: `no pool is running (${poolFile()} is missing); start one with wisp lan pool` });
  const only = wholeFlag(args, "pair");
  if (only instanceof UsageFailure) return yield* only;
  for (const { id } of known.pairs.filter(({ id }) => only === undefined || id === only)) {
    const value = yield* agent(id, "/status").pipe(Effect.catchTag("LanFailure", (failure) => Effect.succeed({ error: failure.problem })));
    yield* Console.log(JSON.stringify(value));
  }
});

const POOL_STOP = "90 seconds";

const stop: Command = (args) => Effect.gen(function*() {
  const pair = yield* number(args, "pair", undefined);
  const holder = poolHolder(pair);
  if (holder === undefined || !alive(holder)) return yield* new LanFailure({ problem: `pair ${pair} has no running pool` });
  const shared = pairsHeldBy(holder).filter((id) => id !== pair);
  if (shared.length > 0) return yield* new LanFailure({ problem: `pair ${pair}'s pool ${holder} also runs pair${shared.length === 1 ? "" : "s"} ${shared.join(", ")}; stop that pool itself to stop them together` });
  yield* Effect.try({ try: () => process.kill(holder, "SIGTERM"), catch: (cause) => new LanFailure({ problem: `signal pool ${holder}: ${describeCause(cause)}` }) });
  const gone = yield* pollUntil(Effect.sync(() => !alive(holder)), { until: (ended) => ended, every: "250 millis", within: POOL_STOP, onTimeout: () => Effect.succeed(false) });
  if (!gone) return yield* new LanFailure({ problem: `pair ${pair}'s pool ${holder} still runs ${POOL_STOP} after SIGTERM` });
  const left = yield* stopPairScopes(pair, outlivedStop);
  if (left.length > 0) return yield* new LanFailure({ problem: `pair ${pair}'s pool ${holder} stopped, but the capacity scope of ${left.join(" and ")} still runs` });
  yield* Console.log(`pair ${pair}: pool ${holder} stopped; none of its games run`);
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
  const refusal = lanPlayRefusal(pair, status["network"] === true, "dummy");
  if (refusal !== undefined) return yield* new LanFailure({ problem: refusal });
  if (status["game"] !== undefined) return yield* new UsageFailure({ problem: `pair ${pair} has a game; end it with lan end before checking its lobby` });
  const clients = status["clients"] as { name: string; pid?: number }[];
  const native = clients.find(({ name }) => name === clientName(pair, "a"));
  if (native?.pid === undefined) return yield* new UsageFailure({ problem: `pair ${pair}'s first client is not running` });
  yield* ensurePackager(mapPackager());
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

const inPairNetwork = (pair: number, command: readonly string[]) => Effect.gen(function*() {
  const state = yield* readJson(join(pairDirectory(pair), "agent.json"), AgentProcess);
  const refusal = lanPlayRefusal(pair, state.network === true, "netem");
  if (refusal !== undefined) return yield* new LanFailure({ problem: refusal });
  const [program = "", ...rest] = yield* Namespaces.use((namespaces) => namespaces.enter(state.pid, ["user", "net"], command, { keepCapabilities: true }));
  const result = yield* collect(ChildProcess.make(program, rest, { stdin: "ignore" })).pipe(Effect.provide(BunServices.layer), Effect.mapError((failure) => new LanFailure({ problem: failure.message })));
  return { exitCode: Number(result.exitCode), stdout: new TextDecoder().decode(result.stdout).trim(), stderr: result.stderr.trim() };
});

const NETEM_USAGE = "netem takes --pair K --rtt MS [--loss PERCENT] [--jitter MS] [--burst] [--udp-port N | --tcp-port N], or off --pair K";

const netemImpairment = (args: readonly string[]): Impairment | UsageFailure => {
  const [rttText] = flagValues(args, "rtt");
  const [lossText = "0"] = flagValues(args, "loss");
  const [jitterText = "0"] = flagValues(args, "jitter");
  const rtt = Number(rttText);
  const loss = Number(lossText);
  const jitter = Number(jitterText);
  const burst = args.includes("--burst");
  if (rttText === undefined || !Number.isFinite(rtt) || rtt < 0) return new UsageFailure({ problem: NETEM_USAGE });
  if (!Number.isFinite(loss) || loss < 0 || loss > 100 || (burst && loss === 100)) return new UsageFailure({ problem: `--loss takes a round-trip percentage from 0 to 100${burst ? ", below 100 with --burst" : ""}` });
  if (!Number.isFinite(jitter) || jitter < 0 || jitter > rtt) return new UsageFailure({ problem: "--jitter takes milliseconds from 0 to the --rtt" });
  const scoped = (["udp", "tcp"] as const).filter((protocol) => args.includes(`--${protocol}-port`));
  if (scoped.length > 1) return new UsageFailure({ problem: "netem takes --udp-port or --tcp-port, not both" });
  const [protocol] = scoped;
  if (protocol === undefined) return { rtt, loss, jitter, burst };
  const port = portFlag(args, 0, { name: `${protocol}-port` });
  return port instanceof UsageFailure ? port : { rtt, loss, jitter, burst, scope: { protocol, port } };
};

const netem: Command = (args) => Effect.gen(function*() {
  const pair = yield* number(args, "pair", undefined);
  const impairment = args[0] === "off" ? undefined : netemImpairment(args);
  if (impairment instanceof UsageFailure) return yield* impairment;
  const cleared = yield* inPairNetwork(pair, CLEAR);
  if (cleared.exitCode !== 0 && !clearedAlready(cleared.stderr)) return yield* new LanFailure({ problem: `pair ${pair}: tc qdisc del: ${cleared.stderr}` });
  if (impairment !== undefined) {
    for (const command of impairCommands(impairment)) {
      const set = yield* inPairNetwork(pair, command);
      if (set.exitCode !== 0) {
        yield* inPairNetwork(pair, CLEAR);
        return yield* new LanFailure({ problem: `pair ${pair}: ${command.join(" ")}: ${set.stderr}` });
      }
    }
    yield* Console.log(`pair ${pair}: ${impairmentSummary(impairment)}`);
  }
  const qdiscs = yield* inPairNetwork(pair, ["tc", "qdisc", "show", "dev", "lo"]);
  yield* Console.log(`pair ${pair}: ${qdiscs.stdout}`);
  if (impairment?.scope !== undefined) {
    const filters = yield* inPairNetwork(pair, ["tc", "filter", "show", "dev", "lo"]);
    yield* Console.log(filters.stdout);
  }
});

export const LAN_USAGE = "setup --from INSTALL [--build BUILD] [--pairs N | --pair K...] | pool [--pairs N | --pair K...] [--pool-profile parity|visual|hfr[,...]] [--fps N] [--seconds S] [--network with one --pair K] | fresh MAP [--pair K] [--computers N] [--turn-ms MS[,MS...]] | solo MAP [--pair K...] | relayed MAP --relay-bin DIR [--pair K] [--turn-ms MS] [--raise-headroom-ms MS] | dummy MAP --program W3GSCLIENT [--pair K] [--count N] | speed N --pair K | netem --pair K --rtt MS [--loss PERCENT] [--jitter MS] [--burst] [--udp-port N | --tcp-port N] | netem off --pair K | status [--pair K] | end --pair K | stop --pair K";

const ownerCheck = poolOwners.pipe(Effect.flatMap((owners) => {
  const refusal = wrongUser(process.getuid?.() ?? 0, owners, ["bun", ...process.argv.slice(1)]);
  return refusal === undefined ? Effect.void : Effect.fail(new LanFailure({ problem: refusal }));
}));

export const lan: Command = (argv) => ownerCheck.pipe(Effect.andThen(Effect.suspend(() => subcommand(argv))));

const subcommand: Command = ([sub, ...args]) => {
  switch (sub) {
    case "setup": return setup(args);
    case "pool": return pool(args);
    case "fresh": return fresh(args);
    case "solo": return solo(args);
    case "relayed": return relayed(args);
    case "dummy": return dummy(args);
    case "status": return status(args);
    case "speed": return speed(args);
    case "netem": return netem(args);
    case "end": return end(args);
    case "stop": return stop(args);
    default: return Effect.fail(new UsageFailure({ problem: `lan takes ${LAN_USAGE}` }));
  }
};
