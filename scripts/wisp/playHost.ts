// The live machine and desktop `play` runs on: /proc, files and Steam on the
// host; niri's IPC, grim, Tesseract, wlrctl and xdotool on the owner's
// desktop. The game's X display is the declared one; niri, grim and wlrctl use
// the environment play runs in, which on the owner's desktop names its
// compositor.
//
// The pointer moves through the compositor (wlrctl's virtual pointer), as a
// mouse does: on the owner's desktop the X pointer stays where the
// compositor's pointer is, so XTEST motion doesn't move it.
import { spawn } from "node:child_process";
import { appendFileSync, closeSync, fstatSync, mkdirSync, openSync, readFileSync, readSync, readdirSync, readlinkSync, statSync } from "node:fs";
import { basename, dirname } from "node:path";
import { Clock, Effect, Layer, Schema } from "effect";
import { type ProcessInfo, serverDirectoryName } from "../warcraft/battleNet";
import { parseWords, separateInk } from "../warcraft/desktop";
import { describeCause } from "./command";
import { decodePpm } from "./frameProbe";
import { type DesktopWindow, PlayDesktop, PlayMachine, PlayProblem, type XWindow, pointerMove, spotTargets } from "./play";

/** The programs play runs; each is a command name on PATH or a path. */
export interface PlayTools {
  readonly grim: string;
  readonly xdotool: string;
  readonly tesseract: string;
  readonly wlrctl: string;
  readonly niri: string;
  readonly steam: string;
}

export const PLAY_TOOLS: PlayTools = { grim: "grim", xdotool: "xdotool", tesseract: "tesseract", wlrctl: "wlrctl", niri: "niri", steam: "steam" };

const problem = (what: string) => (cause: unknown) => new PlayProblem({ problem: `${what}: ${describeCause(cause)}` });

const readText = (path: string) => {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return undefined;
  }
};

/** Only Wine's processes need their environment and the wineserver its directory; reading every process's would cost each poll. */
const wineLike = (name: string, args: readonly string[]) => name === "wineserver" || args.some((arg) => /\.exe\b/i.test(arg));

function listProcesses(): ProcessInfo[] {
  const found: ProcessInfo[] = [];
  for (const entry of readdirSync("/proc")) {
    if (!/^\d+$/.test(entry)) continue;
    const base = `/proc/${entry}`;
    const cmdline = readText(`${base}/cmdline`);
    const name = readText(`${base}/comm`)?.trim();
    // The process exited while the table was read.
    if (cmdline === undefined || name === undefined) continue;
    const args = cmdline.split("\0");
    if (args.at(-1) === "") args.pop();
    const process: { -readonly [K in keyof ProcessInfo]: ProcessInfo[K] } = { pid: Number(entry), name, args };
    if (wineLike(name, args)) {
      for (const variable of (readText(`${base}/environ`) ?? "").split("\0")) {
        if (variable.startsWith("WINEPREFIX=")) process.prefix = variable.slice("WINEPREFIX=".length).replace(/\/+$/, "");
        if (variable.startsWith("DISPLAY=")) process.display = variable.slice("DISPLAY=".length);
      }
      if (name === "wineserver") {
        try {
          process.cwd = readlinkSync(`${base}/cwd`);
        } catch {
          // Another user's or an exited process.
        }
      }
    }
    found.push(process);
  }
  return found;
}

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

const machine = (tools: PlayTools): PlayMachine["Service"] => ({
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
  append: (path, text) => Effect.try({
    try: () => {
      mkdirSync(dirname(path), { recursive: true });
      appendFileSync(path, text);
    },
    catch: problem(`couldn't write ${path}`),
  }),
});

/** Runs a tool to completion; its stdout on success. A nonzero exit is a problem unless `allowExit` lists it. */
const run = (command: readonly string[], env: Record<string, string>, stdin?: Uint8Array, allowExit: readonly number[] = []) => Effect.tryPromise({
  try: async () => {
    const child = Bun.spawn([...command], { env: { ...Bun.env, ...env }, stdin: stdin ?? "ignore", stdout: "pipe", stderr: "pipe" });
    const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).arrayBuffer(), new Response(child.stderr).text(), child.exited]);
    if (code !== 0 && !allowExit.includes(code)) throw new Error(`exited ${code}: ${stderr.trim()}`);
    return new Uint8Array(stdout);
  },
  catch: problem(`${basename(command[0] ?? "")} ${command.slice(1, 3).join(" ")} failed`),
});

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
const niri = <S extends Schema.Top & { readonly DecodingServices: never }>(tools: PlayTools, what: string, schema: S) =>
  run([tools.niri, "msg", "--json", what], {}).pipe(
    Effect.flatMap((bytes) => Effect.try({ try: () => JSON.parse(text(bytes)) as unknown, catch: problem(`niri's ${what} reply isn't JSON`) })),
    Effect.flatMap((reply) => Schema.decodeUnknownEffect(Schema.Array(schema))(Array.isArray(reply) || reply === null || typeof reply !== "object" ? reply : Object.values(reply))),
    Effect.mapError((cause) => (cause instanceof PlayProblem ? cause : new PlayProblem({ problem: `niri's ${what} reply: ${describeCause(cause)}` }))),
  );

const shellValues = (output: string) =>
  Object.fromEntries(output.split("\n").filter((line) => line.includes("=")).map((line) => line.split("=", 2) as [string, string]));

const escapeTitle = (title: string) => title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const desktop = (tools: PlayTools, display: string): PlayDesktop["Service"] => {
  const x11 = { DISPLAY: display };
  const xdotool = (...args: string[]) => run([tools.xdotool, ...args], x11);
  const pointer = xdotool("getmouselocation", "--shell").pipe(Effect.map((bytes) => {
    const values = shellValues(text(bytes));
    return { x: Number(values.X), y: Number(values.Y) };
  }));
  return {
    windows: Effect.gen(function*() {
      const [windows, workspaces, outputs] = yield* Effect.all([niri(tools, "windows", NiriWindow), niri(tools, "workspaces", NiriWorkspace), niri(tools, "outputs", NiriOutput)]);
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
    focus: (window) => run([tools.niri, "msg", "action", "focus-window", "--id", String(window)], {}).pipe(Effect.asVoid),
    toggleFullscreen: (window) => run([tools.niri, "msg", "action", "fullscreen-window", "--id", String(window)], {}).pipe(Effect.asVoid),
    read: (output, ink) => Effect.gen(function*() {
      const frame = decodePpm(yield* run([tools.grim, "-o", output, "-t", "ppm", "-"], {}));
      if (frame === undefined) return yield* new PlayProblem({ problem: `grim's capture of ${output} isn't a PPM image` });
      const tsv = text(yield* run([tools.tesseract, "stdin", "stdout", "--psm", "11", "tsv"], {}, separateInk(frame, ink)));
      return { width: frame.width, height: frame.height, words: parseWords(tsv) };
    }),
    xWindow: (title, pid) => Effect.gen(function*() {
      // xdotool search exits 1 when no window matches.
      const ids = text(yield* run([tools.xdotool, "search", "--onlyvisible", "--name", `^${escapeTitle(title)}$`], x11, undefined, [1])).split("\n").filter((line) => line !== "");
      const candidates: { readonly window: XWindow; readonly owned: boolean }[] = [];
      for (const id of ids) {
        // Wine sets _NET_WM_PID to the Linux process; a window without one is still a candidate.
        const owned = pid !== undefined && Number(text(yield* run([tools.xdotool, "getwindowpid", id], x11, undefined, [1])).trim()) === pid;
        const values = shellValues(text(yield* xdotool("getwindowgeometry", "--shell", id)));
        candidates.push({ owned, window: { id, x: Number(values.X), y: Number(values.Y), width: Number(values.WIDTH), height: Number(values.HEIGHT) } });
      }
      const preferred = candidates.some(({ owned }) => owned) ? candidates.filter(({ owned }) => owned) : candidates;
      return preferred.map(({ window }) => window).reduce<XWindow | undefined>((best, window) =>
        (best === undefined || window.width * window.height > best.width * best.height ? window : best), undefined);
    }),
    snapshot: (output, path) => Effect.gen(function*() {
      yield* Effect.try({ try: () => mkdirSync(dirname(path), { recursive: true }), catch: problem(`couldn't create ${dirname(path)}`) });
      yield* run([tools.grim, "-o", output, "-t", "jpeg", "-q", "80", path], {});
    }),
    click: (spot) => Effect.gen(function*() {
      const output = (yield* niri(tools, "outputs", NiriOutput)).find(({ name }) => name === spot.output)?.logical ?? undefined;
      if (output === undefined) return yield* new PlayProblem({ problem: `niri has no output ${spot.output}` });
      const { logical, root } = spotTargets(spot, output);
      // One logical pixel, in X pixels.
      const tolerance = Math.max(1, Math.ceil(spot.window.width / output.width));
      const arrived = (at: { readonly x: number; readonly y: number }) => Math.abs(at.x - root.x) <= tolerance && Math.abs(at.y - root.y) <= tolerance;
      const moves = [`target logical ${logical.x.toFixed(1)},${logical.y.toFixed(1)}, X root ${root.x},${root.y}`];
      let at = yield* pointer;
      moves.push(`pointer at X ${at.x},${at.y}`);
      // The X pointer can be stale until the compositor's pointer moves over an X window, so the move is corrected from where it lands.
      for (let move = 0; move < 4 && !arrived(at); move++) {
        const { dx, dy } = pointerMove(spot, output, at);
        // getopt would read a negative distance as an option; POSIXLY_CORRECT ends options at "pointer".
        yield* run([tools.wlrctl, "pointer", "move", dx.toFixed(1), dy.toFixed(1)], { POSIXLY_CORRECT: "1" });
        const from = at;
        const deadline = (yield* Clock.currentTimeMillis) + 1000;
        do {
          yield* Effect.sleep("20 millis");
          at = yield* pointer;
        } while (at.x === from.x && at.y === from.y && (yield* Clock.currentTimeMillis) < deadline);
        moves.push(`moved ${dx.toFixed(1)},${dy.toFixed(1)} -> X ${at.x},${at.y}`);
      }
      if (!arrived(at)) return yield* new PlayProblem({ problem: `the pointer stopped at ${at.x},${at.y} instead of ${root.x},${root.y} (X root pixels) over window ${spot.window.id}: ${moves.join("; ")}` });
      // The game reads the move before the press.
      yield* Effect.sleep("120 millis");
      yield* run([tools.wlrctl, "pointer", "click", "left"], {});
      moves.push("clicked");
      return moves;
    }),
    keys: (_window, ...keys) => xdotool("key", "--clearmodifiers", ...keys).pipe(Effect.asVoid),
    typeText: (_window, value) => xdotool("type", "--clearmodifiers", "--delay", "12", "--", value).pipe(Effect.asVoid),
  };
};

/** The live machine and the owner's desktop, with the game on X display `display`. */
export const playHostLayer = (display: string, tools: Partial<PlayTools> = {}) => {
  const resolved = { ...PLAY_TOOLS, ...tools };
  return Layer.merge(Layer.succeed(PlayMachine, PlayMachine.of(machine(resolved))), Layer.succeed(PlayDesktop, PlayDesktop.of(desktop(resolved, display))));
};
