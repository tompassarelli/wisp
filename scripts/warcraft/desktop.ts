import { Clock, Effect, Schema } from "effect";
import { describeCause } from "../wisp/command";
import { type Frame, decodePpm } from "../wisp/frameProbe";
import { InputInjection, ScreenCapture } from "../platform/services";
import { step } from "../wisp/timings";
import { ClientWatch, describeView, typesIntoMatch } from "../wisp/watch";
import { CLIENT_PROFILE_NAMES } from "../wisp/lan/pool";
import { sendsChat, type InputAction } from "./inputBatch";
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
  clients: Schema.NonEmptyArray(Schema.Struct({ name: Schema.String, run: Schema.String, documents: Schema.String, menuReportPort: Schema.optional(Schema.Int), displaySettings: Schema.optional(Schema.Record(Schema.String, Schema.String)), profile: Schema.optional(Schema.Literals(CLIENT_PROFILE_NAMES)), offline: Schema.optionalKey(Schema.Boolean) })),
});
type Tools = typeof ClientsFile.Type["tools"];

export interface Client {
  readonly name: string;

  readonly documents: string;

  readonly menuReportPort?: number;
  readonly tools: Tools;
  readonly x11: Record<string, string>;
  readonly wayland: Record<string, string>;
  readonly window: string;
}

export interface Region {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export type Ink = "light" | "gold" | "white";

function fail(operation: string, client: string) {
  return (cause: unknown) => new DesktopFailure({ operation, client, cause });
}

export function runTool(client: string, operation: string, command: readonly string[], env: Record<string, string>, stdin?: Uint8Array) {
  const effect = Effect.acquireUseRelease(
    Effect.try({
      try: () => Bun.spawn([...command], { env: { ...Bun.env, ...env }, stdin: stdin ?? "ignore", stdout: "pipe", stderr: "pipe" }),
      catch: fail(operation, client),
    }),
    (child) => Effect.tryPromise({
      try: async () => {
        const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).arrayBuffer(), new Response(child.stderr).text(), child.exited]);
        if (code !== 0) throw new Error(`${command[0]} exited ${code}: ${stderr.trim()}`);
        return new Uint8Array(stdout);
      },
      catch: fail(operation, client),
    }),
    (child) => Effect.promise(async () => {
      if (child.exitCode === null) child.kill("SIGKILL");
      await child.exited;
    }),
  );
  return process.env.WISP_DESKTOP_TIMINGS === "1" ? effect.pipe(step(`${client}: ${operation}`)) : effect;
}

const text = (bytes: Uint8Array) => new TextDecoder().decode(bytes);

export type ClientsConfig = typeof ClientsFile.Type;
export type ClientEntry = ClientsConfig["clients"][number];

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

export const windowsOf = (config: ClientsConfig, entry: ClientEntry, title: string) => InputInjection.use((input) => input.windows(config, entry, title, false));

export const displayOf = (entry: ClientEntry) => InputInjection.use((input) => input.display(entry));

export const loadClients = (path: string) =>
  Effect.gen(function*() {
    const config = yield* readClientsFile(path);
    const input = yield* InputInjection;
    return yield* Effect.forEach(config.clients, (entry) =>
      Effect.gen(function*() {
        const windows = yield* input.windows(config, entry, "Warcraft III", true);
        if (windows.length !== 1) return yield* new DesktopFailure({ operation: "find Warcraft window", client: entry.name, cause: `${windows.length} windows` });
        return windows[0]!;
      }));
  });

export interface TimedFrame {
  readonly frame: Frame;
  readonly beforeNs: number;
  readonly afterNs: number;
}

export const captureTimed = (client: Client, nowNs: () => number, region?: Region) =>
  Effect.gen(function*() {
    const screen = yield* ScreenCapture;
    const beforeNs = nowNs();
    const ppm = yield* screen.frame(client, region).pipe(
      Effect.timeoutOrElse({ duration: "8 seconds", orElse: () => Effect.fail(new DesktopFailure({ operation: "capture frame", client: client.name, cause: "framebuffer read exceeded 8 seconds; capture process stopped" })) }),
    );
    const afterNs = nowNs();
    const frame = decodePpm(ppm);
    if (frame === undefined) return yield* new DesktopFailure({ operation: "capture frame", client: client.name, cause: "not a PPM frame" });
    return { frame, beforeNs, afterNs } satisfies TimedFrame;
  });

export const capture = (client: Client, region?: Region) =>
  captureTimed(client, () => performance.now() * 1_000_000, region).pipe(Effect.map(({ frame }) => frame));

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

export const read = (client: Client, region?: Region, ink: Ink = "light") =>
  Effect.gen(function*() {
    const frame = yield* capture(client, region);
    const page = yield* runTool(client.name, "read text", [client.tools.tesseract, "stdin", "stdout", "--psm", region === undefined ? "11" : "6"], {}, separateInk(frame, ink));
    return text(page);
  });

export interface Word {
  readonly text: string;
  readonly x: number;
  readonly y: number;

  readonly line?: string;
}

export function parseWords(tsv: string): Word[] {
  return tsv.split("\n").slice(1).flatMap((line): Word[] => {
    const field = line.split("\t");
    const word = field[11]?.trim() ?? "";
    if (word === "" || Number(field[10]) < 40) return [];
    return [{ text: word, x: Number(field[6]) + Math.round(Number(field[8]) / 2), y: Number(field[7]) + Math.round(Number(field[9]) / 2), line: `${field[2]}.${field[3]}.${field[4]}` }];
  });
}

export const words = (client: Client, ink: Ink = "light") =>
  Effect.gen(function*() {
    return yield* frameWords(client, yield* capture(client), ink);
  });

export const frameWords = (client: Client, frame: Frame, ink: Ink) =>
  runTool(client.name, "read words", [client.tools.tesseract, "stdin", "stdout", "--psm", "11", "tsv"], {}, separateInk(frame, ink)).pipe(Effect.map((bytes) => parseWords(text(bytes))));

export const focus = (client: Client) => InputInjection.use((input) => input.focus(client, "Warcraft III", true));

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

export const keys = (client: Client, ...names: string[]) =>
  Effect.gen(function*() {
    if (sendsChat(names)) yield* requireMatch(client, names.join(" "));
    yield* focus(client);
    yield* InputInjection.use((input) => input.keys(client, names));
  });

export const typeText = (client: Client, value: string, delayMillis?: number) =>
  Effect.gen(function*() {
    yield* requireMatch(client, "typed text");
    yield* focus(client);
    yield* InputInjection.use((input) => input.typeText(client, value, delayMillis));
  });

export const windowPid = (client: Client) => InputInjection.use((input) => input.windowPid(client));

export const click = (client: Client, x: number, y: number) =>
  Effect.gen(function*() {
    yield* focus(client);
    yield* pressAt(client, x, y);
  });

export const focusWindow = (client: Client, title: string) => InputInjection.use((input) => input.focus(client, title, false));

export const pressAt = (client: Client, x: number, y: number) => InputInjection.use((input) => input.pressAt(client, x, y));

export const batch = Effect.fnUntraced(function*(client: Client, actions: readonly InputAction[]) {
  if (actions.length === 0) return;
  if (actions.some((action) => action.kind === "text" || (action.kind === "keys" && sendsChat(action.keys)))) yield* requireMatch(client, "typed text or Return");
  yield* focus(client);
  yield* InputInjection.use((input) => input.batch(client, actions));
});

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

export const waitForText = (client: Client, what: string, pattern: RegExp, region?: Region, ink: Ink = "light", seconds = 20) =>
  waitFor(client, what, seconds, read(client, region, ink).pipe(Effect.map((seen) => (pattern.test(seen.replace(/\s+/g, " ")) ? seen : undefined))));

export const enterLoginField = (client: Client, title: string, placeholder: RegExp | undefined, secret: Uint8Array) =>
  Effect.gen(function*() {
    const input = yield* InputInjection;
    yield* focusWindow(client, title);
    const focused = yield* input.activeWindow(client);
    if (focused !== client.window) return yield* new DesktopFailure({ operation: "focus sign-in", client: client.name, cause: `window ${focused} has focus, not the "${title}" window ${client.window}` });
    if (placeholder !== undefined) {
      const region = yield* input.windowRegion(client);
      const field = (yield* frameWords(client, yield* capture(client, region), "light")).find((word) => placeholder.test(word.text));
      if (field !== undefined) yield* pressAt(client, region.x + field.x, region.y + field.y);
      yield* input.pressKeys(client, ["ctrl+a"], "select sign-in field");
    }
    yield* input.typeSecret(client, secret);
    const after = yield* input.activeWindow(client);
    if (after !== client.window) return yield* new DesktopFailure({ operation: "type sign-in field", client: client.name, cause: `focus moved to window ${after} while typing; not submitting` });
    yield* input.pressKeys(client, ["Return"], "submit sign-in field");
  }).pipe(Effect.ensuring(Effect.sync(() => secret.fill(0))));
