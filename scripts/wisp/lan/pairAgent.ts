// One pool pair's agent (wisp:docs/lan.md). `wisp lan pool` runs it inside
// the pair's private network namespace, on the pair's private desktop:
//   bun pairAgent.ts --pair K --pool-profile parity|visual
// It launches the pair's two offline clients and answers on a Unix socket
// (pool.ts agentSocket), which reaches across network namespaces:
//   GET  /status          the clients and the current game
//   POST /fresh {map}     host MAP as a LAN game and join both clients; answers once the match plays
//   POST /end             end the current game
// Each game writes its action log (host.ts) and packet record under the
// pair's state folder, and runs inside the desync autopsy
// (wisp:docs/autopsy.md): its findings go to the game's autopsy.log.
import { appendFileSync, copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { Effect, Exit, Fiber, Scope } from "effect";
import { withAutopsy } from "../engine/autopsy";
import { findGameProcesses, readExecutable } from "../engine/memory";
import { type MenuFailure, type MenuSocket, connectMenus, listenForMenus, type MenuReports } from "../menus";
import { type LanHost, startHost } from "./host";
import { LanFailure, enableLan, joinLanGame } from "./join";
import { readMapFacts } from "./map";
import { PAIR_SIDES, poolProfile, agentSocket, audioSinkOf, clientName, clientRoot, documentsOf, exeOf, pairDirectory, poolClientsFile, preferences, prefixOf, reportPort } from "./pool";

const argument = (name: string) => {
  const at = process.argv.indexOf(`--${name}`);
  return at < 0 ? undefined : process.argv[at + 1];
};
const pair = Number(argument("pair") ?? "0");
const fpsText = argument("fps");
const profile = poolProfile(argument("pool-profile") ?? "parity", fpsText === undefined ? undefined : Number(fpsText));
const packager = argument("packager") ?? join(process.env["XDG_CACHE_HOME"] ?? join(process.env["HOME"] ?? "", ".cache"), "wisp/lan/map-pack");
const directory = pairDirectory(pair);
mkdirSync(directory, { recursive: true });
const agentLog = join(directory, "agent.log");
const say = (text: string) => appendFileSync(agentLog, `${new Date().toISOString()} ${text}\n`);
const steam = join(process.env["HOME"] ?? "", ".local/share/Steam");
const proton = join(steam, "compatibilitytools.d/GE-Proton11-7-x86_64/proton");
const runtime = join(steam, "steamapps/common/SteamLinuxRuntime_4/_v2-entry-point");

const runB = argument("run-b");
const capacity = argument("capacity");
/** The games' launchers: each game sits in its own scope, so it outlives this agent unless stopped. */
const games: Bun.Subprocess[] = [];
const runs: Record<string, string | undefined> = { a: process.env["PRIVATE_DESKTOP_RUN"], b: runB };
/** Client b's display: its own private desktop, from that desktop's run folder. */
const displayOf = (run: string | undefined): Record<string, string> => {
  if (run === undefined) return {};
  const read = (file: string) => (existsSync(join(run, file)) ? readFileSync(join(run, file), "utf8").trim() : "");
  return { DISPLAY: read("display"), WAYLAND_DISPLAY: read("wayland-display"), XAUTHORITY: read("xauthority"), XDG_RUNTIME_DIR: join(run, "runtime"), PRIVATE_DESKTOP_RUN: run };
};
const clients = PAIR_SIDES.map((side) => ({ side, name: clientName(pair, side), port: reportPort(pair, side), windowX: 0, env: side === "b" ? displayOf(runB) : {} }));

// Each client plays into its own silent sink on the user's PipeWire, so a pool
// never sounds on the owner's speakers and a check records exactly one
// client's audio. The desktop's runtime folder is private, so the user's own
// one is named. Without PipeWire the clients run without sound, as before.
const userRuntime = `/run/user/${process.getuid?.() ?? 1000}`;
const pulse = join(userRuntime, "pulse/native");
const audioEnv = (name: string): Record<string, string> => {
  if (!existsSync(pulse)) return {};
  const sink = audioSinkOf(name);
  const pw = { ...process.env, XDG_RUNTIME_DIR: userRuntime };
  const nodes = Bun.spawnSync(["pw-dump"], { env: pw, stdout: "pipe", stderr: "ignore", timeout: 5000 }).stdout.toString();
  if (!nodes.includes(`"node.name": "${sink}"`)) {
    const made = Bun.spawnSync(["pw-cli", "create-node", "adapter", `{ factory.name=support.null-audio-sink node.name=${sink} node.description="Wisp ${name}" media.class=Audio/Sink object.linger=true audio.position=[ FL FR ] priority.session=0 priority.driver=0 }`], { env: pw, stdout: "ignore", stderr: "pipe", timeout: 5000 });
    if (made.exitCode !== 0) {
      say(`no sink for ${name} (${made.stderr.toString().trim()}): it runs without sound`);
      return {};
    }
  }
  return { PULSE_SERVER: `unix:${pulse}`, PULSE_SINK: sink };
};

// Launch both clients.
for (const client of clients) {
  // A second runtime on a live prefix joins its wineserver and dies: a game left from before must be stopped first.
  const left = findGameProcesses(prefixOf(client.name));
  if (left.length > 0) {
    say(`${client.name} still runs (pid ${left.map(({ pid }) => pid).join(", ")}); stopping it first`);
    for (const { pid } of left) process.kill(pid, "SIGTERM");
    await Bun.sleep(5000);
  }
  mkdirSync(documentsOf(client.name), { recursive: true });
  writeFileSync(join(documentsOf(client.name), "War3Preferences.txt"), preferences(profile, client.windowX));
  const appId = String(3516115600 + pair * 2 + PAIR_SIDES.indexOf(client.side));
  // Each game in its own machine-capacity native scope: the high-weight
  // slice for game clients, no CPU quota, admitted on memory alone.
  // Admission uses the user's service bus; restore the private runtime only inside the game scope.
  const gameRuntime = client.env["XDG_RUNTIME_DIR"] ?? process.env["XDG_RUNTIME_DIR"] ?? userRuntime;
  const native = capacity === undefined ? [] : [process.execPath, capacity, "session", "--class", "native", "--memory-gib", "1.5", "--owner", `wisp-lan:${client.name}`, "--", "env", `XDG_RUNTIME_DIR=${gameRuntime}`];
  // The helper may defer the game's scope (exit 75, DEFER on stderr): wait
  // for admission instead of leaving the pair without a game.
  for (;;) {
    const child = Bun.spawn([...native, "dbus-run-session", "--", "steam-run", "env", runtime, "--verb=waitforexitandrun", "--", proton, "waitforexitandrun", exeOf(client.name), "-launch", "-windowmode", "windowed", "-nowfpause"], {
      env: { ...process.env, ...client.env, ...audioEnv(client.name), ...(capacity === undefined ? {} : { XDG_RUNTIME_DIR: userRuntime, DBUS_SESSION_BUS_ADDRESS: `unix:path=${userRuntime}/bus` }), STEAM_COMPAT_DATA_PATH: clientRoot(client.name), STEAM_COMPAT_CLIENT_INSTALL_PATH: steam, STEAM_COMPAT_APP_ID: appId, SteamAppId: appId, SteamGameId: appId },
      stdout: Bun.file(join(directory, `${client.name}.out`)),
      stderr: Bun.file(join(directory, `${client.name}.err`)),
    });
    const early = await Promise.race([child.exited, Bun.sleep(5000).then(() => undefined)]);
    const said = early === 75 ? readFileSync(join(directory, `${client.name}.err`), "utf8") : "";
    const deferred = /"decision":"DEFER","reason":"([A-Z_]+)"/.exec(said);
    if (deferred === null) {
      games.push(child);
      break;
    }
    say(`${client.name}: the capacity helper defers its game (${deferred[1]}); trying again in 45 s`);
    await Bun.sleep(45_000);
  }
  say(`launched ${client.name}`);
}

const gamePid = (name: string) => findGameProcesses(prefixOf(name))[0]?.pid;

// The game may open its window larger than its settings ask, past the edge
// of its desktop; each client's window is set to the profile's size at the
// top left of its own desktop. (On one shared desktop, labwc stacked both
// windows in one place, and Xwayland throttled the covered game until it fell
// behind the lockstep: hence a desktop per client.)
const xdotool = process.env["WISP_XDOTOOL"] ?? Bun.which("xdotool") ?? (() => {
  const built = Bun.spawnSync(["nix", "build", "--no-link", "--print-out-paths", "nixpkgs#xdotool"], { stdout: "pipe", stderr: "ignore" });
  return built.exitCode === 0 ? join(built.stdout.toString().trim().split("\n")[0] ?? "", "bin/xdotool") : undefined;
})();
const x11 = (env: Record<string, string>, ...args: string[]) =>
  xdotool === undefined ? "" : Bun.spawnSync([xdotool, ...args], { env: { ...process.env, ...env }, stdout: "pipe", stderr: "ignore", timeout: 5000 }).stdout.toString();
const placeWindows = () => {
  for (const client of clients) {
    for (const window of x11(client.env, "search", "--name", "^Warcraft III$").split("\n").filter((id) => id !== "")) {
      const geometry = x11(client.env, "getwindowgeometry", window);
      if (geometry.includes(`Position: ${client.windowX},0 `) && geometry.includes(`Geometry: ${profile.width + 4}x${profile.height + 4}`)) continue;
      x11(client.env, "windowsize", window, String(profile.width), String(profile.height), "windowmove", window, String(client.windowX), "0");
      say(`placed ${client.name}'s window at ${client.windowX},0, ${profile.width}x${profile.height}`);
    }
  }
};
if (xdotool === undefined) say("no xdotool: game windows keep the size and place the desktop gives them");
setInterval(placeWindows, 3000);

interface Game {
  readonly id: string;
  readonly log: string;
  readonly host: LanHost;
  readonly map: string;
  /** The desync autopsy following this game until it ends. */
  readonly autopsy: Fiber.Fiber<never>;
}
let game: Game | undefined;
const scope = Scope.makeUnsafe();
const reports = new Map<string, MenuReports>();
// The agent holds each client's report port inside the pair's namespace, where
// `wisp menus listen` can't reach; it keeps the requests each client's menus send instead.
for (const client of clients) {
  const sentLog = join(directory, `${client.name}-menus.log`);
  const onSent = (sent: { readonly message: string; readonly payload?: unknown }) =>
    appendFileSync(sentLog, `${new Date().toISOString()} ${sent.payload === undefined ? sent.message : `${sent.message} ${JSON.stringify(sent.payload)}`}\n`);
  reports.set(client.name, await Effect.runPromise(listenForMenus(client.port, onSent).pipe(Scope.provide(scope))));
}

const menusOf = (name: string): Effect.Effect<MenuSocket, LanFailure | MenuFailure, Scope.Scope> => Effect.gen(function*() {
  const report = reports.get(name);
  if (report === undefined) return yield* Effect.fail(new LanFailure({ problem: `no listener for ${name}` }));
  // The newest announcement: a client that restarted has a new port and guid.
  yield* report.waitForAddress(120);
  const latest = yield* report.address;
  if (latest === undefined) return yield* Effect.fail(new LanFailure({ problem: `${name}'s menus never reported` }));
  return yield* connectMenus(latest);
});

const endGame = () => {
  if (game === undefined) return;
  game.host.stop();
  // Interrupting the autopsy runs its last look at the reports and its summary.
  Effect.runFork(Fiber.interrupt(game.autopsy));
  say(`ended ${game.id}`);
  game = undefined;
};

/** Hosts `mapFile` and joins both clients; resolves when the match plays. */
const fresh = (mapFile: string, turnMs: number | undefined, computers: number | undefined) => Effect.scoped(Effect.gen(function*() {
  endGame();
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
  const map = readMapFacts(mapFile, packager, inGame);
  const log = join(folder, "actions.log");
  const packets = join(folder, "packets.log");
  const started = Date.now();
  writeFileSync(log, `# wisp lan host: pair ${pair}, map ${inGame}, clients ${clients.map(({ name }) => name).join(" ")}; seconds since ${new Date(started).toISOString()} (${started})\n`);
  const host = startHost({
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
  });
  const autopsyLog = join(folder, "autopsy.log");
  const autopsy = Effect.runFork(withAutopsy({
    clientsFile: poolClientsFile(),
    names: clients.map(({ name }) => name),
    root: join(folder, "autopsy"),
    print: (line) => {
      appendFileSync(autopsyLog, `${line}\n`);
      say(line);
    },
  }, Effect.never));
  game = { id, log, host, map: mapFile, autopsy };
  say(`game ${id}: hosting ${inGame} on port ${host.port}`);
  for (const client of clients) {
    const pid = gamePid(client.name);
    if (pid === undefined) return yield* Effect.fail(new LanFailure({ problem: `${client.name} isn't running` }));
    const menus = yield* menusOf(client.name);
    yield* enableLan(pid, exeOf(client.name), readExecutable(exeOf(client.name)).version, menus, say);
    yield* joinLanGame(menus, `wisp-${pair}-${id.slice(11, 19)}`);
    for (let tries = 0; tries < 80 && !host.status().players.some(({ label, connected }) => label === client.name && connected); tries++) yield* Effect.sleep("250 millis");
  }
  for (let tries = 0; tries < 480; tries++) {
    const status = host.status();
    if (status.phase === "playing") return { log, game: id };
    if (status.phase === "over") break;
    yield* Effect.sleep("250 millis");
  }
  return yield* Effect.fail(new LanFailure({ problem: `the match didn't start: ${JSON.stringify(host.status())}` }));
}));

rmSync(agentSocket(pair), { force: true });
const server = Bun.serve({
  unix: agentSocket(pair),
  fetch: async (request) => {
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
      const body = (await request.json()) as { map?: string; turnMs?: number; computers?: number };
      if (typeof body.map !== "string" || !existsSync(body.map)) return Response.json({ error: `no map at ${body.map}` }, { status: 400 });
      const exit = await Effect.runPromiseExit(fresh(body.map, body.turnMs, body.computers));
      if (Exit.isSuccess(exit)) return Response.json(exit.value);
      say(`fresh failed: ${String(exit.cause)}`);
      return Response.json({ error: String(exit.cause) }, { status: 500 });
    }
    if (url.pathname === "/end" && request.method === "POST") {
      endGame();
      return Response.json({ ended: true });
    }
    return new Response("not found", { status: 404 });
  },
});
writeFileSync(join(directory, "agent.json"), `${JSON.stringify({ pid: process.pid, socket: agentSocket(pair), profile: profile.name, fps: profile.maxFps, runs })}\n`);
say(`agent on ${agentSocket(pair)}`);
const shutdown = (why: string) => {
  say(`stopping: ${why}`);
  endGame();
  for (const launched of games) launched.kill("SIGTERM");
  server.stop(true);
  Effect.runSync(Scope.close(scope, Exit.void));
  process.exit(0);
};
process.on("SIGTERM", () => shutdown("asked to"));
// The pair's session gone (its desktops stopped) means the pair is over.
const sessionPid = Number(argument("session-pid") ?? "0");
if (sessionPid > 0) {
  setInterval(() => {
    try {
      process.kill(sessionPid, 0);
    } catch {
      shutdown(`the pair session ${sessionPid} ended`);
    }
  }, 2000);
}
