import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import * as BunRuntime from "@effect/platform-bun/BunRuntime";
import * as BunServices from "@effect/platform-bun/BunServices";
import { Cause, Duration, Effect, Exit, Fiber, FiberSet, FileSystem, Layer, Option, Schema, Scope } from "effect";
import { platformLayer, runPlatformSync } from "../os/platform/layer";
import { ChildProcess, ChildProcessSpawner } from "effect/process";
import { AudioIsolation, GameLauncher, InputInjection, ProcessTable } from "../os/platform/services";
import { UsageFailure, flagValues, wholeFlag } from "../cli/command";
import { pollUntil, spawnLogged } from "../cli/hostProcess";
import { type MenuFailure, type MenuSocket, connectMenus, listenForMenus, type MenuReports, playLocalGame, type SentMessage } from "../play/menus";
import { type LanHost, startHost } from "./host";
import { LanFailure, joinLanGame } from "./join";
import { loadLanPlugin } from "./plugin";
import { mapCopies, mapFactsLine, readMapFacts } from "./map";
import { relayedStatus } from "./relayedStatus";
import { ALARM_AFTER_MS, agentPidFile, confirmToplevel, type Driver, MENUS_DEADLINE, TOPLEVEL_DEADLINE, WINDOW_DEADLINE, WINDOW_RELAUNCHES, alive, launchUntilShown, reachedMenus, PAIR_SIDES, alarmLog, driverVerdict, idleness, lanPlayRefusal, pairFlags, pairSides, agentSocket, clientLease, clientLog, stopClientScope, audioSinkOf, clientName, clientRoot, clientRun, documentsOf, exeOf, mapPackager, pairDirectory, poolClientsFile, prefixOf, reportPort } from "./pool";
import { preferences, windowSize } from "../os/warcraft/clientProfiles";
import { admissionFile, capacityDeferral, deferredExit, nativeCommand } from "./admission";
import { DesktopFailure, ToplevelMissing } from "../os/warcraft/desktopClient";

const argument = (name: string) => flagValues(process.argv, name)[0];
const { pair, profile, network } = pairFlags(process.argv);
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
const clients = pairSides(network).map((side) => ({ side, name: clientName(pair, side), port: reportPort(pair, side), windowX: 0, env: side === "b" ? displayOf(runB) : {} }));
type PoolClient = (typeof clients)[number];

const until = <E, R>(check: Effect.Effect<boolean, E, R>, limit: `${number} seconds`) =>
  pollUntil(check, { until: (held) => held, every: "250 millis", within: limit, onTimeout: () => Effect.succeed(false) });

const launchedAt = new Map<string, number>();

const stopClient = (client: PoolClient) => stopClientScope(pair, client.name, (lease) => Effect.sync(() => say(`${client.name} outlived its stop (lease ${lease}); killing its scope`)));

const launch = (capacity: string, client: PoolClient) => Effect.gen(function*() {
  // A second runtime on a live prefix joins its wineserver and dies: a game left from before must be stopped first.
  if (!(yield* stopClient(client))) return yield* new LanFailure({ problem: `${client.name}'s last capacity scope (lease ${clientLease(pair, client.name)}) outlived its stop` });
  const left = yield* (yield* ProcessTable).games(prefixOf(client.name));
  if (left.length > 0) return yield* new LanFailure({ problem: `${client.name} still runs outside its last capacity scope (pid ${left.map(({ pid }) => pid).join(", ")}); its own owner must stop it` });
  mkdirSync(documentsOf(client.name), { recursive: true });
  writeFileSync(join(documentsOf(client.name), "War3Preferences.txt"), preferences(profile, client.windowX));
  const appId = String(3516115600 + pair * 2 + PAIR_SIDES.indexOf(client.side));

  const launched = yield* GameLauncher.use((launcher) => launcher.inPrefix({ root: clientRoot(client.name), exe: exeOf(client.name), args: ["-launch", "-windowmode", "windowed", "-nowfpause"], appId, sessionBus: true }));
  const gameRuntime = client.env["XDG_RUNTIME_DIR"] ?? process.env["XDG_RUNTIME_DIR"] ?? launched.env["XDG_RUNTIME_DIR"] ?? "";
  const [command = process.execPath, ...native] = yield* nativeCommand(capacity, client.name, gameRuntime);
  const sound = yield* AudioIsolation.use((audio) => audio.sink(client.name, audioSinkOf(client.name)));
  if (sound.problem !== undefined) say(sound.problem);
  const env = { ...client.env, ...sound.env, ...launched.env, SteamGameId: appId };
  const errFile = clientLog(pair, client.name);
  const game = yield* spawnLogged(ChildProcess.make(command, [...native, ...launched.command], {
    env, extendEnv: true, stdin: "ignore", forceKillAfter: "15 seconds",
  }), { stdout: join(directory, `${client.name}.out`), stderr: errFile });
  yield* Effect.addFinalizer(() => stopClient(client));
  const early = yield* game.handle.exitCode.pipe(Effect.map(Number), Effect.orElseSucceed(() => -1), Effect.timeoutOption("5 seconds"));
  if (Option.isSome(early)) {
    yield* game.written;
    const deferred = deferredExit(early.value) ? capacityDeferral(readFileSync(errFile, "utf8")) : undefined;
    if (deferred !== undefined) {
      writeFileSync(admissionFile(directory), JSON.stringify({ reason: `${client.name}: ${deferred.reason}` }));
      return yield* new LanFailure({ problem: `${client.name}: waiting for native capacity (${deferred.reason})` });
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

const FreshRequest = Schema.fromJsonString(Schema.Struct({ map: Schema.String, turnSteps: Schema.optionalKey(Schema.Array(Schema.Int)), computers: Schema.optionalKey(Schema.Finite), driver: Schema.optionalKey(Schema.Int) }));
const SoloRequest = Schema.fromJsonString(Schema.Struct({ map: Schema.String, driver: Schema.optionalKey(Schema.Int) }));
const SpeedRequest = Schema.fromJsonString(Schema.Struct({ speed: Schema.Finite }));
const RelayedRequest = Schema.fromJsonString(Schema.Struct({ map: Schema.String, relay: Schema.String, agent: Schema.String, turnMs: Schema.Int, raiseHeadroomMs: Schema.optionalKey(Schema.Int), driver: Schema.optionalKey(Schema.Int) }));


const agent = Effect.gen(function*() {
  const capacity = argument("capacity");
  if (capacity === undefined) return yield* new LanFailure({ problem: "pairAgent requires --capacity MACHINE_CAPACITY_HELPER" });
  mkdirSync(directory, { recursive: true });
  writeFileSync(agentPidFile(pair), `${process.pid}\n`);
  const agentScope = yield* Effect.scope;
  const copyMap = yield* mapCopies(clients.map(({ name }) => join(documentsOf(name), "Maps/Wisp")));
  const table = yield* ProcessTable;
  const gameRun = (name: string) => table.games(prefixOf(name)).pipe(Effect.map((games) => games[0]?.pid), Effect.orElseSucceed(() => undefined), Effect.map((pid) => clientRun(pid, documentsOf(name), launchedAt.get(name))));
  const gamePid = (name: string) => gameRun(name).pipe(Effect.map(({ pid }) => pid));

  const reports = new Map<string, MenuReports>();
  for (const client of clients) {
    const sentLog = join(directory, `${client.name}-menus.log`);
    const onSent = (sent: SentMessage) =>
      appendFileSync(sentLog, `${new Date().toISOString()} ${sent.payload === undefined ? sent.message : `${sent.message} ${JSON.stringify(sent.payload)}`}\n`);
    reports.set(client.name, yield* listenForMenus(client.port, onSent));
  }

  const windows = yield* (yield* InputInjection).windowTools;
  const start = (client: PoolClient) => Option.isNone(windows) ? launch(capacity, client) : launchUntilShown({
    launch: launch(capacity, client),
    shown: () => pollUntil(windows.value.shown(client.env, "Warcraft III"), { until: (shown) => shown, every: "1 second", within: WINDOW_DEADLINE, onTimeout: () => Effect.succeed(false) }).pipe(
      Effect.catchTag("DesktopFailure", (failure) => Effect.sync(() => {
        say(`${client.name}: can't look for its window (${String(failure.cause)}); keeping this launch`);
        return true;
      })),
    ),
    stop: () => stopClient(client).pipe(Effect.asVoid),
    relaunching: (launches) => Effect.sync(() => say(`${client.name} showed no window within ${WINDOW_DEADLINE}; relaunching (${launches}/${WINDOW_RELAUNCHES})`)),
    exhausted: (launches) => new LanFailure({ problem: `${client.name} showed no window within ${WINDOW_DEADLINE} in ${launches} launches` }),
  });
  const games: { readonly isRunning: Effect.Effect<boolean, unknown> }[] = [];
  yield* Effect.forEach(clients, (client) => start(client).pipe(Effect.map((handle) => { games.push(handle); })), { discard: true });

  if (Option.isNone(windows)) say("no window placement: game windows keep the size and place the desktop gives them");
  else {
    const placeWindows = Effect.forEach(clients, (client) => Effect.gen(function*() {
      const placed = yield* windows.value.place(client.env, "Warcraft III", { x: client.windowX, y: 0, ...windowSize(profile) });
      for (let window = 0; window < placed; window++) say(`placed ${client.name}'s window at ${client.windowX},0, ${windowSize(profile).width}x${windowSize(profile).height}`);
    }), { discard: true });
    yield* Effect.forkScoped(pollUntil(placeWindows, { every: "3 seconds" }));
  }

  yield* Effect.forEach([...reports], ([name, report]) => Effect.gen(function*() {
    const reached = yield* pollUntil(report.sent.pipe(Effect.map(reachedMenus)), { until: (reached) => reached, every: "1 second", within: MENUS_DEADLINE, onTimeout: () => Effect.succeed(false) });
    say(reached ? `${name} reached its login doors` : `${name} showed no login doors within ${MENUS_DEADLINE}; going on`);
  }), { concurrency: "unbounded", discard: true });

  if (Option.isSome(windows)) yield* Effect.forEach(clients, (client) => confirmToplevel({
    listed: pollUntil(windows.value.listed(client.env, "Warcraft III"), { until: (listed) => listed, every: "1 second", within: TOPLEVEL_DEADLINE, onTimeout: () => Effect.succeed(false) }).pipe(
      Effect.catchTag("DesktopFailure", (failure) => Effect.sync(() => {
        say(`${client.name}: can't list its compositor's toplevels (${String(failure.cause)}); keeping this launch`);
        return true;
      })),
    ),
    restart: Effect.gen(function*() {
      say(`${client.name}: its compositor listed no Warcraft III toplevel within ${TOPLEVEL_DEADLINE}; restarting it once`);
      const report = reports.get(client.name);
      const before = report === undefined ? undefined : (yield* report.address)?.guid;
      yield* start(client);
      if (report !== undefined) yield* pollUntil(report.address, { until: (address) => address !== undefined && address.guid !== before, every: "1 second", within: MENUS_DEADLINE, onTimeout: () => Effect.void });
    }),
    missing: () => new DesktopFailure({ operation: "confirm Warcraft toplevel after one restart", client: client.name, cause: new ToplevelMissing({ title: "Warcraft III" }) }),
  }), { concurrency: "unbounded", discard: true });

  const menusOf = (name: string): Effect.Effect<MenuSocket, LanFailure | MenuFailure, Scope.Scope> => Effect.gen(function*() {
    const report = reports.get(name);
    if (report === undefined) return yield* new LanFailure({ problem: `no listener for ${name}` });

    yield* report.waitForAddress(120);
    const latest = yield* report.address;
    if (latest === undefined) return yield* new LanFailure({ problem: `${name}'s menus never reported` });
    return yield* connectMenus(latest);
  });

  let game: Game | undefined;

  // The process driving the pair, until `wisp lan end` releases it. Its watcher marks the pair idle once it dies, and raises the alarm 10 minutes later.
  let driver: Driver | undefined;
  // The agent's start and its last release, from which `wisp lan status` counts an undriven pair's idle time.
  const started = new Date().toISOString();
  let ended: string | undefined;
  let watcher: Fiber.Fiber<void> | undefined;
  const forever = { within: Duration.infinity, onTimeout: () => Effect.void };
  const release = Effect.suspend(() => {
    const watching = watcher;
    driver = undefined;
    ended = new Date().toISOString();
    watcher = undefined;
    return watching === undefined ? Effect.void : Fiber.interrupt(watching);
  });
  const drive = (pid: number | undefined) => Effect.gen(function*() {
    yield* release;
    if (pid === undefined) return;
    driver = { pid, since: new Date().toISOString() };
    watcher = yield* pollUntil(Effect.sync(() => alive(pid)), { until: (running) => !running, every: "5 seconds", ...forever }).pipe(
      Effect.andThen(Effect.sync(() => {
        if (driver !== undefined) driver = { ...driver, goneAt: new Date().toISOString() };
        say(`driver ${pid} is gone without wisp lan end; the pair is idle`);
      })),
      Effect.andThen(pollUntil(Effect.sync(() => driverVerdict(driver, Date.now()).alarm), { until: (due) => due, every: "15 seconds", ...forever })),
      Effect.andThen(Effect.sync(() => appendFileSync(alarmLog(), `${new Date().toISOString()} pair ${pair}: ${driverVerdict(driver, Date.now()).idle ?? "idle"} (pid ${pid}) for ${ALARM_AFTER_MS / 60_000} min without wisp lan end\n`))),
      Effect.forkIn(agentScope),
    );
  });
  const endGame = Effect.suspend(() => {
    const ending = game;
    if (ending === undefined) return Effect.void;
    game = undefined;

    return Scope.close(ending.scope, Exit.void).pipe(Effect.andThen(Effect.sync(() => say(`ended ${ending.id}`))));
  });

  const fresh = (mapFile: string, turnSteps: readonly number[] | undefined, computers: number | undefined) => Effect.scoped(Effect.gen(function*() {
    yield* endGame;
    const id = new Date().toISOString().replace(/[:.]/g, "-");
    const folder = join(directory, "games", id);
    mkdirSync(folder, { recursive: true });
    const inGame = `Maps\\Wisp\\${basename(mapFile)}`;
    yield* copyMap(mapFile);
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
      ...(turnSteps === undefined ? {} : { turnSteps }),
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

  const fileSystem = yield* FileSystem.FileSystem;
  let relayed: { readonly id: string; readonly folder: string; readonly map: string; readonly scope: Scope.Closeable } | undefined;
  const endRelayed = Effect.suspend(() => {
    const ending = relayed;
    relayed = undefined;
    return ending === undefined ? Effect.void : Scope.close(ending.scope, Exit.void).pipe(Effect.andThen(Effect.sync(() => say(`ended relayed ${ending.folder}`))));
  });
  const relayedGame = () => {
    if (relayed === undefined) return undefined;
    const log = join(relayed.folder, "relay.log");
    return { id: relayed.id, log, map: relayed.map, ...relayedStatus(existsSync(log) ? readFileSync(log, "utf8") : "", clients.map(({ name }) => name)) };
  };

  const relayedMatch = (mapFile: string, relayBin: string, agentBin: string, turnMs: number, raiseHeadroomMs: number | undefined) => Effect.scoped(Effect.gen(function*() {
    yield* endGame;
    yield* endRelayed;
    const id = new Date().toISOString().replace(/[:.]/g, "-");
    const folder = join(directory, "games", `relayed-${id}`);
    mkdirSync(folder, { recursive: true });
    yield* copyMap(mapFile);
    const map = yield* readMapFacts(mapFile, packager, `Maps\\Wisp\\${basename(mapFile)}`);
    const scope = yield* Scope.fork(agentScope);
    relayed = { id: `relayed-${id}`, folder, map: mapFile, scope };
    const spawn = (name: string, command: string, args: readonly string[]) =>
      spawnLogged(ChildProcess.make(command, args, { stdin: "ignore", forceKillAfter: "5 seconds" }), { stdout: join(folder, `${name}.log`), stderr: join(folder, `${name}.err`) }).pipe(Scope.provide(scope), Effect.provideService(FileSystem.FileSystem, fileSystem));
    const relayAddress = `127.0.0.1:${17000 + pair}`;
    const tuning = raiseHeadroomMs === undefined ? [] : ["--raise-headroom-ms", String(raiseHeadroomMs)];
    yield* spawn("relay", relayBin, ["--bind", relayAddress, "--steps", String(turnMs)]);
    const names = clients.map(({ side }) => `wisp-${pair}${side}-${id.slice(11, 19)}`);
    const [host, ...guests] = clients;
    if (host === undefined) return yield* new LanFailure({ problem: "the pair has no clients" });
    yield* spawn(`agent-${host.side}`, agentBin, ["--relay", relayAddress, "--name", names[0]!, "--create", String(clients.length), "--map", mapFactsLine(map), "--trace", join(folder, `agent-${host.side}.trace`), ...tuning]);
    const hostLog = join(folder, `agent-${host.side}.log`);
    let room: string | undefined;
    const created = yield* until(Effect.sync(() => (room = existsSync(hostLog) ? /^\S+ room ([0-9a-f]{16}) slot 0$/m.exec(readFileSync(hostLog, "utf8"))?.[1] : undefined) !== undefined), "20 seconds");
    if (!created || room === undefined) return yield* new LanFailure({ problem: `the host agent made no room; see ${folder}` });
    yield* Effect.forEach(guests, (guest, index) => spawn(`agent-${guest.side}`, agentBin, ["--relay", relayAddress, "--name", names[index + 1]!, "--join", room!, "--trace", join(folder, `agent-${guest.side}.trace`), ...tuning]), { discard: true });
    say(`relayed ${folder}: relay on ${relayAddress}, games ${names.join(", ")}`);
    for (const [index, client] of clients.entries()) {
      const pid = yield* gamePid(client.name);
      if (pid === undefined) return yield* new LanFailure({ problem: `${client.name} isn't running` });
      const menus = yield* menusOf(client.name);
      yield* (yield* loadLanPlugin).enableLan(pid, exeOf(client.name), menus, say);
      yield* joinLanGame(menus, names[index]!);
    }
    const relayLog = join(folder, "relay.log");
    const playing = yield* until(Effect.sync(() => existsSync(relayLog) && readFileSync(relayLog, "utf8").includes(" playing")), "120 seconds");
    if (!playing) return yield* new LanFailure({ problem: `the relayed match didn't start; see ${folder}` });
    return { folder, games: names };
  }));

  const solo = (mapFile: string) => Effect.scoped(Effect.gen(function*() {
    yield* endGame;
    const started = Date.now();
    yield* copyMap(mapFile);
    return yield* Effect.forEach(clients, (client) => Effect.gen(function*() {
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
      const running = yield* Effect.forEach(clients, ({ name }) => gameRun(name).pipe(Effect.map((run) => ({ name, ...run, documents: documentsOf(name) }))));
      const current = game === undefined ? relayedGame() : { id: game.id, log: game.log, map: game.map, ...game.host.status() };
      const playing = current !== undefined && current.phase !== "lobby" && current.phase !== "over";
      return Response.json({
        pair,
        profile: profile.name,
        fps: profile.maxFps,
        network,
        clients: running,
        game: current,
        driver,
        idle: driverVerdict(driver, Date.now()).idle,
        ...idleness(started, ended, driver, playing, running.filter(({ pid }) => pid === undefined).map(({ name }) => name), Date.now()),
      });
    }
    if (url.pathname === "/fresh" && request.method === "POST") {
      const refusal = lanPlayRefusal(pair, network, "fresh");
      if (refusal !== undefined) return Response.json({ error: refusal }, { status: 400 });
      const body = yield* decode(FreshRequest, request);
      if (!existsSync(body.map)) return Response.json({ error: `no map at ${body.map}` }, { status: 400 });
      yield* drive(body.driver);
      const exit = yield* Effect.exit(fresh(body.map, body.turnSteps, body.computers));
      if (Exit.isSuccess(exit)) return Response.json(exit.value);
      say(`fresh failed: ${String(exit.cause)}`);
      return Response.json({ error: String(exit.cause) }, { status: 500 });
    }
    if (url.pathname === "/relayed" && request.method === "POST") {
      const refusal = lanPlayRefusal(pair, network, "relayed");
      if (refusal !== undefined) return Response.json({ error: refusal }, { status: 400 });
      const body = yield* decode(RelayedRequest, request);
      const missing = [body.map, body.relay, body.agent].find((path) => !existsSync(path));
      if (missing !== undefined) return Response.json({ error: `no file at ${missing}` }, { status: 400 });
      yield* drive(body.driver);
      const exit = yield* Effect.exit(relayedMatch(body.map, body.relay, body.agent, body.turnMs, body.raiseHeadroomMs));
      if (Exit.isSuccess(exit)) return Response.json(exit.value);
      say(`relayed failed: ${String(exit.cause)}`);
      return Response.json({ error: String(exit.cause) }, { status: 500 });
    }
    if (url.pathname === "/solo" && request.method === "POST") {
      const body = yield* decode(SoloRequest, request);
      if (!existsSync(body.map)) return Response.json({ error: `no map at ${body.map}` }, { status: 400 });
      yield* drive(body.driver);
      const exit = yield* Effect.exit(solo(body.map));
      if (Exit.isSuccess(exit)) return Response.json({ clients: exit.value });
      say(`solo failed: ${String(exit.cause)}`);
      return Response.json({ error: String(exit.cause) }, { status: 500 });
    }
    if (url.pathname === "/end" && request.method === "POST") {
      yield* release;
      yield* endGame;
      yield* endRelayed;
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
  yield* Effect.addFinalizer(() => endRelayed);
  writeFileSync(join(directory, "agent.json"), `${JSON.stringify({ pid: process.pid, socket: agentSocket(pair), profile: profile.name, fps: profile.maxFps, network, runs })}\n`);
  say(`agent on ${agentSocket(pair)}`);

  const sessionPid = wholeFlag(process.argv, "session-pid", { fallback: 0 });
  if (sessionPid instanceof UsageFailure) return yield* sessionPid;
  if (sessionPid <= 0) return yield* Effect.never;
  yield* pollUntil(Effect.sync(() => alive(sessionPid)), { until: (running) => !running, every: "2 seconds" });
  say(`stopping: the pair session ${sessionPid} ended`);
}).pipe(Effect.onInterrupt(() => Effect.sync(() => say("stopping: asked to"))));

BunRuntime.runMain(Effect.scoped(agent).pipe(
  Effect.tapCause((cause) => (Cause.hasInterruptsOnly(cause) ? Effect.void : Effect.sync(() => console.error(Cause.pretty(cause))))),
  Effect.provide(Layer.merge(BunServices.layer, platformLayer())),
), { disableErrorReporting: true });
