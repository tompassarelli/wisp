import { basename, join } from "node:path";
import { Effect, Exit, Fiber, Scope } from "effect";
import { type MenuFailure, type MenuSocket, connectMenus, listenForMenus, type MenuReports } from "../menus";
import { type LanHost, startHost } from "./host";
import { LanFailure, enableLan, joinLanGame } from "./join";
import { readMapFacts } from "./map";
import { PAIR_SIDES, PROFILES, agentSocket, audioSinkOf, clientName, clientRoot, documentsOf, exeOf, pairDirectory, poolClientsFile, preferences, prefixOf, reportPort } from "./pool";

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
  mkdirSync(documentsOf(client.name), { recursive: true });
  writeFileSync(join(documentsOf(client.name), "War3Preferences.txt"), preferences(profile, client.windowX));
  const appId = String(3516115600 + pair * 2 + PAIR_SIDES.indexOf(client.side));
  Bun.spawn(["dbus-run-session", "--", "steam-run", "env", runtime, "--verb=waitforexitandrun", "--", proton, "waitforexitandrun", exeOf(client.name), "-launch", "-windowmode", "windowed", "-nowfpause"], {
    env: { ...process.env, ...audioEnv(client.name), STEAM_COMPAT_DATA_PATH: clientRoot(client.name), STEAM_COMPAT_CLIENT_INSTALL_PATH: steam, STEAM_COMPAT_APP_ID: appId, SteamAppId: appId, SteamGameId: appId },
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
