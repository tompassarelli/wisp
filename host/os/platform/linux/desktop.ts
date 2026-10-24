import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import * as BunServices from "@effect/platform-bun/BunServices";
import { Effect, Exit, Layer, Option } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/process";
import { type InputAction, untypable, vncActions, vncKey } from "../../warcraft/inputBatch";
import { type Client, type ClientEntry, type ClientsConfig, DesktopFailure, type Region, runTool } from "../../warcraft/desktopClient";
import { skillScript } from "../../../cli/hostProcess";
import { step } from "../../../cli/timings";
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

const focus = (client: Client, title: string, strict: boolean) =>
  Effect.gen(function*() {
    const named = strict && title === "Warcraft III" ? "Warcraft" : title;
    const toplevel = runTool(client.name, `focus ${named}`, [client.tools.wlrctl, "toplevel", "focus", `title:${title}`], client.wayland);
    yield* strict ? toplevel : toplevel.pipe(Effect.ignore);
    yield* runTool(client.name, `activate ${named} window`, [client.tools.xdotool, "windowactivate", "--sync", client.window], client.x11);
  });

// Input goes through the desktop's own VNC server: headless labwc drops XTEST pointer motion, and Wine ignores VNC's modifier-only Shift.
const control = (client: Client, operation: string, actions: readonly string[]) => Effect.gen(function*() {
  if (client.run === undefined) return yield* new DesktopFailure({ operation, client: client.name, cause: "not on a private desktop, so there is no VNC server to send input through" });
  const launcher = yield* skillScript("private-desktop-development", "scripts/private-desktop.sh").pipe(Effect.mapError(fail(operation, client.name)));
  yield* runTool(client.name, operation, [launcher, "control", client.run, ...actions], {});
});

const send = (client: Client, operation: string, actions: readonly InputAction[]) => Effect.gen(function*() {
  const typed = actions.flatMap((action) => (action.kind === "text" ? [action.text] : [])).join("");
  const bad = untypable(typed);
  if (bad !== undefined) return yield* new DesktopFailure({ operation, client: client.name, cause: `${JSON.stringify(bad)} has no US-layout key; nothing was sent` });
  const planned = vncActions(actions);
  if (planned.length === 0) return;
  const held = [...new Set(actions.flatMap((action) => (action.kind === "keys" ? action.keys : [])))];
  const clicks = actions.some((action) => action.kind === "click");
  const release = [...(clicks ? ["mouseup", "1"] : []), ...held.flatMap((key) => ["keyup", vncKey(key)]), ...(typed === "" ? [] : ["keyup", "shift"])];
  yield* Effect.acquireUseRelease(Effect.void, () => control(client, operation, planned), (_, exit) =>
    Exit.isSuccess(exit) || release.length === 0 ? Effect.void : control(client, `release after ${operation}`, release).pipe(Effect.ignore));
});

const preflight = (client: Client) => Effect.gen(function*() {
  yield* focus(client, "Warcraft III", true);
  const active = text(yield* runTool(client.name, "input preflight focus", [client.tools.xdotool, "getactivewindow"], client.x11)).trim();
  if (active !== client.window) return yield* new DesktopFailure({ operation: "input preflight focus", client: client.name, cause: `window ${active} is active, expected ${client.window} on ${client.x11.DISPLAY}` });
  yield* control(client, "input preflight connection", ["pause", "0"]);
}).pipe(
  Effect.mapError(cause => new DesktopFailure({ operation: "input preflight", client: client.name, cause: `${client.x11.DISPLAY}: ${cause.message}` })),
  Effect.timeoutOrElse({ duration: "12 seconds", orElse: () => Effect.fail(new DesktopFailure({ operation: "input preflight", client: client.name, cause: `display/focus/VNC check exceeded 12 s on ${client.x11.DISPLAY}` })) }),
);

const pointer = (client: Client) =>
  runTool(client.name, "read pointer", [client.tools.xdotool, "getmouselocation", "--shell"], client.x11).pipe(
    Effect.map((bytes) => {
      const fields = shellValues(text(bytes));
      return { x: Number(fields.X), y: Number(fields.Y) };
    }),
  );

const pressOnOwnDesktop = (client: Client, x: number, y: number) =>
  Effect.gen(function*() {
    const from = yield* pointer(client);
    yield* runTool(client.name, "move pointer", [client.tools.xdotool, "mousemove_relative", "--", String(x - from.x), String(y - from.y)], client.x11);
    const at = yield* pointer(client);
    if (at.x !== x || at.y !== y) return yield* new DesktopFailure({ operation: "move pointer", client: client.name, cause: `pointer at ${at.x},${at.y}, wanted ${x},${y}` });
    yield* Effect.sleep("120 millis");
    yield* runTool(client.name, "press button", [client.tools.xdotool, "mousedown", "1"], client.x11);
    yield* Effect.sleep("60 millis");
    yield* runTool(client.name, "release button", [client.tools.xdotool, "mouseup", "1"], client.x11);
  });

const pressAt = (client: Client, x: number, y: number) =>
  client.run === undefined ? pressOnOwnDesktop(client, x, y) : send(client, `click ${x},${y}`, [{ kind: "click", x, y }]);

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
      return Option.some({ place, shown });
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
