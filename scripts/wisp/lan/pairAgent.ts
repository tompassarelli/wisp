// One pool pair's agent (wisp:docs/lan.md). `wisp lan pool` runs it inside
// the pair's private network namespace, on the pair's private desktop:
//   bun pairAgent.ts --pair K --profile parity|visual
// It launches the pair's two offline clients and answers on a Unix socket
// (pool.ts agentSocket), which reaches across network namespaces:
//   GET  /status          the clients and the current game
//   POST /fresh {map}     host MAP as a LAN game and join both clients; answers once the match plays
//   POST /end             end the current game
// Each game writes its action log (host.ts) and packet record under the
// pair's state folder.
import { appendFileSync, copyFileSync, existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { Effect, Exit, Scope } from "effect";
import { findGameProcesses, readExecutable } from "../engine/memory";
import { type MenuFailure, type MenuSocket, connectMenus, listenForMenus, type MenuReports } from "../menus";
import { type LanHost, startHost } from "./host";
import { LanFailure, enableLan, joinLanGame } from "./join";
import { readMapFacts } from "./map";
import { PAIR_SIDES, PROFILES, agentSocket, clientName, clientRoot, documentsOf, exeOf, pairDirectory, preferences, prefixOf, reportPort } from "./pool";

const argument = (name: string) => {
  const at = process.argv.indexOf(`--${name}`);
  return at < 0 ? undefined : process.argv[at + 1];
};
const pair = Number(argument("pair") ?? "0");
const profile = PROFILES[argument("profile") ?? "parity"];
const packager = argument("packager") ?? join(process.env["XDG_CACHE_HOME"] ?? join(process.env["HOME"] ?? "", ".cache"), "wisp/lan/map-pack");
if (profile === undefined) throw new Error(`unknown profile ${argument("profile")}; parity or visual`);
const directory = pairDirectory(pair);
mkdirSync(directory, { recursive: true });
const agentLog = join(directory, "agent.log");
const say = (text: string) => appendFileSync(agentLog, `${new Date().toISOString()} ${text}\n`);
const steam = join(process.env["HOME"] ?? "", ".local/share/Steam");
const proton = join(steam, "compatibilitytools.d/GE-Proton11-7-x86_64/proton");
const runtime = join(steam, "steamapps/common/SteamLinuxRuntime_4/_v2-entry-point");

const clients = PAIR_SIDES.map((side, index) => ({ side, name: clientName(pair, side), port: reportPort(pair, side), windowX: index * (profile.width + 20) }));

// Launch both clients.
for (const client of clients) {
  mkdirSync(documentsOf(client.name), { recursive: true });
  writeFileSync(join(documentsOf(client.name), "War3Preferences.txt"), preferences(profile, client.windowX));
  const appId = String(3516115600 + pair * 2 + PAIR_SIDES.indexOf(client.side));
  Bun.spawn(["dbus-run-session", "--", "steam-run", "env", runtime, "--verb=waitforexitandrun", "--", proton, "waitforexitandrun", exeOf(client.name), "-launch", "-windowmode", "windowed", "-nowfpause"], {
    env: { ...process.env, STEAM_COMPAT_DATA_PATH: clientRoot(client.name), STEAM_COMPAT_CLIENT_INSTALL_PATH: steam, STEAM_COMPAT_APP_ID: appId, SteamAppId: appId, SteamGameId: appId },
    stdout: Bun.file(join(directory, `${client.name}.out`)),
    stderr: Bun.file(join(directory, `${client.name}.err`)),
  });
  say(`launched ${client.name}`);
  await Bun.sleep(3000);
}

const gamePid = (name: string) => findGameProcesses(prefixOf(name))[0]?.pid;

// labwc opens every game window at the same spot, and Xwayland throttles a
// window another covers: that game falls behind the lockstep. Each game's
// window goes to its own column of the desktop instead.
const xdotool = process.env["WISP_XDOTOOL"] ?? Bun.which("xdotool") ?? (() => {
  const built = Bun.spawnSync(["nix", "build", "--no-link", "--print-out-paths", "nixpkgs#xdotool"], { stdout: "pipe", stderr: "ignore" });
  return built.exitCode === 0 ? join(built.stdout.toString().trim().split("\n")[0] ?? "", "bin/xdotool") : undefined;
})();
const x11 = (...args: string[]) => xdotool === undefined ? "" : Bun.spawnSync([xdotool, ...args], { stdout: "pipe", stderr: "ignore", timeout: 5000 }).stdout.toString();
const placeWindows = () => {
  for (const window of x11("search", "--name", "^Warcraft III$").split("\n").filter((id) => id !== "")) {
    const pid = Number(x11("getwindowpid", window).trim());
    const client = clients.find(({ name }) => gamePid(name) === pid);
    if (client === undefined) continue;
    const geometry = x11("getwindowgeometry", window);
    if (geometry.includes(`Position: ${client.windowX},0 `)) continue;
    x11("windowsize", window, String(profile.width), String(profile.height), "windowmove", window, String(client.windowX), "0");
    say(`placed ${client.name}'s window at ${client.windowX},0`);
  }
};
if (xdotool === undefined) say("no xdotool: game windows stay where the desktop puts them, and a covered one falls behind");
setInterval(placeWindows, 3000);

interface Game {
  readonly id: string;
  readonly log: string;
  readonly host: LanHost;
  readonly map: string;
}
let game: Game | undefined;
const scope = Scope.makeUnsafe();
const reports = new Map<string, MenuReports>();
for (const client of clients) reports.set(client.name, await Effect.runPromise(listenForMenus(client.port).pipe(Scope.provide(scope))));

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
  say(`ended ${game.id}`);
  game = undefined;
};

/** Hosts `mapFile` and joins both clients; resolves when the match plays. */
const fresh = (mapFile: string, turnMs: number | undefined) => Effect.scoped(Effect.gen(function*() {
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
    log: (line) => appendFileSync(log, `${line}\n`),
    onPacket: (direction, label, bytes) => {
      // Empty turns are most of the traffic and carry nothing.
      if (bytes[1] === 0x0c && bytes.length <= 6) return;
      appendFileSync(packets, `${((Date.now() - started) / 1000).toFixed(3)} ${direction} ${label} ${Buffer.from(bytes).toString("hex")}\n`);
    },
  });
  game = { id, log, host, map: mapFile };
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
        clients: clients.map(({ name }) => ({ name, pid: gamePid(name), documents: documentsOf(name) })),
        game: game === undefined ? undefined : { id: game.id, log: game.log, map: game.map, ...game.host.status() },
      });
    }
    if (url.pathname === "/fresh" && request.method === "POST") {
      const body = (await request.json()) as { map?: string; turnMs?: number };
      if (typeof body.map !== "string" || !existsSync(body.map)) return Response.json({ error: `no map at ${body.map}` }, { status: 400 });
      const exit = await Effect.runPromiseExit(fresh(body.map, body.turnMs));
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
writeFileSync(join(directory, "agent.json"), `${JSON.stringify({ pid: process.pid, socket: agentSocket(pair), profile: profile.name, run: process.env["PRIVATE_DESKTOP_RUN"] })}\n`);
say(`agent on ${agentSocket(pair)}`);
process.on("SIGTERM", () => {
  endGame();
  server.stop(true);
  Effect.runSync(Scope.close(scope, Exit.void));
  process.exit(0);
});
