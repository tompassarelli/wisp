import { appendFileSync, copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import * as BunRuntime from "@effect/platform-bun/BunRuntime";
import * as BunServices from "@effect/platform-bun/BunServices";
import { Cause, Effect, Exit, FiberSet, Layer, Option, Schedule, Schema, Scope } from "effect";
import { platformLayer, runPlatformSync } from "../../platform/layer";
import { ChildProcess, ChildProcessSpawner } from "effect/process";
import { AudioIsolation, GameLauncher, InputInjection, ProcessTable } from "../../platform/services";
import { pollUntil, spawnLogged } from "../hostProcess";
import { type MenuFailure, type MenuSocket, connectMenus, listenForMenus, type MenuReports, playLocalGame } from "../menus";
import { type LanHost, startHost } from "./host";
import { LanFailure, joinLanGame } from "./join";
import { loadLanPlugin } from "./plugin";
import { readMapFacts } from "./map";
import { PAIR_SIDES, poolProfile, agentSocket, audioSinkOf, clientName, clientRoot, documentsOf, exeOf, mapPackager, pairDirectory, poolClientsFile, preferences, prefixOf, reportPort } from "./pool";
import { admissionFile, nativeCommand } from "./admission";

const argument = (name: string) => {
  const at = process.argv.indexOf(`--${name}`);
  return at < 0 ? undefined : process.argv[at + 1];
};
const pair = Number(argument("pair") ?? "0");
const fpsText = argument("fps");
const profile = poolProfile(argument("pool-profile") ?? "parity", fpsText === undefined ? undefined : Number(fpsText));
const packager = argument("packager") ?? mapPackager();
const directory = pairDirectory(pair);
const agentLog = join(directory, "agent.log");
const say = (text: string) => appendFileSync(agentLog, `${new Date().toISOString()} ${text}\n`);

const runB = argument("run-b");
const runs: Record<string, string | undefined> = { a: process.env["PRIVATE_DESKTOP_RUN"], b: runB };

const displayOf = (run: string | undefined): Record<string, string> => {
  if (run === undefined) return {};
  return { ...runPlatformSync(InputInjection.use((input) => Effect.succeed(input.sessionEnvironment(run)))), PRIVATE_DESKTOP_RUN: run };
};
const clients = PAIR_SIDES.map((side) => ({ side, name: clientName(pair, side), port: reportPort(pair, side), windowX: 0, env: side === "b" ? displayOf(runB) : {} }));
type PoolClient = (typeof clients)[number];

const until = <E, R>(check: Effect.Effect<boolean, E, R>, limit: `${number} seconds`) =>
  pollUntil(check, { until: (held) => held, every: "250 millis", within: limit, onTimeout: () => Effect.succeed(false) });

const launch = (capacity: string, client: PoolClient) => Effect.gen(function*() {
  // A second runtime on a live prefix joins its wineserver and dies: a game left from before must be stopped first.
  const table = yield* ProcessTable;
  const left = yield* table.games(prefixOf(client.name));
  if (left.length > 0) {
    say(`${client.name} still runs (pid ${left.map(({ pid }) => pid).join(", ")}); stopping it first`);
    for (const { pid } of left) process.kill(pid, "SIGTERM");
    yield* until(table.games(prefixOf(client.name)).pipe(Effect.map((games) => games.length === 0)), "5 seconds");
  }
  mkdirSync(documentsOf(client.name), { recursive: true });
  writeFileSync(join(documentsOf(client.name), "War3Preferences.txt"), preferences(profile, client.windowX));
  const appId = String(3516115600 + pair * 2 + PAIR_SIDES.indexOf(client.side));

  const launched = yield* GameLauncher.use((launcher) => launcher.inPrefix({ root: clientRoot(client.name), exe: exeOf(client.name), args: ["-launch", "-windowmode", "windowed", "-nowfpause"], appId, sessionBus: true }));
  const gameRuntime = client.env["XDG_RUNTIME_DIR"] ?? process.env["XDG_RUNTIME_DIR"] ?? launched.env["XDG_RUNTIME_DIR"] ?? "";
  const [command = process.execPath, ...native] = yield* nativeCommand(capacity, client.name, gameRuntime);
  const sound = yield* AudioIsolation.use((audio) => audio.sink(client.name, audioSinkOf(client.name)));
  if (sound.problem !== undefined) say(sound.problem);
  const env = { ...client.env, ...sound.env, ...launched.env, SteamGameId: appId };
  const errFile = join(directory, `${client.name}.err`);
  const game = yield* spawnLogged(ChildProcess.make(command, [...native, ...launched.command], {
    env, extendEnv: true, stdin: "ignore", forceKillAfter: "15 seconds",
  }), { stdout: join(directory, `${client.name}.out`), stderr: errFile });
  const early = yield* game.handle.exitCode.pipe(Effect.map(Number), Effect.orElseSucceed(() => -1), Effect.timeoutOption("5 seconds"));
  if (Option.isSome(early)) {
    yield* game.written;
    const said = early.value === 75 ? readFileSync(errFile, "utf8") : "";
    const deferred = /"decision":"DEFER","reason":"([A-Z_]+)"/.exec(said);
    if (deferred !== null) {
      writeFileSync(admissionFile(directory), JSON.stringify({ reason: `${client.name}: ${deferred[1]}` }));
      return yield* new LanFailure({ problem: `${client.name}: waiting for native capacity (${deferred[1]})` });
    }
    return yield* new LanFailure({ problem: `${client.name}: its native launcher exited with ${early.value}` });
  }
  say(`launched ${client.name}`);
  return game.handle;
});

interface Game {
  readonly id: string;
  readonly log: string;
  readonly host: LanHost;
  readonly map: string;

  readonly scope: Scope.Closeable;
}

const FreshRequest = Schema.fromJsonString(Schema.Struct({ map: Schema.String, turnMs: Schema.optionalKey(Schema.Finite), computers: Schema.optionalKey(Schema.Finite) }));
const SoloRequest = Schema.fromJsonString(Schema.Struct({ map: Schema.String }));
const SpeedRequest = Schema.fromJsonString(Schema.Struct({ speed: Schema.Finite }));

const agent = Effect.gen(function*() {
  const capacity = argument("capacity");
  if (capacity === undefined) return yield* new LanFailure({ problem: "pairAgent requires --capacity MACHINE_CAPACITY_HELPER" });
  mkdirSync(directory, { recursive: true });
  const agentScope = yield* Effect.scope;
  const table = yield* ProcessTable;
  const gamePid = (name: string) => table.games(prefixOf(name)).pipe(Effect.map((games) => games[0]?.pid), Effect.orElseSucceed(() => undefined));

  const games: { readonly isRunning: Effect.Effect<boolean, unknown> }[] = [];
  yield* Effect.forEach(clients, (client) => launch(capacity, client).pipe(Effect.map((handle) => { games.push(handle); })), { discard: true });

  const placer = yield* (yield* InputInjection).placer;
  if (Option.isNone(placer)) say("no window placement: game windows keep the size and place the desktop gives them");
  else {
    const placeWindows = Effect.forEach(clients, (client) => Effect.gen(function*() {
      const placed = yield* placer.value(client.env, "Warcraft III", { x: client.windowX, y: 0, width: profile.width, height: profile.height });
      for (let window = 0; window < placed; window++) say(`placed ${client.name}'s window at ${client.windowX},0, ${profile.width}x${profile.height}`);
    }), { discard: true });
    yield* Effect.forkScoped(Effect.repeat(placeWindows, Schedule.spaced("3 seconds")));
  }

  const reports = new Map<string, MenuReports>();
  for (const client of clients) {
    const sentLog = join(directory, `${client.name}-menus.log`);
    const onSent = (sent: { readonly message: string; readonly payload?: unknown }) =>
      appendFileSync(sentLog, `${new Date().toISOString()} ${sent.payload === undefined ? sent.message : `${sent.message} ${JSON.stringify(sent.payload)}`}\n`);
    reports.set(client.name, yield* listenForMenus(client.port, onSent));
  }

  const menusOf = (name: string): Effect.Effect<MenuSocket, LanFailure | MenuFailure, Scope.Scope> => Effect.gen(function*() {
    const report = reports.get(name);
    if (report === undefined) return yield* new LanFailure({ problem: `no listener for ${name}` });

    yield* report.waitForAddress(120);
    const latest = yield* report.address;
    if (latest === undefined) return yield* new LanFailure({ problem: `${name}'s menus never reported` });
    return yield* connectMenus(latest);
  });

  let game: Game | undefined;
  const endGame = Effect.suspend(() => {
    const ending = game;
    if (ending === undefined) return Effect.void;
    game = undefined;

    return Scope.close(ending.scope, Exit.void).pipe(Effect.andThen(Effect.sync(() => say(`ended ${ending.id}`))));
  });

  const fresh = (mapFile: string, turnMs: number | undefined, computers: number | undefined) => Effect.scoped(Effect.gen(function*() {
    yield* endGame;
    const id = new Date().toISOString().replace(/[:.]/g, "-");
    const folder = join(directory, "games", id);
    mkdirSync(folder, { recursive: true });
    const inGame = `Maps\\Wisp\\${basename(mapFile)}`;
    for (const client of clients) {
      const target = join(documentsOf(client.name), "Maps/Wisp", basename(mapFile));
      mkdirSync(join(target, ".."), { recursive: true });
      if (existsSync(target)) rmSync(target);
      copyFileSync(mapFile, target);
    }
    const map = yield* readMapFacts(mapFile, packager, inGame);
    const log = join(folder, "actions.log");
    const packets = join(folder, "packets.log");
    const started = Date.now();
    writeFileSync(log, `# wisp lan host: pair ${pair}, map ${inGame}, clients ${clients.map(({ name }) => name).join(" ")}; seconds since ${new Date(started).toISOString()} (${started})\n`);
    const scope = yield* Scope.fork(agentScope);
    const host = yield* startHost({
      buildId: (yield* loadLanPlugin).version(exeOf(clients[0]!.name)),
      map,
      gameName: `wisp-${pair}-${id.slice(11, 19)}`,
      clients: clients.map(({ name }) => name),
      ...(turnMs === undefined ? {} : { turnMs }),
      ...(computers === undefined ? {} : { computers }),
      log: (line) => appendFileSync(log, `${line}\n`),
      onPacket: (direction, label, bytes) => {

        if (bytes[1] === 0x0c && bytes.length <= 6) return;
        appendFileSync(packets, `${((Date.now() - started) / 1000).toFixed(3)} ${direction} ${label} ${Buffer.from(bytes).toString("hex")}\n`);
      },
    }).pipe(Scope.provide(scope));
    game = { id, log, host, map: mapFile, scope };
    say(`game ${id}: hosting ${inGame} on port ${host.port}`);
    for (const client of clients) {
      const pid = yield* gamePid(client.name);
      if (pid === undefined) return yield* new LanFailure({ problem: `${client.name} isn't running` });
      const menus = yield* menusOf(client.name);
      yield* (yield* loadLanPlugin).enableLan(pid, exeOf(client.name), menus, say);
      yield* joinLanGame(menus, `wisp-${pair}-${id.slice(11, 19)}`);
      yield* until(Effect.sync(() => host.status().players.some(({ label, connected }) => label === client.name && connected)), "20 seconds");
    }
    const playing = yield* pollUntil(Effect.sync(() => host.status().phase), {
      until: (phase) => phase === "playing" || phase === "over", every: "250 millis", within: "120 seconds", onTimeout: () => Effect.void,
    });
    if (playing === "playing") return { log, game: id };
    return yield* new LanFailure({ problem: `the match didn't start: ${JSON.stringify(host.status())}` });
  }));

  const solo = (mapFile: string) => Effect.scoped(Effect.gen(function*() {
    yield* endGame;
    const started = Date.now();
    return yield* Effect.forEach(clients, (client) => Effect.gen(function*() {
      const target = join(documentsOf(client.name), "Maps/Wisp", basename(mapFile));
      mkdirSync(join(target, ".."), { recursive: true });
      if (existsSync(target)) rmSync(target);
      copyFileSync(mapFile, target);
      if ((yield* gamePid(client.name)) === undefined) return yield* new LanFailure({ problem: `${client.name} isn't running` });
      const menus = yield* menusOf(client.name);
      yield* playLocalGame(menus, { folder: "Wisp", file: basename(mapFile), playerName: client.name });
      const seconds = (Date.now() - started) / 1000;
      say(`${client.name}: solo ${basename(mapFile)} playing after ${seconds.toFixed(1)} s`);
      return { client: client.name, seconds };
    }), { concurrency: "unbounded" });
  }));

  const run = yield* FiberSet.makeRuntimePromise<ChildProcessSpawner.ChildProcessSpawner>();
  const decode = <A>(schema: Schema.Decoder<A>, request: Request) =>
    Effect.tryPromise({ try: () => request.text(), catch: (cause) => new LanFailure({ problem: String(cause) }) }).pipe(
      Effect.flatMap(Schema.decodeUnknownEffect(schema)),
      Effect.mapError((failure) => new LanFailure({ problem: `bad request: ${failure.message}` })),
    );
  const handle = (request: Request) => Effect.gen(function*() {
    const url = new URL(request.url);
    if (url.pathname === "/status") {
      return Response.json({
        pair,
        profile: profile.name,
        fps: profile.maxFps,
        clients: yield* Effect.forEach(clients, ({ name }) => gamePid(name).pipe(Effect.map((pid) => ({ name, pid, documents: documentsOf(name) })))),
        game: game === undefined ? undefined : { id: game.id, log: game.log, map: game.map, ...game.host.status() },
      });
    }
    if (url.pathname === "/fresh" && request.method === "POST") {
      const body = yield* decode(FreshRequest, request);
      if (!existsSync(body.map)) return Response.json({ error: `no map at ${body.map}` }, { status: 400 });
      const exit = yield* Effect.exit(fresh(body.map, body.turnMs, body.computers));
      if (Exit.isSuccess(exit)) return Response.json(exit.value);
      say(`fresh failed: ${String(exit.cause)}`);
      return Response.json({ error: String(exit.cause) }, { status: 500 });
    }
    if (url.pathname === "/solo" && request.method === "POST") {
      const body = yield* decode(SoloRequest, request);
      if (!existsSync(body.map)) return Response.json({ error: `no map at ${body.map}` }, { status: 400 });
      const exit = yield* Effect.exit(solo(body.map));
      if (Exit.isSuccess(exit)) return Response.json({ clients: exit.value });
      say(`solo failed: ${String(exit.cause)}`);
      return Response.json({ error: String(exit.cause) }, { status: 500 });
    }
    if (url.pathname === "/end" && request.method === "POST") {
      yield* endGame;
      return Response.json({ ended: true });
    }
    if (url.pathname === "/speed" && request.method === "POST") {
      const body = yield* decode(SpeedRequest, request);
      if (game === undefined || game.host.status().phase !== "playing") return Response.json({ error: "no match is playing" }, { status: 400 });
      if (!Number.isFinite(body.speed) || body.speed < 1 || body.speed > 16) return Response.json({ error: "speed must be between 1 and 16" }, { status: 400 });
      yield* game.host.setSpeed(body.speed);
      return Response.json(game.host.status());
    }
    return new Response("not found", { status: 404 });
  }).pipe(Effect.catchTag("LanFailure", (failure) => Effect.succeed(Response.json({ error: failure.problem }, { status: 400 }))));

  rmSync(agentSocket(pair), { force: true });
  yield* Effect.acquireRelease(
    Effect.sync(() => Bun.serve({ unix: agentSocket(pair), fetch: (request) => run(handle(request)) })),
    (server) => Effect.promise(() => server.stop(true)),
  );
  yield* Effect.addFinalizer(() => endGame);
  writeFileSync(join(directory, "agent.json"), `${JSON.stringify({ pid: process.pid, socket: agentSocket(pair), profile: profile.name, fps: profile.maxFps, runs })}\n`);
  say(`agent on ${agentSocket(pair)}`);

  const sessionPid = Number(argument("session-pid") ?? "0");
  if (sessionPid <= 0) return yield* Effect.never;
  const alive = () => {
    try {
      process.kill(sessionPid, 0);
      return true;
    } catch {
      return false;
    }
  };
  yield* Effect.sync(alive).pipe(Effect.repeat({ schedule: Schedule.spaced("2 seconds"), while: (running) => running }));
  say(`stopping: the pair session ${sessionPid} ended`);
}).pipe(Effect.onInterrupt(() => Effect.sync(() => say("stopping: asked to"))));

BunRuntime.runMain(Effect.scoped(agent).pipe(
  Effect.tapCause((cause) => (Cause.hasInterruptsOnly(cause) ? Effect.void : Effect.sync(() => console.error(Cause.pretty(cause))))),
  Effect.provide(Layer.merge(BunServices.layer, platformLayer())),
), { disableErrorReporting: true });
