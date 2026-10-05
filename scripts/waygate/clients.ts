// Clients: the signed-in Warcraft clients on their private desktops. The live
// driver captures raw frames, reads text from small regions, and sends
// keyboard and pointer input. Session-bound values (desktop run directories,
// tool paths) come from the supplied clients file.
import { join } from "node:path";
import { Clock, Context, Effect, Layer, Schema } from "effect";
import { describeCause } from "./command";

export class DesktopFailure extends Schema.TaggedError<DesktopFailure>()("DesktopFailure", {
  operation: Schema.String,
  client: Schema.String,
  cause: Schema.Unknown,
}) {
  override get message(): string {
    return `${this.operation} failed for ${this.client}: ${describeCause(this.cause)}`;
  }
}

export interface Client {
  readonly name: string;
  /** The client's Documents/Warcraft III folder. */
  readonly documents: string;
}

/** A rectangle of the 2560x1440 client frame. */
export interface Region {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** How text is separated from the background before reading: white labels or the gold menu labels. */
export type Ink = "light" | "gold";

export interface Word {
  readonly text: string;
  readonly x: number;
  readonly y: number;
}

export class Clients extends Context.Service<Clients, {
  /** Every client, the host first. */
  readonly all: readonly [Client, ...Client[]];
  /** Text in a region (or the whole frame), one line per text line. */
  readonly read: (client: Client, region?: Region, ink?: Ink) => Effect.Effect<string, DesktopFailure>;
  /** Every word in the frame with its centre, for finding where controls are. */
  readonly words: (client: Client, ink?: Ink) => Effect.Effect<readonly Word[], DesktopFailure>;
  /** Clicks at a frame position. */
  readonly click: (client: Client, x: number, y: number) => Effect.Effect<void, DesktopFailure>;
  /** Keys in order, for example `keys(a, "F10")` or `keys(a, "ctrl+a")`. */
  readonly keys: (client: Client, ...names: string[]) => Effect.Effect<void, DesktopFailure>;
  readonly typeText: (client: Client, value: string) => Effect.Effect<void, DesktopFailure>;
}>()("waygate/Clients") {
  static readonly layer = (path: string) => Layer.effect(Clients, connect(path));
}

/** Polls until `observe` returns a value, or fails after `seconds` of the Effect Clock. */
export const waitFor = <A, E, R>(client: Client, what: string, seconds: number, observe: Effect.Effect<A | undefined, E, R>) =>
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
  Effect.gen(function*() {
    const clients = yield* Clients;
    return yield* waitFor(client, what, seconds, clients.read(client, region, ink).pipe(
      Effect.map((seen) => (pattern.test(seen.replace(/\s+/g, " ")) ? seen : undefined)),
    ));
  });

// ---------------------------------------------------------------- live driver

const ClientsFile = Schema.Struct({
  tools: Schema.Struct({ grim: Schema.String, xdotool: Schema.String, wlrctl: Schema.String, tesseract: Schema.String }),
  clients: Schema.NonEmptyArray(Schema.Struct({ name: Schema.String, run: Schema.String, documents: Schema.String })),
});
type Tools = typeof ClientsFile.Type["tools"];

/** A client's desktop session. */
interface Desktop extends Client {
  readonly tools: Tools;
  readonly x11: Record<string, string>;
  readonly wayland: Record<string, string>;
  readonly window: string;
}

interface Frame {
  readonly width: number;
  readonly height: number;
  readonly rgb: Uint8Array;
}

function fail(operation: string, client: string) {
  return (cause: unknown) => new DesktopFailure({ operation, client, cause });
}

function run(client: string, operation: string, command: readonly string[], env: Record<string, string>, stdin?: Uint8Array) {
  return Effect.tryPromise({
    try: async () => {
      const process = Bun.spawn([...command], { env: { ...Bun.env, ...env }, stdin: stdin ?? "ignore", stdout: "pipe", stderr: "pipe" });
      const [stdout, stderr, code] = await Promise.all([new Response(process.stdout).arrayBuffer(), new Response(process.stderr).text(), process.exited]);
      if (code !== 0) throw new Error(`${command[0]} exited ${code}: ${stderr.trim()}`);
      return new Uint8Array(stdout);
    },
    catch: fail(operation, client),
  });
}

const text = (bytes: Uint8Array) => new TextDecoder().decode(bytes);

/** Reads the clients file and finds each client's Warcraft window. */
const connect = (path: string) => Effect.gen(function*() {
  const raw = yield* Effect.tryPromise({ try: () => Bun.file(path).json(), catch: fail("read clients file", path) });
  const config = yield* Schema.decodeUnknownEffect(ClientsFile)(raw).pipe(Effect.mapError(fail("decode clients file", path)));
  const [first, ...others] = yield* Effect.forEach(config.clients, ({ name, run: dir, documents }) =>
    Effect.gen(function*() {
      const read = (file: string) =>
        Effect.tryPromise({ try: async () => (await Bun.file(join(dir, file)).text()).trim(), catch: fail(`read desktop ${file}`, name) });
      const x11 = { DISPLAY: yield* read("display"), XAUTHORITY: yield* read("xauthority") };
      const wayland = { XDG_RUNTIME_DIR: join(dir, "runtime"), WAYLAND_DISPLAY: yield* read("wayland-display") };
      const windows = text(yield* run(name, "find Warcraft window", [config.tools.xdotool, "search", "--name", "^Warcraft III$"], x11)).split("\n").filter((line) => line !== "");
      if (windows.length !== 1) return yield* new DesktopFailure({ operation: "find Warcraft window", client: name, cause: `${windows.length} windows` });
      return { name, documents, tools: config.tools, x11, wayland, window: windows[0] ?? "" } satisfies Desktop;
    }));
  if (first === undefined) return yield* new DesktopFailure({ operation: "decode clients file", client: path, cause: "no clients" });
  const desktops = new Map([first, ...others].map((desktop) => [desktop.name, desktop]));
  const desktop = (client: Client) => {
    const found = desktops.get(client.name);
    return found === undefined ? Effect.fail(new DesktopFailure({ operation: "find client", client: client.name, cause: "not in the clients file" })) : Effect.succeed(found);
  };
  return Clients.of({
    all: [first, ...others],
    read: (client, region, ink = "light") => Effect.flatMap(desktop(client), (d) => read(d, region, ink)),
    words: (client, ink = "light") => Effect.flatMap(desktop(client), (d) => words(d, ink)),
    click: (client, x, y) => Effect.flatMap(desktop(client), (d) => click(d, x, y)),
    keys: (client, ...names) => Effect.flatMap(desktop(client), (d) => keys(d, ...names)),
    typeText: (client, value) => Effect.flatMap(desktop(client), (d) => typeText(d, value)),
  });
});

/** A raw frame from the compositor, about 50 ms for the full screen. */
const capture = (client: Desktop, region?: Region) =>
  Effect.gen(function*() {
    const geometry = region === undefined ? [] : ["-g", `${region.x},${region.y} ${region.width}x${region.height}`];
    const ppm = yield* run(client.name, "capture frame", [client.tools.grim, "-t", "ppm", ...geometry, "-"], client.wayland);
    // P6 header: magic, width, height, maximum value, each followed by one whitespace byte.
    const header = /^P6\s+(\d+)\s+(\d+)\s+255\s/.exec(text(ppm.subarray(0, 32)));
    if (header === null) return yield* new DesktopFailure({ operation: "capture frame", client: client.name, cause: "not a PPM frame" });
    return { width: Number(header[1]), height: Number(header[2]), rgb: ppm.subarray(header[0].length) } satisfies Frame;
  });

/** Dark text on white, which is what the reader expects. */
function separateInk(frame: Frame, ink: Ink): Uint8Array {
  const header = new TextEncoder().encode(`P5\n${frame.width} ${frame.height}\n255\n`);
  const pixels = frame.width * frame.height;
  const out = new Uint8Array(header.length + pixels);
  out.set(header);
  for (let i = 0; i < pixels; i++) {
    const r = frame.rgb[i * 3] ?? 0;
    const g = frame.rgb[i * 3 + 1] ?? 0;
    const b = frame.rgb[i * 3 + 2] ?? 0;
    out[header.length + i] = ink === "gold" ? (r > 170 && g > 150 ? 0 : 255) : 255 - ((r * 3 + g * 6 + b) / 10 | 0);
  }
  return out;
}

const read = (client: Desktop, region: Region | undefined, ink: Ink) =>
  Effect.gen(function*() {
    const frame = yield* capture(client, region);
    const page = yield* run(client.name, "read text", [client.tools.tesseract, "stdin", "stdout", "--psm", region === undefined ? "11" : "6"], {}, separateInk(frame, ink));
    return text(page);
  });

const words = (client: Desktop, ink: Ink) =>
  Effect.gen(function*() {
    const frame = yield* capture(client);
    const tsv = text(yield* run(client.name, "read words", [client.tools.tesseract, "stdin", "stdout", "--psm", "11", "tsv"], {}, separateInk(frame, ink)));
    return tsv.split("\n").slice(1).flatMap((line): Word[] => {
      const field = line.split("\t");
      const word = field[11]?.trim() ?? "";
      if (word === "" || Number(field[10]) < 40) return [];
      return [{ text: word, x: Number(field[6]) + Math.round(Number(field[8]) / 2), y: Number(field[7]) + Math.round(Number(field[9]) / 2) }];
    });
  });

const focus = (client: Desktop) =>
  Effect.gen(function*() {
    yield* run(client.name, "focus Warcraft", [client.tools.wlrctl, "toplevel", "focus", "title:Warcraft III"], client.wayland);
    yield* run(client.name, "activate Warcraft window", [client.tools.xdotool, "windowactivate", "--sync", client.window], client.x11);
  });

const keys = (client: Desktop, ...names: string[]) =>
  Effect.gen(function*() {
    yield* focus(client);
    yield* run(client.name, `press ${names.join(" ")}`, [client.tools.xdotool, "key", "--clearmodifiers", ...names], client.x11);
  });

const typeText = (client: Desktop, value: string) =>
  Effect.gen(function*() {
    yield* focus(client);
    yield* run(client.name, "type text", [client.tools.xdotool, "type", "--clearmodifiers", "--", value], client.x11);
  });

function pointer(client: Desktop) {
  return run(client.name, "read pointer", [client.tools.xdotool, "getmouselocation", "--shell"], client.x11).pipe(
    Effect.map((bytes) => {
      const fields = new Map(text(bytes).split("\n").filter((line) => line.includes("=")).map((line) => {
        const [name = "", value = ""] = line.split("=", 2);
        return [name, value] as const;
      }));
      return { x: Number(fields.get("X")), y: Number(fields.get("Y")) };
    }),
  );
}

/**
 * Warcraft follows relative motion under Xwayland, not absolute moves, and
 * consumes it after XTEST reports the new position; there is no signal for
 * that, so a short settle precedes the press.
 */
const click = (client: Desktop, x: number, y: number) =>
  Effect.gen(function*() {
    yield* focus(client);
    const from = yield* pointer(client);
    yield* run(client.name, "move pointer", [client.tools.xdotool, "mousemove_relative", "--", String(x - from.x), String(y - from.y)], client.x11);
    const at = yield* pointer(client);
    if (at.x !== x || at.y !== y) return yield* new DesktopFailure({ operation: "move pointer", client: client.name, cause: `pointer at ${at.x},${at.y}, wanted ${x},${y}` });
    yield* Effect.sleep("120 millis");
    yield* run(client.name, "press button", [client.tools.xdotool, "mousedown", "1"], client.x11);
    yield* Effect.sleep("60 millis");
    yield* run(client.name, "release button", [client.tools.xdotool, "mouseup", "1"], client.x11);
  });
