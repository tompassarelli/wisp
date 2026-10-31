import { existsSync, readFileSync, rmSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { userInfo } from "node:os";
import * as BunServices from "@effect/platform-bun/BunServices";
import { Console, Effect, Exit, Schema, Scope } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/process";
import { pollUntil, spawnLogged } from "../process/hostProcess";
import { releaseLocalLeases } from "./lanQueue";
import { type Command, UsageFailure, describeCause, flagValues, wholeFlag } from "../cli/command";
import { LanFailure } from "../lan/join";
import { markOf, orphaned } from "../lan/claim";
import { type Custodian, holdPair, sessionEnded, sessionProcess } from "../lan/custody";
import { lanPluginProblem } from "../lan/plugin";
import { recordPassed } from "../lan/pairHealth";
import { IDLE_POLL_MS, RELEASE_AFTER_SECONDS, holdPairs } from "../lan/poolRelease";
import { ensurePackager } from "../compile/mapBuild";
import {
  agentSocket, alive, clientName, mapPackager, networkFlagProblem, pairClients, pairSides, pairDirectory, pairEntryFile, pairsHeldBy, readClaim, livePairs, poolClientsFile, poolFile, poolHolder, readPool, stopAgent, stopPairScopes, writeJson, writePoolClients,
} from "../lan/pool";
import { PROFILES } from "../contract/clientProfiles";
import { deferredExit, lastQueued, unadmitted } from "../lan/admission";
import { AgentStatus, clearLastStart, clientsRunning, outlivedStop, pairFault } from "../lan/pairStart";
import { agent, number, readJson } from "./lanAgent";

const SESSION = join(import.meta.dir, "../lan/pairSession.ts");

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

const AgentFile = Schema.fromJsonString(Schema.Struct({ runs: Schema.optionalKey(Schema.Struct({ a: Schema.optionalKey(Schema.String), b: Schema.optionalKey(Schema.String) })) }));

const RESERVED = /"decision":"RESERVED"/;

const DECISION_GRACE_SECONDS = 60;

const startPair = (pair: number, custody: { readonly custodian: Custodian; readonly queued: boolean }, profile: string, launcher: string, capacity: string, waitSeconds: number, network: boolean, fps?: number) => {
  const directory = pairDirectory(pair);
  const sessionErr = join(directory, "session.err");
  const started = Effect.gen(function*() {
    yield* clearLastStart(pair, network);

    const scope = yield* Scope.fork(yield* Effect.scope);
    return yield* Effect.gen(function*() {

      const session = yield* spawnLogged(ChildProcess.make(process.execPath, [capacity, "session", "--class", "native", "--memory-gib", "1", "--new-clients", String(pairSides(network).length), ...(waitSeconds > 0 ? ["--wait-seconds", String(waitSeconds)] : []), "--owner", `wisp-lan-pair-${pair}`, "--", process.execPath, SESSION, "--pair", String(pair), "--pool-profile", profile, "--launcher", launcher, "--capacity", capacity, ...(fps === undefined ? [] : ["--fps", String(fps)]), ...(network ? ["--network"] : [])], { stdin: "ignore", forceKillAfter: "90 seconds" }), {
        stdout: join(directory, "session.out"),
        stderr: sessionErr,
      });
      yield* Effect.addFinalizer(() => stopAgent(pair).pipe(Effect.andThen(stopPairScopes(pair, outlivedStop))));
      const ended = Effect.gen(function*() {
        if (yield* session.handle.isRunning.pipe(Effect.orElseSucceed(() => false))) return;
        const code = yield* session.handle.exitCode.pipe(Effect.map(Number), Effect.orElseSucceed(() => -1));
        yield* session.written.pipe(Effect.timeoutOption("1 second"));
        if (!deferredExit(code)) return yield* pairFault(pair, `its session exited with ${code}; see ${sessionErr} and desktop-*.err`);
        return yield* new LanFailure({ problem: unadmitted(readFileSync(sessionErr, "utf8"), waitSeconds) });
      });

      let queued: string | undefined;
      const reserved = Effect.gen(function*() {
        yield* ended;
        const said = existsSync(sessionErr) ? readFileSync(sessionErr, "utf8") : "";
        if (RESERVED.test(said)) return true;
        const reason = lastQueued(said);
        if (reason !== undefined && reason !== queued) yield* Console.log(`pair ${pair}: waiting in the capacity helper's queue (${reason})`);
        queued = reason ?? queued;
        return false;
      });
      const decided = waitSeconds + DECISION_GRACE_SECONDS;
      yield* pollUntil(reserved, {
        until: (admitted) => admitted, every: "1 second", within: `${decided} seconds`,
        onTimeout: () => Effect.fail(new LanFailure({ problem: `the capacity helper neither admitted nor deferred it within ${decided} s; see ${sessionErr}` })),
      });

      yield* clientsRunning(pair, network, waitSeconds, ended);
      return { ...session.handle, stop: Scope.close(scope, Exit.void) };
    }).pipe(Scope.provide(scope), Effect.onError((cause) => Scope.close(scope, Exit.failCause(cause))));
  });
  return holdPair(pair, custody.custodian, custody.queued).pipe(Effect.andThen(started), Effect.mapError((failure) => new LanFailure({ problem: `pair ${pair}: ${failure.message}` })));
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

/** Records running pair K in its `pair.json`, `clients.json` and the shared pool files, and undoes that once `stop` has stopped it. */
const registerPair = (pair: number, stop: Effect.Effect<void>, { profile, profileText, network, fps }: { readonly profile: string; readonly profileText: string; readonly network: boolean; readonly fps?: number }) => Effect.gen(function*() {
  const agentFile = join(pairDirectory(pair), "agent.json");
  const runs = existsSync(agentFile) ? (yield* readJson(agentFile, AgentFile)).runs ?? {} : {};

  yield* Effect.addFinalizer(() => stop.pipe(Effect.andThen(Effect.sync(() => {
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
});

/** Runs the pool until Ctrl-C, `--seconds`, or `--release-idle` seconds after its checks end; succeeds with the pairs it let go because their checks ended. */
const runPool = (args: readonly string[], custodian: Custodian) => Effect.gen(function*() {
  const missing = lanPluginProblem();
  if (missing !== undefined) return yield* new LanFailure({ problem: `${missing}. Install the plugin there, then run wisp lan pool again` });
  const pairs = yield* number(args, "pairs", 1);
  const seconds = yield* number(args, "seconds", 0);
  const waitSeconds = yield* number(args, "wait", 1800);
  const releaseAfter = yield* number(args, "release-idle", RELEASE_AFTER_SECONDS);
  const idlePollMs = yield* number(args, "idle-poll-ms", IDLE_POLL_MS);
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
  const sessions: { readonly exitCode: Effect.Effect<unknown, unknown> }[] = [];
  const running: number[] = [];

  const chosen = flagValues(args, "pair").map((value) => wholeFlag(["--pair", value], "pair"));
  if (!chosen.every((pair) => typeof pair === "number")) return yield* new UsageFailure({ problem: "--pair takes a pair number" });
  const order = chosen.length > 0 ? chosen : Array.from({ length: pairs }, (_, index) => index);
  for (const [admitted, pair] of order.entries()) {
    const profile = profileOf(pair);
    const started = yield* startPair(pair, { custodian, queued: args.includes("--queue") }, profile, launcher, capacity, waitSeconds, network, fps).pipe(Effect.catchTag("LanFailure", (failure) => Effect.succeed(failure)));
    if (started instanceof LanFailure) {

      yield* Console.log(`${started.problem}; the pool stays at ${admitted} pair${admitted === 1 ? "" : "s"}; waiting: ${order.slice(admitted).join(", ")}`);
      if (admitted === 0) return yield* started;
      break;
    }
    sessions.push(started);
    yield* registerPair(pair, started.stop, { profile, profileText, network, ...(fps === undefined ? {} : { fps }) });
    running.push(pair);
  }
  yield* Console.log(`pool: ${poolFile()}; clients: ${poolClientsFile()}. Ctrl-C stops it.`);

  const ended = Effect.forEach(sessions, (session) => Effect.ignore(session.exitCode), { concurrency: "unbounded", discard: true });
  const lasting = seconds > 0 ? Effect.timeoutOption(ended, `${seconds} seconds`) : ended;
  return yield* holdPairs(lasting, (pair) => agent(pair, "/status"), running, releaseAfter, idlePollMs, custodian.owner);
}).pipe(Effect.scoped, Effect.provide(BunServices.layer));

const custodianOf = (args: readonly string[]) => Effect.suspend(() => {
  const session = process.env["NORTH_FLEET_SESSION"] ?? "";
  const [owner = session] = flagValues(args, "owner");
  const ownerPid = wholeFlag(args, "owner-pid", { min: 1 });
  if (ownerPid instanceof UsageFailure) return Effect.fail(ownerPid);
  const agent = ownerPid !== undefined ? markOf(ownerPid) : session === "" ? undefined : sessionProcess(session);
  if (ownerPid !== undefined && agent === undefined) return Effect.fail(new UsageFailure({ problem: `--owner-pid ${ownerPid} names no running process` }));
  return Effect.succeed<Custodian>({ session, owner, ...(agent === undefined ? {} : { agent }) });
});

export const pool: Command = (args) => custodianOf(args).pipe(Effect.flatMap((custodian) => Effect.raceFirst(runPool(args, custodian).pipe(Effect.flatMap(releaseLocalLeases)), sessionEnded(custodian))));

export const status: Command = (args) => Effect.gen(function*() {
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

export const stop: Command = (args) => Effect.gen(function*() {
  const pair = yield* number(args, "pair", undefined);
  const holder = poolHolder(pair);
  if (holder === undefined || !alive(holder)) return yield* new LanFailure({ problem: `pair ${pair} has no running pool` });
  const claim = readClaim(pair);
  const shared = pairsHeldBy(holder).filter((id) => id !== pair);
  if (shared.length > 0 && !(claim !== undefined && orphaned(claim))) return yield* new LanFailure({ problem: `pair ${pair}'s pool ${holder} also runs pair${shared.length === 1 ? "" : "s"} ${shared.join(", ")}; stop that pool itself to stop them together` });
  yield* Effect.try({ try: () => process.kill(holder, "SIGTERM"), catch: (cause) => new LanFailure({ problem: `signal pool ${holder}: ${describeCause(cause)}` }) });
  const gone = yield* pollUntil(Effect.sync(() => !alive(holder)), { until: (ended) => ended, every: "250 millis", within: POOL_STOP, onTimeout: () => Effect.succeed(false) });
  if (!gone) return yield* new LanFailure({ problem: `pair ${pair}'s pool ${holder} still runs ${POOL_STOP} after SIGTERM` });
  const next = poolHolder(pair);
  if (next !== undefined && next !== holder) return yield* Console.log(`pair ${pair}: pool ${holder} stopped; pool ${next} has taken the pair`);
  const left = yield* stopPairScopes(pair, outlivedStop);
  if (left.length > 0) return yield* new LanFailure({ problem: `pair ${pair}'s pool ${holder} stopped, but the capacity scope of ${left.join(" and ")} still runs` });
  yield* Console.log(`pair ${pair}: pool ${holder} stopped; none of its games run`);
});

/** The health check that returns a pair to the lease queue: starts it in line behind other pools and passes once both its fresh clients run. */
export const check: Command = (args) => custodianOf(args).pipe(Effect.flatMap((custodian) => Effect.gen(function*() {
  const missing = lanPluginProblem();
  if (missing !== undefined) return yield* new LanFailure({ problem: missing });
  const pair = yield* number(args, "pair", undefined);
  const [profile = "parity"] = flagValues(args, "pool-profile");
  if (PROFILES[profile] === undefined) return yield* new UsageFailure({ problem: `--pool-profile takes ${Object.keys(PROFILES).join(" or ")}` });
  const started = yield* startPair(pair, { custodian, queued: true }, profile, yield* desktopLauncher(args), yield* capacityHelper(args), yield* number(args, "wait", 1800), false);
  recordPassed(pair);
  yield* started.stop;
  yield* Console.log(`pair ${pair}: both clients ran; healthy, and the lease queue offers it again`);
}).pipe(Effect.scoped, Effect.provide(BunServices.layer))));
