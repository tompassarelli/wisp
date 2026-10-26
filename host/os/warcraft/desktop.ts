import { Effect } from "effect";
import { pollFor } from "../../cli/hostProcess";
import { type Frame, InputInjection, ScreenCapture, decodePpm } from "../platform/services";
import { ClientWatch, describeView, typesIntoMatch } from "../../dev/watch";
import { type Client, type ClientEntry, type ClientsConfig, DesktopFailure, type Region, readClientsFile, runTool } from "./desktopClient";
import { chatEntryBand, chatEntryOpen, sendCheckedChat } from "./chatEntry";
import { sendsChat, type InputAction } from "./inputBatch";
export { type Client, type ClientEntry, type ClientsConfig, DesktopFailure, type Region, ToplevelMissing, readClientsFile, runTool, toplevelMissing } from "./desktopClient";
export type { InputAction } from "./inputBatch";
export { sendsChat } from "./inputBatch";

export type Ink = "light" | "gold" | "white";

const text = (bytes: Uint8Array) => new TextDecoder().decode(bytes);

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

interface TimedFrame {
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

export const preflight = (client: Client) => InputInjection.use((input) => input.preflight(client));

export const focus = (client: Client) => InputInjection.use((input) => input.focus(client, "Warcraft III", true));

const requireMatch = (client: Client, input: string) =>
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

const focusWindow = (client: Client, title: string) => InputInjection.use((input) => input.focus(client, title, false));

export const pressAt = (client: Client, x: number, y: number) => InputInjection.use((input) => input.pressAt(client, x, y));

export const batch = Effect.fnUntraced(function*(client: Client, actions: readonly InputAction[]) {
  if (actions.length === 0) return;
  if (actions.some((action) => action.kind === "text" || (action.kind === "keys" && sendsChat(action.keys)))) yield* requireMatch(client, "typed text or Return");
  yield* focus(client);
  yield* InputInjection.use((input) => input.batch(client, actions));
});

export const chat = Effect.fnUntraced(function*(client: Client, line: string) {
  yield* requireMatch(client, "chat");
  yield* focus(client);
  const input = yield* InputInjection;
  const band = chatEntryBand(yield* input.windowRegion(client));
  yield* sendCheckedChat(client, {
    open: capture(client, band.region).pipe(Effect.map((frame) => chatEntryOpen(frame, band.minRun))),
    pressReturn: input.batch(client, [{ kind: "keys", keys: ["Return"] }]),
    sendLine: input.batch(client, [{ kind: "text", text: line }, { kind: "keys", keys: ["Return"] }]),
  });
});

export const waitFor = <A, E, R>(client: { readonly name: string }, what: string, seconds: number, observe: Effect.Effect<A | undefined, E, R>) =>
  pollFor(seconds, "50 millis", observe).pipe(Effect.filterOrFail(
    (value): value is A => value !== undefined,
    () => new DesktopFailure({ operation: `wait for ${what}`, client: client.name, cause: `not seen within ${seconds} s` }),
  ));

/** The text read, when it matches `pattern` with its whitespace runs collapsed to single spaces. */
export const textMatching = (pattern: RegExp) => (seen: string) => (pattern.test(seen.replace(/\s+/g, " ")) ? seen : undefined);

export const waitForText = (client: Client, what: string, pattern: RegExp, region?: Region, ink: Ink = "light", seconds = 20) =>
  waitFor(client, what, seconds, read(client, region, ink).pipe(Effect.map(textMatching(pattern))));

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
