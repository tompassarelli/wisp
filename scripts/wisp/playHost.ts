// The live machine and desktop `play` runs on: /proc, files and Steam on the
// host; niri's IPC, grim, Tesseract and xdotool on the owner's desktop. The
// game's X display is the declared one; niri and grim use the environment play
// runs in, which on the owner's desktop names its compositor.
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { closeSync, copyFileSync, fstatSync, mkdirSync, openSync, readFileSync, readSync, readdirSync, readlinkSync, renameSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import * as BunServices from "@effect/platform-bun/BunServices";
import { Effect, Layer, type PlatformError, Schema, Stream } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/process";
import { serverDirectoryName } from "../warcraft/battleNet";
import { listProcesses } from "../warcraft/processes";
import { parseWords, separateInk } from "../warcraft/desktop";
import { describeCause } from "./command";
import { decodePpm } from "./frameProbe";
import { type Collected, collect } from "./hostProcess";
import { reportedMenus } from "./menus";
import { type DesktopWindow, PlayDesktop, PlayMachine, PlayProblem, type XWindow } from "./play";

/** The programs play runs; each is a command name on PATH or a path. */
export interface PlayTools {
  readonly grim: string;
  readonly xdotool: string;
  readonly tesseract: string;
  readonly niri: string;
  readonly steam: string;
  /** util-linux nsenter, which runs the launch request inside the launcher's runtime container. */
  readonly nsenter: string;
}

export const PLAY_TOOLS: PlayTools = { grim: "grim", xdotool: "xdotool", tesseract: "tesseract", niri: "niri", steam: "steam", nsenter: "nsenter" };

/** Resolve on the host before replacing PATH with the launcher's environment. */
export function hostNsenter(command: string): string {
  const path = Bun.which(command);
  if (path === null) throw new Error(`couldn't find ${command} on the host PATH`);
  return path;
}

const problem = (what: string) => (cause: unknown) => new PlayProblem({ problem: `${what}: ${describeCause(cause)}` });

/** Starts a program in its own session, so it outlives play and the terminal's signals. */
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

/**
 * Battle.net.exe --exec="launch W3" in the running launcher's container. Each
 * Steam runtime container has its own /tmp, where Wine keeps the wineserver's
 * socket, so a Wine started outside would start a second wineserver on the
 * prefix. Joining the launcher's user and mount namespaces (they are this
 * user's) with its environment reaches its wineserver. Its WINESERVERSOCKET is
 * an inherited descriptor, so the new process finds the server by its socket
 * instead. Proton's wine is three folders above the launcher's
 * wine-preloader (files/lib/wine/i386-unix).
 */
const launchInContainer = (run: Runner, tools: PlayTools, launcher: { readonly pid: number }) => Effect.gen(function*() {
  const failed = problem("couldn't ask Battle.net to launch Warcraft III");
  const { env, wine, nsenter, cwd } = yield* Effect.try({
    try: () => {
      const base = `/proc/${launcher.pid}`;
      const env = Object.fromEntries(readFileSync(`${base}/environ`, "utf8").split("\0").filter((entry) => entry.includes("="))
        .map((entry) => [entry.slice(0, entry.indexOf("=")), entry.slice(entry.indexOf("=") + 1)] as const)
        .filter(([name]) => name !== "WINESERVERSOCKET" && name !== "WINELOADERNOEXEC"));
      const wine = resolve(dirname(readlinkSync(`${base}/exe`)), "../../../bin/wine");
      return { env, wine, nsenter: hostNsenter(tools.nsenter), cwd: readlinkSync(`${base}/cwd`) };
    },
    catch: failed,
  });
  const child = ChildProcess.make(nsenter, ["-t", String(launcher.pid), "-U", "-m", "--preserve-credentials", `--wd=${cwd}`, "--",
    wine, "C:\\Program Files (x86)\\Battle.net\\Battle.net.exe", "--exec=launch W3"], { env, stdin: "ignore", stdout: "ignore" });
  const { exitCode, stderr } = yield* run(child).pipe(
    Effect.mapError(failed),
    Effect.timeoutOrElse({ duration: "30 seconds", orElse: () => Effect.fail(failed("didn't exit within 30 s")) }),
  );
  if (exitCode !== 0) return yield* failed(`exited ${exitCode}: ${stderr.trim().split("\n").slice(-3).join(" ")}`);
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
        // Already gone.
      }
    }
  }),
  launch: (launcher) => launchInContainer(run, tools, launcher),
  openSteam: (url) => startDetached([tools.steam, url]).pipe(Effect.asVoid),
  start: startDetached,
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

/** Runs a child to completion in its own scope, so interrupting the step stops and reaps it. */
type Runner = (command: ChildProcess.Command) => Effect.Effect<Collected, PlatformError.PlatformError>;

const runner = Effect.gen(function*() {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  return ((command) => collect(command).pipe(Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner))) satisfies Runner;
});

/** Runs a tool to completion; its stdout on success. A nonzero exit is a problem unless `allowExit` lists it. */
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

/** `niri msg --json` replies, decoded; outputs come keyed by name. */
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
      // xdotool search exits 1 when no window matches.
      const ids = text(yield* tool(run, [tools.xdotool, "search", "--onlyvisible", "--name", `^${escapeTitle(title)}$`], x11, undefined, [1])).split("\n").filter((line) => line !== "");
      const candidates: { readonly window: XWindow; readonly owned: boolean }[] = [];
      for (const id of ids) {
        // Wine sets _NET_WM_PID to the Linux process; a window without one is still a candidate.
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

/** The live machine and the owner's desktop, with the game on X display `display`. */
export const playHostLayer = (display: string, tools: Partial<PlayTools> = {}) => {
  const resolved = { ...PLAY_TOOLS, ...tools };
  return Layer.mergeAll(
    Layer.effect(PlayMachine, Effect.map(runner, (run) => PlayMachine.of(machine(run, resolved)))),
    Layer.effect(PlayDesktop, Effect.map(runner, (run) => PlayDesktop.of(desktop(run, resolved, display)))),
  ).pipe(Layer.provide(BunServices.layer));
};

/** The host alone (processes, files, Steam), for commands that drive no desktop of their own, like `doctor`. */
export const playMachineLayer = (tools: Partial<PlayTools> = {}) =>
  Layer.effect(PlayMachine, Effect.map(runner, (run) => PlayMachine.of(machine(run, { ...PLAY_TOOLS, ...tools })))).pipe(Layer.provide(BunServices.layer));
