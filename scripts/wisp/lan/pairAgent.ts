// One pool pair's agent (wisp:docs/lan.md). `wisp lan pool` runs it inside
// the pair's private network namespace, on the pair's private desktop:
//   bun pairAgent.ts --pair K --pool-profile parity|visual
// It launches the pair's two offline clients and answers on a Unix socket
// (pool.ts agentSocket), which reaches across network namespaces:
//   GET  /status          the clients and the current game
//   POST /fresh {map}     host MAP as a LAN game and join both clients; answers once the match plays
//   POST /end             end the current game
//   POST /solo {map}      each client plays MAP alone, as a local game on its loopback provider
// Each game writes its action log (host.ts) and packet record under the
// pair's state folder.
//
// The whole agent is one Effect program under BunRuntime.runMain
// (wisp:docs/host-tools.md): the game launchers, menu listeners, socket server
// and each game's host live in its scope, so SIGTERM, a failed step or the
// pair session ending stops every game before the agent exits.
import { appendFileSync, copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import * as BunRuntime from "@effect/platform-bun/BunRuntime";
import * as BunServices from "@effect/platform-bun/BunServices";
import { Cause, Effect, Exit, FiberSet, Option, Schedule, Schema, Scope, Stream } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/process";
import { findGameProcesses } from "./processes";
import { spawnLogged } from "../hostProcess";
import { type MenuFailure, type MenuSocket, connectMenus, listenForMenus, type MenuReports, playLocalGame } from "../menus";
import { type LanHost, startHost } from "./host";
import { LanFailure, joinLanGame } from "./join";
import { loadLanPlugin } from "./plugin";
import { readMapFacts } from "./map";
import { PAIR_SIDES, poolProfile, agentSocket, audioSinkOf, clientName, clientRoot, documentsOf, exeOf, pairDirectory, poolClientsFile, preferences, prefixOf, reportPort } from "./pool";
import { admissionFile, nativeCommand } from "./admission";

const argument = (name: string) => {
  const at = process.argv.indexOf(`--${name}`);
  return at < 0 ? undefined : process.argv[at + 1];
};
const pair = Number(argument("pair") ?? "0");
const fpsText = argument("fps");
const profile = poolProfile(argument("pool-profile") ?? "parity", fpsText === undefined ? undefined : Number(fpsText));
const packager = argument("packager") ?? join(process.env["XDG_CACHE_HOME"] ?? join(process.env["HOME"] ?? "", ".cache"), "wisp/lan/map-pack");
const directory = pairDirectory(pair);
const agentLog = join(directory, "agent.log");
const say = (text: string) => appendFileSync(agentLog, `${new Date().toISOString()} ${text}\n`);
const steam = join(process.env["HOME"] ?? "", ".local/share/Steam");
const proton = join(steam, "compatibilitytools.d/GE-Proton11-7-x86_64/proton");
const runtime = join(steam, "steamapps/common/SteamLinuxRuntime_4/_v2-entry-point");

const runB = argument("run-b");
const runs: Record<string, string | undefined> = { a: process.env["PRIVATE_DESKTOP_RUN"], b: runB };
/** Client b's display: its own private desktop, from that desktop's run folder. */
const displayOf = (run: string | undefined): Record<string, string> => {
  if (run === undefined) return {};
  const read = (file: string) => (existsSync(join(run, file)) ? readFileSync(join(run, file), "utf8").trim() : "");
  return { DISPLAY: read("display"), WAYLAND_DISPLAY: read("wayland-display"), XAUTHORITY: read("xauthority"), XDG_RUNTIME_DIR: join(run, "runtime"), PRIVATE_DESKTOP_RUN: run };
};
const clients = PAIR_SIDES.map((side) => ({ side, name: clientName(pair, side), port: reportPort(pair, side), windowX: 0, env: side === "b" ? displayOf(runB) : {} }));
type PoolClient = (typeof clients)[number];

/** A short helper run's stdout; empty when it fails or takes over 5 s. */
const output = (command: string, args: readonly string[], env: Record<string, string | undefined>) =>
  ChildProcessSpawner.ChildProcessSpawner.use((spawner) => spawner.string(ChildProcess.make(command, args, { env, extendEnv: true, stderr: "ignore" }))).pipe(
    Effect.timeout("5 seconds"),
    Effect.orElseSucceed(() => ""),
  );

// Each client plays into its own silent sink on the user's PipeWire, so a pool
// never sounds on the owner's speakers and a check records exactly one
// client's audio. The desktop's runtime folder is private, so the user's own
// one is named. Without PipeWire the clients run without sound, as before.
const userRuntime = `/run/user/${process.getuid?.() ?? 1000}`;
const pulse = join(userRuntime, "pulse/native");
const audioEnv = (name: string) => Effect.gen(function*() {
  if (!existsSync(pulse)) return {};
  const sink = audioSinkOf(name);
  const pw = { XDG_RUNTIME_DIR: userRuntime };
  const nodes = yield* output("pw-dump", [], pw);
  if (!nodes.includes(`"node.name": "${sink}"`)) {
    const made = yield* Effect.scoped(Effect.gen(function*() {
      const child = yield* ChildProcess.make("pw-cli", ["create-node", "adapter", `{ factory.name=support.null-audio-sink node.name=${sink} node.description="Wisp ${name}" media.class=Audio/Sink object.linger=true audio.position=[ FL FR ] priority.session=0 priority.driver=0 }`], { env: pw, extendEnv: true, stdout: "ignore" });
      const [said, code] = yield* Effect.all([Stream.mkString(Stream.decodeText(child.stderr)), child.exitCode], { concurrency: 2 });
      return { said, code };
    })).pipe(Effect.timeout("5 seconds"), Effect.orElseSucceed(() => ({ said: "pw-cli failed", code: 1 })));
    if (made.code !== 0) {
      say(`no sink for ${name} (${made.said.trim()}): it runs without sound`);
      return {};
    }
  }
  return { PULSE_SERVER: `unix:${pulse}`, PULSE_SINK: sink };
});

/** Polls `check` every 250 ms until it holds, for at most `limit`; says whether it held. */
const until = (check: () => boolean, limit: `${number} seconds`) =>
  Effect.sync(check).pipe(
    Effect.repeat({ schedule: Schedule.spaced("250 millis"), until: (held) => held }),
    Effect.timeoutOption(limit),
    Effect.map(Option.isSome),
  );

/** Launches one client's game in its own native capacity scope, held by the agent's scope. */
const launch = (capacity: string, client: PoolClient) => Effect.gen(function*() {
  // A second runtime on a live prefix joins its wineserver and dies: a game left from before must be stopped first.
  const left = findGameProcesses(prefixOf(client.name));
  if (left.length > 0) {
    say(`${client.name} still runs (pid ${left.map(({ pid }) => pid).join(", ")}); stopping it first`);
    for (const { pid } of left) process.kill(pid, "SIGTERM");
    yield* until(() => findGameProcesses(prefixOf(client.name)).length === 0, "5 seconds");
  }
  mkdirSync(documentsOf(client.name), { recursive: true });
  writeFileSync(join(documentsOf(client.name), "War3Preferences.txt"), preferences(profile, client.windowX));
  const appId = String(3516115600 + pair * 2 + PAIR_SIDES.indexOf(client.side));
  // Each game in its own machine-capacity native scope: the high-weight
  // slice for game clients, no CPU quota.
  // Admission uses the user's service bus; restore the private runtime only inside the game scope.
  const gameRuntime = client.env["XDG_RUNTIME_DIR"] ?? process.env["XDG_RUNTIME_DIR"] ?? userRuntime;
  const [command = process.execPath, ...native] = nativeCommand(capacity, client.name, gameRuntime);
  const env = { ...client.env, ...(yield* audioEnv(client.name)), XDG_RUNTIME_DIR: userRuntime, DBUS_SESSION_BUS_ADDRESS: `unix:path=${userRuntime}/bus`, STEAM_COMPAT_DATA_PATH: clientRoot(client.name), STEAM_COMPAT_CLIENT_INSTALL_PATH: steam, STEAM_COMPAT_APP_ID: appId, SteamAppId: appId, SteamGameId: appId };
  const errFile = join(directory, `${client.name}.err`);
  const game = yield* spawnLogged(ChildProcess.make(command, [...native, "dbus-run-session", "--", "steam-run", "env", runtime, "--verb=waitforexitandrun", "--", proton, "waitforexitandrun", exeOf(client.name), "-launch", "-windowmode", "windowed", "-nowfpause"], {
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

const gamePid = (name: string) => findGameProcesses(prefixOf(name))[0]?.pid;

interface Game {
  readonly id: string;
  readonly log: string;
  readonly host: LanHost;
  readonly map: string;
  /** Holds the game's host; closing it ends the game. */
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

  // A refused second client ends the first too: a pool only keeps whole pairs.
  const games: { readonly isRunning: Effect.Effect<boolean, unknown> }[] = [];
  yield* Effect.forEach(clients, (client) => launch(capacity, client).pipe(Effect.map((handle) => { games.push(handle); })), { discard: true });

  // The game may open its window larger than its settings ask, past the edge
  // of its desktop; each client's window is set to the profile's size at the
  // top left of its own desktop. (On one shared desktop, labwc stacked both
  // windows in one place, and Xwayland throttled the covered game until it fell
  // behind the lockstep: hence a desktop per client.)
  const xdotool = process.env["WISP_XDOTOOL"] ?? Bun.which("xdotool") ?? (yield* output("nix", ["build", "--no-link", "--print-out-paths", "nixpkgs#xdotool"], {}).pipe(
    Effect.map((built) => (built.trim() === "" ? undefined : join(built.trim().split("\n")[0] ?? "", "bin/xdotool"))),
  ));
  if (xdotool === undefined) say("no xdotool: game windows keep the size and place the desktop gives them");
  else {
    const x11 = (env: Record<string, string>, ...args: string[]) => output(xdotool, args, env);
    const placeWindows = Effect.forEach(clients, (client) => Effect.gen(function*() {
      for (const window of (yield* x11(client.env, "search", "--name", "^Warcraft III$")).split("\n").filter((id) => id !== "")) {
        // labwc may report the window with or without its 2 px border; matching only one re-placed the game every 3 s.
        const geometry = yield* x11(client.env, "getwindowgeometry", window);
        if (geometry.includes(`Position: ${client.windowX},0 `) && [0, 4].some((border) => geometry.includes(`Geometry: ${profile.width + border}x${profile.height + border}`))) continue;
        yield* x11(client.env, "windowsize", window, String(profile.width), String(profile.height), "windowmove", window, String(client.windowX), "0");
        say(`placed ${client.name}'s window at ${client.windowX},0, ${profile.width}x${profile.height}`);
      }
    }), { discard: true });
    yield* Effect.forkScoped(Effect.repeat(placeWindows, Schedule.spaced("3 seconds")));
  }

  // The agent holds each client's report port inside the pair's namespace, where
  // `wisp menus listen` can't reach; it keeps the requests each client's menus send instead.
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
    // The newest announcement: a client that restarted has a new port and guid.
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
    // Closing its scope stops the host.
    return Scope.close(ending.scope, Exit.void).pipe(Effect.andThen(Effect.sync(() => say(`ended ${ending.id}`))));
  });

  /** Hosts `mapFile` and joins both clients; succeeds when the match plays. */
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
        // Empty turns are most of the traffic and carry nothing.
        if (bytes[1] === 0x0c && bytes.length <= 6) return;
        appendFileSync(packets, `${((Date.now() - started) / 1000).toFixed(3)} ${direction} ${label} ${Buffer.from(bytes).toString("hex")}\n`);
      },
    }).pipe(Scope.provide(scope));
    game = { id, log, host, map: mapFile, scope };
    say(`game ${id}: hosting ${inGame} on port ${host.port}`);
    for (const client of clients) {
      const pid = gamePid(client.name);
      if (pid === undefined) return yield* new LanFailure({ problem: `${client.name} isn't running` });
      const menus = yield* menusOf(client.name);
      yield* (yield* loadLanPlugin).enableLan(pid, exeOf(client.name), menus, say);
      yield* joinLanGame(menus, `wisp-${pair}-${id.slice(11, 19)}`);
      yield* until(() => host.status().players.some(({ label, connected }) => label === client.name && connected), "20 seconds");
    }
    const playing = yield* Effect.sync(() => host.status().phase).pipe(
      Effect.repeat({ schedule: Schedule.spaced("250 millis"), until: (phase) => phase === "playing" || phase === "over" }),
      Effect.timeoutOption("120 seconds"),
    );
    if (Option.isSome(playing) && playing.value === "playing") return { log, game: id };
    return yield* new LanFailure({ problem: `the match didn't start: ${JSON.stringify(host.status())}` });
  }));

  /**
   * Each client hosts MAP on the menus' own local provider (loopback, the one
   * 3.0.1 kept) and starts it alone, as Single Player's Custom Game does;
   * succeeds once every client's game UI is up. No LAN switch and no Wisp
   * host: nothing is written into the game (wisp:docs/lan.md, "Solo games").
   */
  const solo = (mapFile: string) => Effect.scoped(Effect.gen(function*() {
    yield* endGame;
    const started = Date.now();
    return yield* Effect.forEach(clients, (client) => Effect.gen(function*() {
      const target = join(documentsOf(client.name), "Maps/Wisp", basename(mapFile));
      mkdirSync(join(target, ".."), { recursive: true });
      if (existsSync(target)) rmSync(target);
      copyFileSync(mapFile, target);
      if (gamePid(client.name) === undefined) return yield* new LanFailure({ problem: `${client.name} isn't running` });
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
        clients: clients.map(({ name }) => ({ name, pid: gamePid(name), documents: documentsOf(name) })),
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

  // The pair's session gone (its desktops stopped) means the pair is over.
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
  Effect.provide(BunServices.layer),
), { disableErrorReporting: true });
