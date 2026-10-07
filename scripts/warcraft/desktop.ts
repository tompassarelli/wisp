// Drives signed-in Warcraft clients on their private desktops. It captures raw
// frames, reads text from small regions, and sends keyboard and pointer input.
// Session-bound values (desktop run directories, tool paths) come from a
// supplied clients file.
import { join } from "node:path";
import { Clock, Effect, Exit, Schema } from "effect";
import { describeCause } from "../wisp/command";
import { type Frame, decodePpm } from "../wisp/frameProbe";
import { captureProcess } from "../wisp/mapBuild";
import { step } from "../wisp/timings";
import { ClientWatch, describeView, typesIntoMatch } from "../wisp/watch";
import { inputBatches, sendsChat, type InputAction } from "./inputBatch";
export type { InputAction } from "./inputBatch";
export { sendsChat } from "./inputBatch";

export class DesktopFailure extends Schema.TaggedError<DesktopFailure>()("DesktopFailure", {
  operation: Schema.String,
  client: Schema.String,
  cause: Schema.Unknown,
}) {
  override get message(): string {
    return `${this.operation} failed for ${this.client}: ${describeCause(this.cause)}`;
  }
}

const ClientsFile = Schema.Struct({
  tools: Schema.Struct({ grim: Schema.String, xdotool: Schema.String, wlrctl: Schema.String, tesseract: Schema.String }),
  clients: Schema.NonEmptyArray(Schema.Struct({ name: Schema.String, run: Schema.String, documents: Schema.String, menuReportPort: Schema.optional(Schema.Int), displaySettings: Schema.optional(Schema.Record(Schema.String, Schema.String)), offline: Schema.optionalKey(Schema.Boolean) })),
});
type Tools = typeof ClientsFile.Type["tools"];

export interface Client {
  readonly name: string;
  /** The client's Documents/Warcraft III folder. */
  readonly documents: string;
  /** This client's installed Wisp page's report port; distinct for every client. Absent uses ordinary menus. */
  readonly menuReportPort?: number;
  readonly tools: Tools;
  readonly x11: Record<string, string>;
  readonly wayland: Record<string, string>;
  readonly window: string;
}

/** A rectangle of the 2560x1440 client frame. */
export interface Region {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/**
 * How text is separated from the background before reading: light labels,
 * the gold menu labels, or white text on a coloured button.
 */
export type Ink = "light" | "gold" | "white";

function fail(operation: string, client: string) {
  return (cause: unknown) => new DesktopFailure({ operation, client, cause });
}

function run(client: string, operation: string, command: readonly string[], env: Record<string, string>, stdin?: Uint8Array) {
  const effect = Effect.tryPromise({
    try: async () => {
      const process = Bun.spawn([...command], { env: { ...Bun.env, ...env }, stdin: stdin ?? "ignore", stdout: "pipe", stderr: "pipe" });
      const [stdout, stderr, code] = await Promise.all([new Response(process.stdout).arrayBuffer(), new Response(process.stderr).text(), process.exited]);
      if (code !== 0) throw new Error(`${command[0]} exited ${code}: ${stderr.trim()}`);
      return new Uint8Array(stdout);
    },
    catch: fail(operation, client),
  });
  return process.env.WISP_DESKTOP_TIMINGS === "1" ? effect.pipe(step(`${client}: ${operation}`)) : effect;
}

const text = (bytes: Uint8Array) => new TextDecoder().decode(bytes);

export type ClientsConfig = typeof ClientsFile.Type;
export type ClientEntry = ClientsConfig["clients"][number];

/** The clients file, decoded: its tools and each client's desktop run folder, Documents folder and menu port. */
export const readClientsFile = (path: string) =>
  Effect.gen(function*() {
    const raw = yield* Effect.tryPromise({ try: () => Bun.file(path).json(), catch: fail("read clients file", path) });
    const config = yield* Schema.decodeUnknownEffect(ClientsFile)(raw).pipe(Effect.mapError(fail("decode clients file", path)));
    const ports = config.clients.flatMap((client) => client.menuReportPort === undefined ? [] : [client.menuReportPort]);
    if (ports.some((port) => port < 1 || port > 65535) || new Set(ports).size !== ports.length) {
      return yield* new DesktopFailure({ operation: "decode clients file", client: path, cause: "menuReportPort must be a distinct port from 1 to 65535 for each configured client" });
    }
    return config;
  });

/** A client's private desktop: its X display and its compositor, from its run folder. */
export const desktopSession = (entry: ClientEntry) =>
  Effect.gen(function*() {
    const read = (file: string) =>
      Effect.tryPromise({ try: async () => (await Bun.file(join(entry.run, file)).text()).trim(), catch: fail(`read desktop ${file}`, entry.name) });
    const x11 = { DISPLAY: yield* read("display"), XAUTHORITY: yield* read("xauthority") };
    const wayland = { XDG_RUNTIME_DIR: join(entry.run, "runtime"), WAYLAND_DISPLAY: yield* read("wayland-display") };
    return { x11, wayland };
  });

/** The ids of the client display's windows titled exactly `title`. */
export const findWindows = (tools: Tools, name: string, x11: Record<string, string>, title: string) =>
  run(name, `find ${title} window`, [tools.xdotool, "search", "--name", `^${title.replace(/[.\\^$|?*+()[\]{}]/g, "\\$&")}$`], x11).pipe(
    Effect.map((bytes) => text(bytes).split("\n").filter((line) => line !== "")),
    // xdotool search exits 1 when nothing matches.
    Effect.catchTag("DesktopFailure", () => Effect.succeed([] as string[])),
  );

export const loadClients = (path: string) =>
  Effect.gen(function*() {
    const config = yield* readClientsFile(path);
    return yield* Effect.forEach(config.clients, (entry) =>
      Effect.gen(function*() {
        const { name, documents, menuReportPort } = entry;
        const { x11, wayland } = yield* desktopSession(entry);
        const windows = text(yield* run(name, "find Warcraft window", [config.tools.xdotool, "search", "--name", "^Warcraft III$"], x11)).split("\n").filter((line) => line !== "");
        if (windows.length !== 1) return yield* new DesktopFailure({ operation: "find Warcraft window", client: name, cause: `${windows.length} windows` });
        return { name, documents, ...(menuReportPort === undefined ? {} : { menuReportPort }), tools: config.tools, x11, wayland, window: windows[0]! } satisfies Client;
      }));
  });

/** A raw frame from the compositor, about 50 ms for the full screen. */
export const capture = (client: Client, region?: Region) =>
  Effect.gen(function*() {
    const geometry = region === undefined ? [] : ["-g", `${region.x},${region.y} ${region.width}x${region.height}`];
    const ppm = yield* run(client.name, "capture frame", [client.tools.grim, "-t", "ppm", ...geometry, "-"], client.wayland);
    const frame = decodePpm(ppm);
    if (frame === undefined) return yield* new DesktopFailure({ operation: "capture frame", client: client.name, cause: "not a PPM frame" });
    return frame;
  });

/** Dark text on white as a PGM image, which is what the reader expects. */
export function separateInk(frame: Frame, ink: Ink): Uint8Array {
  const header = new TextEncoder().encode(`P5\n${frame.width} ${frame.height}\n255\n`);
  const pixels = frame.width * frame.height;
  const out = new Uint8Array(header.length + pixels);
  out.set(header);
  for (let i = 0; i < pixels; i++) {
    const r = frame.rgb[i * 3]!;
    const g = frame.rgb[i * 3 + 1]!;
    const b = frame.rgb[i * 3 + 2]!;
    out[header.length + i] = ink === "gold" ? (r > 170 && g > 150 ? 0 : 255)
      : ink === "white" ? (r > 200 && g > 200 && b > 200 ? 0 : 255)
      : 255 - ((r * 3 + g * 6 + b) / 10 | 0);
  }
  return out;
}

/** Text in a region (or the whole frame), one line per text line. */
export const read = (client: Client, region?: Region, ink: Ink = "light") =>
  Effect.gen(function*() {
    const frame = yield* capture(client, region);
    const page = yield* run(client.name, "read text", [client.tools.tesseract, "stdin", "stdout", "--psm", region === undefined ? "11" : "6"], {}, separateInk(frame, ink));
    return text(page);
  });

export interface Word {
  readonly text: string;
  readonly x: number;
  readonly y: number;
  /** The reader's block, paragraph and line: equal for the words of one line. */
  readonly line?: string;
}

/** The words of Tesseract's TSV output with their centres; low-confidence words are left out. */
export function parseWords(tsv: string): Word[] {
  return tsv.split("\n").slice(1).flatMap((line): Word[] => {
    const field = line.split("\t");
    const word = field[11]?.trim() ?? "";
    if (word === "" || Number(field[10]) < 40) return [];
    return [{ text: word, x: Number(field[6]) + Math.round(Number(field[8]) / 2), y: Number(field[7]) + Math.round(Number(field[9]) / 2), line: `${field[2]}.${field[3]}.${field[4]}` }];
  });
}

/** Every word in the frame with its centre, for finding where controls are. */
export const words = (client: Client, ink: Ink = "light") =>
  Effect.gen(function*() {
    return yield* frameWords(client, yield* capture(client), ink);
  });

/** Every word of one captured frame, read with one ink. */
export const frameWords = (client: Client, frame: Frame, ink: Ink) =>
  run(client.name, "read words", [client.tools.tesseract, "stdin", "stdout", "--psm", "11", "tsv"], {}, separateInk(frame, ink)).pipe(Effect.map((bytes) => parseWords(text(bytes))));

/** Gives the Warcraft window compositor and X11 focus. */
export const focus = (client: Client) =>
  Effect.gen(function*() {
    yield* run(client.name, "focus Warcraft", [client.tools.wlrctl, "toplevel", "focus", "title:Warcraft III"], client.wayland);
    yield* run(client.name, "activate Warcraft window", [client.tools.xdotool, "windowactivate", "--sync", client.window], client.x11);
  });

/**
 * Refuses typed text and Return unless the client is in a match with its menu
 * page connected (wisp:scripts/wisp/watch.ts `typesIntoMatch`): in the menus
 * they reach Battle.net's public channel, in a lobby its chat. Uses the
 * ClientWatch provided, else watches the client once.
 */
export const requireMatch = (client: Client, input: string) =>
  Effect.gen(function*() {
    const provided = yield* Effect.serviceOption(ClientWatch);
    const view = yield* (provided._tag === "Some"
      ? provided.value.view(client)
      : ClientWatch.use((watch) => watch.view(client)).pipe(Effect.provide(ClientWatch.layer())));
    if (!typesIntoMatch(view)) {
      return yield* new DesktopFailure({
        operation: `send ${input}`,
        client: client.name,
        cause: `refused outside a match its menu page reports, where it would reach Battle.net's channel or a lobby's chat; now ${describeView(view)}${view.menus === true ? "" : " (no menu page connected)"}`,
      });
    }
  }).pipe(Effect.catchTag("WatchFailure", (cause) => Effect.fail(new DesktopFailure({ operation: `send ${input}`, client: client.name, cause }))));

/** Keys in order, for example `keys(a, "F10")` or `keys(a, "ctrl+a")`. Return needs a match (requireMatch). */
export const keys = (client: Client, ...names: string[]) =>
  Effect.gen(function*() {
    if (sendsChat(names)) yield* requireMatch(client, names.join(" "));
    yield* focus(client);
    if (sendsChat(names)) {
      for (const planned of inputBatches([{ kind: "keys", keys: names }], { x: 0, y: 0 })) {
        yield* run(client.name, `press ${names.join(" ")}`, [client.tools.xdotool, ...planned.args], client.x11);
      }
    } else yield* run(client.name, `press ${names.join(" ")}`, [client.tools.xdotool, "key", "--clearmodifiers", ...names], client.x11);
  });

/** Types `value`, which may start with "-", into a match (requireMatch); `delayMillis` spaces the keys for text fields that drop fast input. */
export const typeText = (client: Client, value: string, delayMillis?: number) =>
  Effect.gen(function*() {
    yield* requireMatch(client, "typed text");
    yield* focus(client);
    const delay = delayMillis === undefined ? [] : ["--delay", String(delayMillis)];
    yield* run(client.name, "type text", [client.tools.xdotool, "type", "--clearmodifiers", ...delay, "--", value], client.x11);
  });

/** The Warcraft process that owns the client's window (its _NET_WM_PID). */
export const windowPid = (client: Client) =>
  Effect.gen(function*() {
    const pid = Number(text(yield* run(client.name, "read window process", [client.tools.xdotool, "getwindowpid", client.window], client.x11)).trim());
    if (!Number.isInteger(pid) || pid <= 0) return yield* new DesktopFailure({ operation: "read window process", client: client.name, cause: `no process for window ${client.window}` });
    return pid;
  });

function pointerPosition(output: string) {
  const fields = Object.fromEntries(output.split("\n").filter((line) => line.includes("=")).map((line) => line.split("=", 2) as [string, string]));
  return { x: Number(fields.X), y: Number(fields.Y) };
}

function pointer(client: Client) {
  return run(client.name, "read pointer", [client.tools.xdotool, "getmouselocation", "--shell"], client.x11).pipe(
    Effect.map((bytes) => pointerPosition(text(bytes))),
  );
}

/**
 * Clicks at a frame position. Warcraft follows relative motion under
 * Xwayland, not absolute moves, and consumes it after XTEST reports the new
 * position; there is no signal for that, so a short settle precedes the press.
 */
export const click = (client: Client, x: number, y: number) =>
  Effect.gen(function*() {
    yield* focus(client);
    yield* pressAt(client, x, y);
  });

/** Gives a window of the client's display X11 focus, and compositor focus when its toplevel has this title. */
export const focusWindow = (client: Client, title: string) =>
  Effect.gen(function*() {
    yield* run(client.name, `focus ${title}`, [client.tools.wlrctl, "toplevel", "focus", `title:${title}`], client.wayland).pipe(Effect.ignore);
    yield* run(client.name, `activate ${title} window`, [client.tools.xdotool, "windowactivate", "--sync", client.window], client.x11);
  });

/** Clicks at a frame position in whatever window has focus, as click does once Warcraft has it. */
export const pressAt = (client: Client, x: number, y: number) =>
  Effect.gen(function*() {
    const from = yield* pointer(client);
    yield* run(client.name, "move pointer", [client.tools.xdotool, "mousemove_relative", "--", String(x - from.x), String(y - from.y)], client.x11);
    const at = yield* pointer(client);
    if (at.x !== x || at.y !== y) return yield* new DesktopFailure({ operation: "move pointer", client: client.name, cause: `pointer at ${at.x},${at.y}, wanted ${x},${y}` });
    yield* Effect.sleep("120 millis");
    yield* run(client.name, "press button", [client.tools.xdotool, "mousedown", "1"], client.x11);
    yield* Effect.sleep("60 millis");
    yield* run(client.name, "release button", [client.tools.xdotool, "mouseup", "1"], client.x11);
  });

/** Focuses once and batches recorded inputs, verifying relative pointer motion before each click. Text and Return need a match (requireMatch). */
export const batch = Effect.fnUntraced(function*(client: Client, actions: readonly InputAction[]) {
  if (actions.length === 0) return;
  if (actions.some((action) => action.kind === "text" || (action.kind === "keys" && sendsChat(action.keys)))) yield* requireMatch(client, "typed text or Return");
  yield* focus(client);
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
      const at = pointerPosition(output);
      if (at.x !== command.pointer.x || at.y !== command.pointer.y) return yield* new DesktopFailure({ operation: "move input batch pointer", client: client.name, cause: `pointer at ${at.x},${at.y}, wanted ${command.pointer.x},${command.pointer.y}` });
    }
  }), { discard: true }), (_, exit) => {
    if (Exit.isSuccess(exit)) return Effect.void;
    const keys = actions.flatMap((action) => action.kind === "keys" ? action.keys : []);
    if (!moved && keys.length === 0) return Effect.void;
    return runBatch([...(moved ? ["mouseup", "1"] : []), ...(keys.length > 0 ? ["keyup", ...keys] : [])]).pipe(Effect.asVoid);
  }).pipe(step(`${client.name}: input batch (${actions.length} actions)`));
});

/** Polls until `observe` returns a value, or fails with the last observation after `seconds` of the Effect Clock. */
export const waitFor = <A, E, R>(client: { readonly name: string }, what: string, seconds: number, observe: Effect.Effect<A | undefined, E, R>) =>
  Effect.gen(function*() {
    const deadline = (yield* Clock.currentTimeMillis) + seconds * 1000;
    while (true) {
      const value = yield* observe;
      if (value !== undefined) return value;
      if ((yield* Clock.currentTimeMillis) > deadline) return yield* new DesktopFailure({ operation: `wait for ${what}`, client: client.name, cause: `not seen within ${seconds} s` });
      yield* Effect.sleep("50 millis");
    }
  });

/** Waits until a region shows text matching `pattern`. */
export const waitForText = (client: Client, what: string, pattern: RegExp, region?: Region, ink: Ink = "light", seconds = 20) =>
  waitFor(client, what, seconds, read(client, region, ink).pipe(Effect.map((seen) => (pattern.test(seen.replace(/\s+/g, " ")) ? seen : undefined))));

/** The X window with input focus on the client's display. */
const activeWindow = (client: Client) =>
  run(client.name, "read active window", [client.tools.xdotool, "getactivewindow"], client.x11).pipe(Effect.map((bytes) => text(bytes).trim()));

/** A window's frame rectangle on the client's display. */
const windowRegion = (client: Client) =>
  run(client.name, "read window geometry", [client.tools.xdotool, "getwindowgeometry", "--shell", client.window], client.x11).pipe(Effect.map((bytes): Region => {
    const fields = Object.fromEntries(text(bytes).split("\n").filter((line) => line.includes("=")).map((line) => line.split("=", 2) as [string, string]));
    return { x: Number(fields.X), y: Number(fields.Y), width: Number(fields.WIDTH), height: Number(fields.HEIGHT) };
  }));

/**
 * Replaces a field of the Battle.net sign-in window `client.window` (titled
 * `title`) with `secret` and submits it with Return. The field is clicked
 * where its empty placeholder (`placeholder`, read from the window) is: the
 * password page of 7 Oct loaded with no field focused. The value reaches
 * xdotool on its stdin, never its arguments, and is zeroed after; nothing
 * types unless that window has focus before and after.
 */
export const enterLoginField = (client: Client, title: string, placeholder: RegExp, secret: Uint8Array) =>
  Effect.gen(function*() {
    yield* focusWindow(client, title);
    const focused = yield* activeWindow(client);
    if (focused !== client.window) return yield* new DesktopFailure({ operation: "focus sign-in", client: client.name, cause: `window ${focused} has focus, not the "${title}" window ${client.window}` });
    const region = yield* windowRegion(client);
    const field = (yield* frameWords(client, yield* capture(client, region), "light")).find((word) => placeholder.test(word.text));
    if (field !== undefined) yield* pressAt(client, region.x + field.x, region.y + field.y);
    yield* run(client.name, "select sign-in field", [client.tools.xdotool, "key", "--clearmodifiers", "ctrl+a"], client.x11);
    yield* run(client.name, "type sign-in field", [client.tools.xdotool, "type", "--clearmodifiers", "--file", "-"], client.x11, secret);
    const after = yield* activeWindow(client);
    if (after !== client.window) return yield* new DesktopFailure({ operation: "type sign-in field", client: client.name, cause: `focus moved to window ${after} while typing; not submitting` });
    yield* run(client.name, "submit sign-in field", [client.tools.xdotool, "key", "--clearmodifiers", "Return"], client.x11);
  }).pipe(Effect.ensuring(Effect.sync(() => secret.fill(0))));
