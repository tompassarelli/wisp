import { basename, join } from "node:path";
import * as BunRuntime from "@effect/platform-bun/BunRuntime";
import * as BunServices from "@effect/platform-bun/BunServices";
import { Cause, Effect, Exit, FiberSet, Option, Schedule, Schema, Scope, Stream } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/process";
import { spawnLogged } from "../hostProcess";
import { type MenuFailure, type MenuSocket, connectMenus, listenForMenus, type MenuReports, playLocalGame } from "../menus";
import { type LanHost, startHost } from "./host";
import { LanFailure, enableLan, joinLanGame } from "./join";
import { readMapFacts } from "./map";
import { PAIR_SIDES, poolProfile, agentSocket, audioSinkOf, clientName, clientRoot, documentsOf, exeOf, pairDirectory, poolClientsFile, preferences, prefixOf, reportPort } from "./pool";
import { admissionFile, nativeCommand } from "./admission";
import { makeEngine } from "../commands/engine";
import { startPairClients, waitForFirstClient } from "./startup";

const argument = (name: string) => {
  const at = process.argv.indexOf(`--${name}`);
  return at < 0 ? undefined : process.argv[at + 1];
};
const pair = Number(argument("pair") ?? "0");
const fpsText = argument("fps");
const profile = poolProfile(argument("pool-profile") ?? "parity", fpsText === undefined ? undefined : Number(fpsText));
const packager = argument("packager") ?? join(process.env["XDG_CACHE_HOME"] ?? join(process.env["HOME"] ?? "", ".cache"), "wisp/lan/map-pack");
const locateBeforePeer = process.argv.includes("--locate-before-peer");
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
  /** Holds the game's host and its desync autopsy; closing it ends the game. */
  readonly scope: Scope.Closeable;
}

const FreshRequest = Schema.fromJsonString(Schema.Struct({ map: Schema.String, turnMs: Schema.optionalKey(Schema.Finite), computers: Schema.optionalKey(Schema.Finite) }));
const SoloRequest = Schema.fromJsonString(Schema.Struct({ map: Schema.String }));
const SpeedRequest = Schema.fromJsonString(Schema.Struct({ speed: Schema.Finite }));

BunRuntime.runMain(Effect.scoped(agent).pipe(
  Effect.tapCause((cause) => (Cause.hasInterruptsOnly(cause) ? Effect.void : Effect.sync(() => console.error(Cause.pretty(cause))))),
  Effect.provide(BunServices.layer),
), { disableErrorReporting: true });
