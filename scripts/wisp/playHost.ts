



import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { closeSync, copyFileSync, fstatSync, mkdirSync, openSync, readFileSync, readSync, readdirSync, readlinkSync, renameSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import * as BunServices from "@effect/platform-bun/BunServices";
import { Console, Effect, Layer, type PlatformError, Schedule, Schema, Stream } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/process";
import { serverDirectoryName } from "../warcraft/battleNet";
import { listProcesses } from "../warcraft/processes";
import { parseWords, separateInk } from "../warcraft/desktop";
import { describeCause } from "./command";
import { decodePpm } from "./frameProbe";
import { type Collected, collect } from "./hostProcess";
import { skillScript, startService } from "./clientServices";
import { reportedMenus } from "./menus";
import { acquireStartLock, startLockPath } from "./startLock";
import { type DesktopWindow, PlayDesktop, PlayMachine, PlayProblem, type XWindow } from "./play";


export interface PlayTools {
  readonly grim: string;
  readonly xdotool: string;
  readonly tesseract: string;
  readonly niri: string;
  readonly steam: string;

  readonly nsenter: string;

  readonly capacity?: string;
}

export const PLAY_TOOLS: PlayTools = { grim: "grim", xdotool: "xdotool", tesseract: "tesseract", niri: "niri", steam: "steam", nsenter: "nsenter" };


export function hostNsenter(command: string): string {
  const path = Bun.which(command);
  if (path === null) throw new Error(`couldn't find ${command} on the host PATH`);
  return path;
}

const problem = (what: string) => (cause: unknown) => new PlayProblem({ problem: `${what}: ${describeCause(cause)}` });


const startDetached = (command: readonly string[], log?: string) => Effect.tryPromise({
  try: () => new Promise<number>((resolve, reject) => {
    let output: number | "ignore" = "ignore";
    if (log !== undefined) {
      mkdirSync(dirname(log), { recursive: true });
      output = openSync(log, "a");
    }
    const child = spawn(command[0]!, command.slice(1), { detached: true, stdio: ["ignore", output, output] });
    const close = () => {
      if (typeof output === "number") closeSync(output);
    };
    child.once("error", (error) => {
      close();
      reject(error);
    });
    child.once("spawn", () => {
      close();
      child.unref();
      resolve(child.pid!);
    });
  }),
  catch: problem(`couldn't start ${basename(command[0] ?? "")}`),
});











export interface LaunchRequest {
  readonly bun: string;
  readonly capacity: string;
  readonly client: string;
  readonly env: string;
  readonly nsenter: string;
  readonly wine: string;
  readonly launcher: { readonly pid: number; readonly cwd: string; readonly env: Readonly<Record<string, string>> };
  readonly host: Readonly<Record<string, string | undefined>>;
}

const HOST_KEYS = ["PATH", "XDG_RUNTIME_DIR", "DBUS_SESSION_BUS_ADDRESS"] as const;


export const launchCommand = (request: LaunchRequest) => {
  const { launcher } = request;
  const restore = HOST_KEYS.flatMap((key) => (launcher.env[key] === undefined ? ["-u", key] : [`${key}=${launcher.env[key]}`]));
  const host = Object.fromEntries(HOST_KEYS.flatMap((key) => (request.host[key] === undefined ? [] : [[key, request.host[key]!] as const])));
  return {
    command: [request.bun, request.capacity, "session", "--class", "native", "--owner", `wisp-game-${request.client}`, "--",
      request.env, ...restore, request.nsenter, "-t", String(launcher.pid), "-U", "-m", "--preserve-credentials", `--wd=${launcher.cwd}`, "--",
      request.wine, "C:\\Program Files (x86)\\Battle.net\\Battle.net.exe", "--exec=launch W3"],
    env: { ...launcher.env, ...host },
  };
};


export const capacityDeferral = (stderr: string) => /"decision":"DEFER","reason":"([A-Z_]+)"/.exec(stderr)?.[1];

class LaunchDeferred extends Schema.TaggedError<LaunchDeferred>()("LaunchDeferred", { reason: Schema.String }) {}

const LAUNCH_WAIT_SECONDS = 1800;


const launchInContainer = (run: Runner, tools: PlayTools, launcher: { readonly pid: number }, client: string) => Effect.gen(function*() {
  const failed = problem("couldn't ask Battle.net to launch Warcraft III");
  const capacity = tools.capacity ?? (yield* skillScript("machine-capacity", "scripts/machine-capacity.mjs").pipe(Effect.mapError((cause) => failed(cause.problem))));
  const request = yield* Effect.try({
    try: (): LaunchRequest => {
      const base = `/proc/${launcher.pid}`;
      const env = Object.fromEntries(readFileSync(`${base}/environ`, "utf8").split("\0").filter((entry) => entry.includes("="))
        .map((entry) => [entry.slice(0, entry.indexOf("=")), entry.slice(entry.indexOf("=") + 1)] as const)
        .filter(([name]) => name !== "WINESERVERSOCKET" && name !== "WINELOADERNOEXEC"));
      const wine = resolve(dirname(readlinkSync(`${base}/exe`)), "../../../bin/wine");
      return {
        bun: process.execPath, capacity, client, env: hostNsenter("env"), nsenter: hostNsenter(tools.nsenter), wine,
        launcher: { pid: launcher.pid, cwd: readlinkSync(`${base}/cwd`), env }, host: process.env,
      };
    },
    catch: failed,
  });
  const { command, env } = launchCommand(request);
  const deadline = Date.now() + LAUNCH_WAIT_SECONDS * 1000;
  const attempt = Effect.gen(function*() {
    const { exitCode, stderr } = yield* run(ChildProcess.make(command[0]!, command.slice(1), { env, stdin: "ignore", stdout: "ignore" })).pipe(
      Effect.mapError(failed),
      Effect.timeoutOrElse({ duration: "30 seconds", orElse: () => Effect.fail(failed("didn't exit within 30 s")) }),
    );
    const deferred = exitCode === 75 ? capacityDeferral(stderr) : undefined;
    if (deferred !== undefined) return yield* new LaunchDeferred({ reason: deferred });
    if (exitCode !== 0) return yield* failed(`exited ${exitCode}: ${stderr.trim().split("\n").slice(-3).join(" ")}`);
  });
  yield* attempt.pipe(
    Effect.tapError((failure) => failure._tag === "LaunchDeferred" && Date.now() < deadline ? Console.log(`${client}: waiting: the capacity helper defers launching Warcraft III (${failure.reason}); trying again in 45 s`) : Effect.void),
    Effect.retry({ schedule: Schedule.spaced("45 seconds"), while: (failure) => failure._tag === "LaunchDeferred" && Date.now() < deadline }),
    Effect.catchTag("LaunchDeferred", (failure) => Effect.fail(failed(`the capacity helper kept deferring it for ${LAUNCH_WAIT_SECONDS} s (${failure.reason})`))),
  );
});

const machine = (run: Runner, tools: PlayTools): PlayMachine["Service"] => ({
  processes: Effect.try({ try: listProcesses, catch: problem("couldn't read the process table") }),
  serverDirectory: (prefix) => Effect.try({
    try: () => {
      const stats = statSync(prefix, { bigint: true });
      return serverDirectoryName(stats.dev, stats.ino);
    },
    catch: () => new PlayProblem({ problem: `the Wine prefix ${prefix} doesn't exist` }),
  }),
  signal: (pids, signal) => Effect.sync(() => {
    for (const pid of pids) {
      try {
        process.kill(pid, signal);
      } catch {

      }
    }
  }),
  launch: (launcher, client) => launchInContainer(run, tools, launcher, client),
  openSteam: (url) => startDetached([tools.steam, url]).pipe(Effect.asVoid),
  start: startDetached,
  startService: (unit, command, log) => startService(unit, command, log).pipe(Effect.mapError((failure) => new PlayProblem({ problem: failure.problem }))),
  startLock: (holder, print) => acquireStartLock({ path: startLockPath(), holder, print }),
  read: (path, from = 0) => Effect.try({
    try: () => {
      let descriptor: number;
      try {
        descriptor = openSync(path, "r");
      } catch {
        return undefined;
      }
      try {
        const length = Math.max(0, fstatSync(descriptor).size - from);
        const buffer = Buffer.alloc(length);
        const read = readSync(descriptor, buffer, 0, length, from);
        return buffer.subarray(0, read).toString("utf8");
      } finally {
        closeSync(descriptor);
      }
    },
    catch: problem(`couldn't read ${path}`),
  }),
  size: (path) => Effect.try({ try: () => statSync(path, { throwIfNoEntry: false })?.size, catch: problem(`couldn't read ${path}`) }),
  modified: (path) => Effect.try({ try: () => statSync(path, { throwIfNoEntry: false })?.mtimeMs, catch: problem(`couldn't read ${path}`) }),
  digest: (path) => Effect.try({
    try: () => (statSync(path, { throwIfNoEntry: false }) === undefined ? undefined : createHash("sha256").update(readFileSync(path)).digest("hex")),
    catch: problem(`couldn't read ${path}`),
  }),
  list: (directory) => Effect.try({
    try: () => {
      try {
        return readdirSync(directory);
      } catch {
        return [];
      }
    },
    catch: problem(`couldn't list ${directory}`),
  }),
  write: (path, text) => Effect.try({
    try: () => {
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(`${path}.${process.pid}.next`, text);
      renameSync(`${path}.${process.pid}.next`, path);
    },
    catch: problem(`couldn't write ${path}`),
  }),
  copy: (from, to) => Effect.try({
    try: () => {
      mkdirSync(dirname(to), { recursive: true });
      copyFileSync(from, `${to}.${process.pid}.next`);
      renameSync(`${to}.${process.pid}.next`, to);
    },
    catch: problem(`couldn't copy ${from} to ${to}`),
  }),
});


type Runner = (command: ChildProcess.Command) => Effect.Effect<Collected, PlatformError.PlatformError>;

const runner = Effect.gen(function*() {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  return ((command) => collect(command).pipe(Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner))) satisfies Runner;
});


const tool = (run: Runner, command: readonly string[], env: Record<string, string>, stdin?: Uint8Array, allowExit: readonly number[] = []) => {
  const failed = problem(`${basename(command[0] ?? "")} ${command.slice(1, 3).join(" ")} failed`);
  return run(ChildProcess.make(command[0]!, command.slice(1), { env, extendEnv: true, stdin: stdin === undefined ? "ignore" : Stream.make(stdin) })).pipe(
    Effect.mapError(failed),
    Effect.flatMap(({ exitCode, stdout, stderr }) => (exitCode !== 0 && !allowExit.includes(exitCode) ? Effect.fail(failed(`exited ${exitCode}: ${stderr.trim()}`)) : Effect.succeed(stdout))),
  );
};

const text = (bytes: Uint8Array) => new TextDecoder().decode(bytes);

const NiriWindow = Schema.Struct({
  id: Schema.Int,
  title: Schema.NullOr(Schema.String),
  app_id: Schema.NullOr(Schema.String),
  workspace_id: Schema.NullOr(Schema.Int),
  is_focused: Schema.Boolean,
  layout: Schema.Struct({ window_size: Schema.Tuple([Schema.Int, Schema.Int]) }),
});
const NiriWorkspace = Schema.Struct({ id: Schema.Int, output: Schema.NullOr(Schema.String) });
const NiriOutput = Schema.Struct({
  name: Schema.String,
  logical: Schema.NullOr(Schema.Struct({ x: Schema.Int, y: Schema.Int, width: Schema.Int, height: Schema.Int })),
});


const niri = <S extends Schema.Top & { readonly DecodingServices: never }>(run: Runner, tools: PlayTools, what: string, schema: S) =>
  tool(run, [tools.niri, "msg", "--json", what], {}).pipe(
    Effect.flatMap((bytes) => Effect.try({ try: () => JSON.parse(text(bytes)) as unknown, catch: problem(`niri's ${what} reply isn't JSON`) })),
    Effect.flatMap((reply) => Schema.decodeUnknownEffect(Schema.Array(schema))(Array.isArray(reply) || reply === null || typeof reply !== "object" ? reply : Object.values(reply))),
    Effect.mapError((cause) => (cause instanceof PlayProblem ? cause : new PlayProblem({ problem: `niri's ${what} reply: ${describeCause(cause)}` }))),
  );

const shellValues = (output: string) =>
  Object.fromEntries(output.split("\n").filter((line) => line.includes("=")).map((line) => line.split("=", 2) as [string, string]));

const escapeTitle = (title: string) => title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const desktop = (run: Runner, tools: PlayTools, display: string): PlayDesktop["Service"] => {
  const x11 = { DISPLAY: display };
  const xdotool = (...args: string[]) => tool(run, [tools.xdotool, ...args], x11);
  return {
    windows: Effect.gen(function*() {
      const [windows, workspaces, outputs] = yield* Effect.all([niri(run, tools, "windows", NiriWindow), niri(run, tools, "workspaces", NiriWorkspace), niri(run, tools, "outputs", NiriOutput)]);
      return windows.map((window): DesktopWindow => {
        const outputName = workspaces.find((workspace) => workspace.id === window.workspace_id)?.output ?? undefined;
        const logical = outputs.find((output) => output.name === outputName)?.logical ?? undefined;
        return {
          id: window.id, title: window.title ?? "", appId: window.app_id ?? "", focused: window.is_focused,
          width: window.layout.window_size[0], height: window.layout.window_size[1],
          ...(outputName === undefined || logical === undefined ? {} : { output: { name: outputName, width: logical.width, height: logical.height } }),
        };
      });
    }),
    focus: (window) => tool(run, [tools.niri, "msg", "action", "focus-window", "--id", String(window)], {}).pipe(Effect.asVoid),
    toggleFullscreen: (window) => tool(run, [tools.niri, "msg", "action", "fullscreen-window", "--id", String(window)], {}).pipe(Effect.asVoid),
    read: (output, ink) => Effect.gen(function*() {
      const frame = decodePpm(yield* tool(run, [tools.grim, "-o", output, "-t", "ppm", "-"], {}));
      if (frame === undefined) return yield* new PlayProblem({ problem: `grim's capture of ${output} isn't a PPM image` });
      const tsv = text(yield* tool(run, [tools.tesseract, "stdin", "stdout", "--psm", "11", "tsv"], {}, separateInk(frame, ink)));
      return { width: frame.width, height: frame.height, words: parseWords(tsv) };
    }),
    xWindow: (title, pid) => Effect.gen(function*() {

      const ids = text(yield* tool(run, [tools.xdotool, "search", "--onlyvisible", "--name", `^${escapeTitle(title)}$`], x11, undefined, [1])).split("\n").filter((line) => line !== "");
      const candidates: { readonly window: XWindow; readonly owned: boolean }[] = [];
      for (const id of ids) {

        const owned = pid !== undefined && Number(text(yield* tool(run, [tools.xdotool, "getwindowpid", id], x11, undefined, [1])).trim()) === pid;
        const values = shellValues(text(yield* xdotool("getwindowgeometry", "--shell", id)));
        candidates.push({ owned, window: { id, x: Number(values.X), y: Number(values.Y), width: Number(values.WIDTH), height: Number(values.HEIGHT) } });
      }
      const preferred = candidates.some(({ owned }) => owned) ? candidates.filter(({ owned }) => owned) : candidates;
      return preferred.map(({ window }) => window).reduce<XWindow | undefined>((best, window) =>
        (best === undefined || window.width * window.height > best.width * best.height ? window : best), undefined);
    }),
    keys: (_window, ...keys) => xdotool("key", "--clearmodifiers", ...keys).pipe(Effect.asVoid),
    menus: (port) => reportedMenus(port).pipe(Effect.catchTag("MenuFailure", () => Effect.succeed(undefined))),
  };
};


export const playHostLayer = (display: string, tools: Partial<PlayTools> = {}) => {
  const resolved = { ...PLAY_TOOLS, ...tools };
  return Layer.mergeAll(
    Layer.effect(PlayMachine, Effect.map(runner, (run) => PlayMachine.of(machine(run, resolved)))),
    Layer.effect(PlayDesktop, Effect.map(runner, (run) => PlayDesktop.of(desktop(run, resolved, display)))),
  ).pipe(Layer.provide(BunServices.layer));
};


export const playMachineLayer = (tools: Partial<PlayTools> = {}) =>
  Layer.effect(PlayMachine, Effect.map(runner, (run) => PlayMachine.of(machine(run, { ...PLAY_TOOLS, ...tools })))).pipe(Layer.provide(BunServices.layer));
