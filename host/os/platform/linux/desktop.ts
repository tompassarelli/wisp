import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import * as BunServices from "@effect/platform-bun/BunServices";
import { Effect, Exit, Layer, Option } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/process";
import { type InputAction, type KeyAction, untypable, vncActions, vncKey } from "../../warcraft/inputBatch";
import { type Client, type ClientEntry, type ClientsConfig, DesktopFailure, type Region, ToplevelMissing, runTool, toolExit, toplevelMissing } from "../../warcraft/desktopClient";
import { skillScript } from "../../../process/hostProcess";
import { step } from "../../../process/timings";
import { InputInjection, ScreenCapture, type WindowTools } from "../services";

const fail = (operation: string, client: string) => (cause: unknown) => new DesktopFailure({ operation, client, cause });

const text = (bytes: Uint8Array) => new TextDecoder().decode(bytes);

const escapeTitle = (title: string) => title.replace(/[.\\^$|?*+()[\]{}]/g, "\\$&");

const shellValues = (output: string) =>
  Object.fromEntries(output.split("\n").filter((line) => line.includes("=")).map((line) => line.split("=", 2) as [string, string]));

export const desktopSession = (entry: ClientEntry) =>
  Effect.gen(function*() {
    const read = (file: string) =>
      Effect.tryPromise({ try: async () => (await Bun.file(join(entry.run, file)).text()).trim(), catch: fail(`read desktop ${file}`, entry.name) });
    const x11 = { DISPLAY: yield* read("display"), XAUTHORITY: yield* read("xauthority") };
    const wayland = { XDG_RUNTIME_DIR: join(entry.run, "runtime"), WAYLAND_DISPLAY: yield* read("wayland-display") };
    return { x11, wayland };
  });

const resolved = new Map<string, string>();

const resolveTool = (client: string, name: string) => Effect.gen(function*() {
  const known = name.includes("/") ? name : resolved.get(name) ?? Bun.which(name);
  if (known !== null && known !== undefined) return known;
  const built = text(yield* runTool(client, `find ${name}`, ["nix", "build", "--no-link", "--print-out-paths", `nixpkgs#${name}`], {})).trim().split("\n")[0] ?? "";
  const path = join(built, "bin", name);
  resolved.set(name, path);
  return path;
});

const resolveTools = (client: string, tools: ClientsConfig["tools"]) => Effect.gen(function*() {
  return {
    grim: yield* resolveTool(client, tools.grim),
    xdotool: yield* resolveTool(client, tools.xdotool),
    wlrctl: yield* resolveTool(client, tools.wlrctl),
    tesseract: yield* resolveTool(client, tools.tesseract),
  };
});

const findWindows = (entry: ClientEntry, xdotool: string, x11: Record<string, string>, title: string) =>
  runTool(entry.name, `find ${title} window`, [xdotool, "search", "--name", `^${escapeTitle(title)}$`], x11).pipe(
    Effect.map((bytes) => text(bytes).split("\n").filter((line) => line !== "")),
  );

/** Runs wlrctl's toplevel `action` on the toplevel titled `title`; succeeds with false when the compositor lists none, and fails when wlrctl can't ask it. */
const toplevel = (client: string, operation: string, wlrctl: string, action: "find" | "focus", title: string, wayland: Record<string, string>) =>
  toolExit(client, operation, [wlrctl, "toplevel", action, `title:${title}`], wayland).pipe(Effect.flatMap(({ code, stderr }) => {
    if (code === 0) return Effect.succeed(true);
    if (code === 1 && stderr === "") return Effect.succeed(false);
    return Effect.fail(new DesktopFailure({ operation, client, cause: `${wlrctl} exited ${code}: ${stderr}` }));
  }));

const focus = (client: Client, title: string, strict: boolean) =>
  Effect.gen(function*() {
    const named = strict && title === "Warcraft III" ? "Warcraft" : title;
    const focused = toplevel(client.name, `focus ${named}`, client.tools.wlrctl, "focus", title, client.wayland);
    if (strict && !(yield* focused)) return yield* new DesktopFailure({ operation: `focus ${named}`, client: client.name, cause: new ToplevelMissing({ title }) });
    if (!strict) yield* focused.pipe(Effect.ignore);
    yield* runTool(client.name, `activate ${named} window`, [client.tools.xdotool, "windowactivate", "--sync", client.window], client.x11);
  });

// Keys go through the desktop's VNC server, since Wine ignores VNC's modifier-only Shift; clicks stay on XTEST, since every VNC pointer event moves the game's pointer to the compositor's cursor.
const control = (client: Client, operation: string, actions: readonly string[]) => Effect.gen(function*() {
  if (client.run === undefined) return yield* new DesktopFailure({ operation, client: client.name, cause: "not on a private desktop, so there is no VNC server to send input through" });
  const launcher = yield* skillScript("private-desktop-development", "scripts/private-desktop.sh").pipe(Effect.mapError(fail(operation, client.name)));
  yield* runTool(client.name, operation, [launcher, "control", client.run, ...actions], {});
});

const send = (client: Client, operation: string, actions: readonly InputAction[]) => Effect.gen(function*() {
  const typed = actions.flatMap((action) => (action.kind === "text" ? [action.text] : [])).join("");
  const bad = untypable(typed);
  if (bad !== undefined) return yield* new DesktopFailure({ operation, client: client.name, cause: `${JSON.stringify(bad)} has no US-layout key; nothing was sent` });
  const steps = actions.reduce<(KeyAction[] | Extract<InputAction, { kind: "click" }>)[]>((out, action) => {
    const last = out.at(-1);
    if (action.kind === "click") out.push(action);
    else if (Array.isArray(last)) last.push(action);
    else out.push([action]);
    return out;
  }, []);
  const held = [...new Set(actions.flatMap((action) => (action.kind === "keys" ? action.keys : [])))];
  const release = [...held.flatMap((key) => ["keyup", vncKey(key)]), ...(typed === "" ? [] : ["keyup", "shift"])];
  const play = Effect.forEach(steps, (step) => {
    if (!Array.isArray(step)) return press(client, step.x, step.y, step.settleMillis, step.holdMillis);
    const planned = vncActions(step);
    return planned.length === 0 ? Effect.void : control(client, operation, planned);
  }, { discard: true });
  yield* Effect.acquireUseRelease(Effect.void, () => play, (_, exit) => Exit.isSuccess(exit) ? Effect.void : Effect.all([
    actions.some((action) => action.kind === "click") ? runTool(client.name, `release button after ${operation}`, [client.tools.xdotool, "mouseup", "1"], client.x11) : Effect.void,
    release.length === 0 ? Effect.void : control(client, `release after ${operation}`, release),
  ], { discard: true }).pipe(Effect.ignore));
});

const preflight = (client: Client) => Effect.gen(function*() {
  yield* focus(client, "Warcraft III", true);
  const active = text(yield* runTool(client.name, "input preflight focus", [client.tools.xdotool, "getactivewindow"], client.x11)).trim();
  if (active !== client.window) return yield* new DesktopFailure({ operation: "input preflight focus", client: client.name, cause: `window ${active} is active, expected ${client.window} on ${client.x11.DISPLAY}` });
  yield* control(client, "input preflight connection", ["pause", "0"]);
}).pipe(
  Effect.mapError(cause => new DesktopFailure({ operation: "input preflight", client: client.name, cause: toplevelMissing(cause) ? cause.cause : `${client.x11.DISPLAY}: ${cause.message}` })),
  Effect.timeoutOrElse({ duration: "12 seconds", orElse: () => Effect.fail(new DesktopFailure({ operation: "input preflight", client: client.name, cause: `display/focus/VNC check exceeded 12 s on ${client.x11.DISPLAY}` })) }),
);

const pointer = (client: Client) =>
  runTool(client.name, "read pointer", [client.tools.xdotool, "getmouselocation", "--shell"], client.x11).pipe(
    Effect.map((bytes) => {
      const fields = shellValues(text(bytes));
      return { x: Number(fields.X), y: Number(fields.Y) };
    }),
  );

const POINTER_TRIES = 3;

function movePointer(client: Client, x: number, y: number) {
  return Effect.gen(function*() {
    for (let attempt = 0; ; attempt++) {
      const at = yield* pointer(client);
      if (at.x === x && at.y === y) return;
      if (attempt === POINTER_TRIES) return yield* new DesktopFailure({ operation: "move pointer", client: client.name, cause: `pointer at ${at.x},${at.y} after ${POINTER_TRIES} moves, wanted ${x},${y}` });
      if (attempt > 0 && client.run !== undefined) yield* control(client, "create compositor pointer", ["move", String(x), String(y)]);
      yield* runTool(client.name, "move pointer", [client.tools.xdotool, "mousemove_relative", "--", String(x - at.x), String(y - at.y)], client.x11);
    }
  });
}

function press(client: Client, x: number, y: number, settleMillis = 120, holdMillis = 60) {
  return Effect.gen(function*() {
    yield* movePointer(client, x, y);
    yield* Effect.sleep(`${settleMillis} millis`);
    yield* runTool(client.name, "press button", [client.tools.xdotool, "mousedown", "1"], client.x11);
    yield* Effect.sleep(`${holdMillis} millis`);
    yield* runTool(client.name, "release button", [client.tools.xdotool, "mouseup", "1"], client.x11);
  });
}

const pressAt = (client: Client, x: number, y: number) => press(client, x, y);

const batch = (client: Client, actions: readonly InputAction[]) =>
  send(client, "input batch", actions).pipe(step(`${client.name}: input batch (${actions.length} actions)`));

export const linuxDesktopLayer = Layer.mergeAll(
  Layer.succeed(ScreenCapture, ScreenCapture.of({
    frame: (client, region?: Region) => {
      const geometry = region === undefined ? [] : ["-g", `${region.x},${region.y} ${region.width}x${region.height}`];
      return runTool(client.name, "capture frame", [client.tools.grim, "-t", "ppm", ...geometry, "-"], client.wayland);
    },
  })),
  Layer.succeed(InputInjection, InputInjection.of({
    tools: Effect.succeed({ grim: "grim", xdotool: "xdotool", wlrctl: "wlrctl", tesseract: "tesseract" }),
    windows: (config, entry, title, strict) => Effect.gen(function*() {
      const { x11, wayland } = yield* desktopSession(entry);
      const tools = yield* resolveTools(entry.name, config.tools);
      const found = findWindows(entry, tools.xdotool, x11, title);
      const windows = yield* (strict ? found : found.pipe(Effect.catchTag("DesktopFailure", () => Effect.succeed([] as string[]))));
      const { name, documents, menuReportPort, run } = entry;
      return windows.map((window): Client => ({ name, documents, ...(menuReportPort === undefined ? {} : { menuReportPort }), run, tools, x11, wayland, window }));
    }),
    sessionEnvironment: (run) => {
      const read = (file: string) => (existsSync(join(run, file)) ? readFileSync(join(run, file), "utf8").trim() : "");
      return { DISPLAY: read("display"), WAYLAND_DISPLAY: read("wayland-display"), XAUTHORITY: read("xauthority"), XDG_RUNTIME_DIR: join(run, "runtime") };
    },
    windowTools: Effect.gen(function*() {
      const output = (command: string, args: readonly string[], env: Readonly<Record<string, string>>) =>
        ChildProcessSpawner.ChildProcessSpawner.use((spawner) => spawner.string(ChildProcess.make(command, args, { env, extendEnv: true, stderr: "ignore" }))).pipe(
          Effect.timeout("5 seconds"),
          Effect.orElseSucceed(() => ""),
          Effect.provide(BunServices.layer),
        );
      const xdotool = process.env["WISP_XDOTOOL"] ?? Bun.which("xdotool") ?? (yield* output("nix", ["build", "--no-link", "--print-out-paths", "nixpkgs#xdotool"], {}).pipe(
        Effect.map((built) => (built.trim() === "" ? undefined : join(built.trim().split("\n")[0] ?? "", "bin/xdotool"))),
      ));
      if (xdotool === undefined) return Option.none();
      const place: WindowTools["place"] = (env, title, region) => Effect.gen(function*() {
        let placed = 0;
        for (const window of (yield* output(xdotool, ["search", "--name", `^${escapeTitle(title)}$`], env)).split("\n").filter((id) => id !== "")) {
          const geometry = yield* output(xdotool, ["getwindowgeometry", window], env);
          if (geometry.includes(`Position: ${region.x},${region.y} `) && [0, 4].some((border) => geometry.includes(`Geometry: ${region.width + border}x${region.height + border}`))) continue;
          yield* output(xdotool, ["windowsize", window, String(region.width), String(region.height), "windowmove", window, String(region.x), String(region.y)], env);
          placed++;
        }
        return placed;
      });
      const shown: WindowTools["shown"] = (env, title) => Effect.gen(function*() {
        if ((yield* output(xdotool, ["search", "--name", `^${escapeTitle(title)}$`], env)).trim() !== "") return true;
        if ((yield* output(xdotool, ["getdisplaygeometry"], env)).trim() !== "") return false;
        return yield* new DesktopFailure({ operation: `look for the ${title} window`, client: env["DISPLAY"] ?? process.env["DISPLAY"] ?? "no display", cause: "xdotool can't reach the display" });
      });
      const listed: WindowTools["listed"] = (env, title) => Effect.gen(function*() {
        const where = env["WAYLAND_DISPLAY"] ?? process.env["WAYLAND_DISPLAY"] ?? "no compositor";
        const wlrctl = yield* resolveTool(where, process.env["WISP_WLRCTL"] ?? "wlrctl");
        return yield* toplevel(where, `list the ${title} toplevel`, wlrctl, "find", title, { ...env });
      });
      return Option.some({ place, shown, listed });
    }),
    display: (entry) => desktopSession(entry).pipe(Effect.map(({ x11 }) => x11.DISPLAY)),
    preflight,
    focus,
    activeWindow: (client) => runTool(client.name, "read active window", [client.tools.xdotool, "getactivewindow"], client.x11).pipe(Effect.map((bytes) => text(bytes).trim())),
    windowRegion: (client) => runTool(client.name, "read window geometry", [client.tools.xdotool, "getwindowgeometry", "--shell", client.window], client.x11).pipe(Effect.map((bytes): Region => {
      const fields = shellValues(text(bytes));
      return { x: Number(fields.X), y: Number(fields.Y), width: Number(fields.WIDTH), height: Number(fields.HEIGHT) };
    })),
    windowPid: (client) => Effect.gen(function*() {
      const pid = Number(text(yield* runTool(client.name, "read window process", [client.tools.xdotool, "getwindowpid", client.window], client.x11)).trim());
      if (!Number.isInteger(pid) || pid <= 0) return yield* new DesktopFailure({ operation: "read window process", client: client.name, cause: `no process for window ${client.window}` });
      return pid;
    }),
    keys: (client, names) => send(client, `press ${names.join(" ")}`, [{ kind: "keys", keys: names }]),
    pressKeys: (client, names, operation) => runTool(client.name, operation, [client.tools.xdotool, "key", "--clearmodifiers", ...names], client.x11).pipe(Effect.asVoid),
    typeText: (client, value, delayMillis) => send(client, "type text", [{ kind: "text", text: value, ...(delayMillis === undefined ? {} : { delayMillis }) }]),
    typeSecret: (client, secret) => runTool(client.name, "type sign-in field", [client.tools.xdotool, "type", "--clearmodifiers", "--file", "-"], client.x11, secret).pipe(Effect.asVoid),
    pressAt,
    batch,
  })),
);
