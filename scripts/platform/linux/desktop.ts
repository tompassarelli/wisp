import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import * as BunServices from "@effect/platform-bun/BunServices";
import { Effect, Exit, Layer, Option } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/process";
import { inputBatches, sendsChat } from "../../warcraft/inputBatch";
import { type Client, type ClientEntry, type ClientsConfig, DesktopFailure, type Region, runTool } from "../../warcraft/desktop";
import { captureProcess } from "../../wisp/mapBuild";
import { step } from "../../wisp/timings";
import { InputInjection, ScreenCapture, type WindowPlacer } from "../services";

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

const findWindows = (config: ClientsConfig, entry: ClientEntry, x11: Record<string, string>, title: string) =>
  runTool(entry.name, `find ${title} window`, [config.tools.xdotool, "search", "--name", `^${escapeTitle(title)}$`], x11).pipe(
    Effect.map((bytes) => text(bytes).split("\n").filter((line) => line !== "")),
  );

const pointer = (client: Client) =>
  runTool(client.name, "read pointer", [client.tools.xdotool, "getmouselocation", "--shell"], client.x11).pipe(
    Effect.map((bytes) => {
      const fields = shellValues(text(bytes));
      return { x: Number(fields.X), y: Number(fields.Y) };
    }),
  );

const focus = (client: Client, title: string, strict: boolean) =>
  Effect.gen(function*() {
    const named = strict && title === "Warcraft III" ? "Warcraft" : title;
    const toplevel = runTool(client.name, `focus ${named}`, [client.tools.wlrctl, "toplevel", "focus", `title:${title}`], client.wayland);
    yield* strict ? toplevel : toplevel.pipe(Effect.ignore);
    yield* runTool(client.name, `activate ${named} window`, [client.tools.xdotool, "windowactivate", "--sync", client.window], client.x11);
  });

const pressAt = (client: Client, x: number, y: number) =>
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

const batch = Effect.fnUntraced(function*(client: Client, actions: Parameters<InputInjection["Service"]["batch"]>[1]) {
  if (actions.length === 0) return;
  const moved = actions.some((action) => action.kind === "click");
  const from = moved ? yield* pointer(client) : { x: 0, y: 0 };
  const plan = inputBatches(actions, from);
  const environment = Object.fromEntries(Object.entries(Bun.env).filter((entry): entry is [string, string] => entry[1] !== undefined));
  const runBatch = (args: readonly string[]) => captureProcess("run input batch", client.name, [client.tools.xdotool, ...args], {
    env: { ...environment, ...client.x11 },
  }).pipe(
    Effect.mapError((cause) => new DesktopFailure({ operation: "run input batch", client: client.name, cause })),
    Effect.flatMap(({ exitCode, stdout, stderr }) => exitCode === 0 ? Effect.succeed(stdout) : Effect.fail(new DesktopFailure({ operation: "run input batch", client: client.name, cause: stderr }))),
  );
  yield* Effect.acquireUseRelease(Effect.void, () => Effect.forEach(plan, (command) => Effect.gen(function*() {
    const output = yield* runBatch(command.args);
    if (command.pointer !== undefined) {
      const fields = shellValues(output);
      const at = { x: Number(fields.X), y: Number(fields.Y) };
      if (at.x !== command.pointer.x || at.y !== command.pointer.y) return yield* new DesktopFailure({ operation: "move input batch pointer", client: client.name, cause: `pointer at ${at.x},${at.y}, wanted ${command.pointer.x},${command.pointer.y}` });
    }
  }), { discard: true }), (_, exit) => {
    if (Exit.isSuccess(exit)) return Effect.void;
    const keys = actions.flatMap((action) => action.kind === "keys" ? action.keys : []);
    if (!moved && keys.length === 0) return Effect.void;
    return runBatch([...(moved ? ["mouseup", "1"] : []), ...(keys.length > 0 ? ["keyup", ...keys] : [])]).pipe(Effect.asVoid);
  }).pipe(step(`${client.name}: input batch (${actions.length} actions)`));
});

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
      const found = findWindows(config, entry, x11, title);
      const windows = yield* (strict ? found : found.pipe(Effect.catchTag("DesktopFailure", () => Effect.succeed([] as string[]))));
      const { name, documents, menuReportPort } = entry;
      return windows.map((window): Client => ({ name, documents, ...(menuReportPort === undefined ? {} : { menuReportPort }), tools: config.tools, x11, wayland, window }));
    }),
    sessionEnvironment: (run) => {
      const read = (file: string) => (existsSync(join(run, file)) ? readFileSync(join(run, file), "utf8").trim() : "");
      return { DISPLAY: read("display"), WAYLAND_DISPLAY: read("wayland-display"), XAUTHORITY: read("xauthority"), XDG_RUNTIME_DIR: join(run, "runtime") };
    },
    placer: Effect.gen(function*() {
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
      const place: WindowPlacer = (env, title, region) => Effect.gen(function*() {
        let placed = 0;
        for (const window of (yield* output(xdotool, ["search", "--name", `^${escapeTitle(title)}$`], env)).split("\n").filter((id) => id !== "")) {
          const geometry = yield* output(xdotool, ["getwindowgeometry", window], env);
          if (geometry.includes(`Position: ${region.x},${region.y} `) && [0, 4].some((border) => geometry.includes(`Geometry: ${region.width + border}x${region.height + border}`))) continue;
          yield* output(xdotool, ["windowsize", window, String(region.width), String(region.height), "windowmove", window, String(region.x), String(region.y)], env);
          placed++;
        }
        return placed;
      });
      return Option.some(place);
    }),
    display: (entry) => desktopSession(entry).pipe(Effect.map(({ x11 }) => x11.DISPLAY)),
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
    keys: (client, names) => Effect.gen(function*() {
      if (sendsChat(names)) {
        for (const planned of inputBatches([{ kind: "keys", keys: names }], { x: 0, y: 0 })) {
          yield* runTool(client.name, `press ${names.join(" ")}`, [client.tools.xdotool, ...planned.args], client.x11);
        }
      } else yield* runTool(client.name, `press ${names.join(" ")}`, [client.tools.xdotool, "key", "--clearmodifiers", ...names], client.x11);
    }),
    pressKeys: (client, names, operation) => runTool(client.name, operation, [client.tools.xdotool, "key", "--clearmodifiers", ...names], client.x11).pipe(Effect.asVoid),
    typeText: (client, value, delayMillis) => {
      const delay = delayMillis === undefined ? [] : ["--delay", String(delayMillis)];
      return runTool(client.name, "type text", [client.tools.xdotool, "type", "--clearmodifiers", ...delay, "--", value], client.x11).pipe(Effect.asVoid);
    },
    typeSecret: (client, secret) => runTool(client.name, "type sign-in field", [client.tools.xdotool, "type", "--clearmodifiers", "--file", "-"], client.x11, secret).pipe(Effect.asVoid),
    pressAt,
    batch,
  })),
);
