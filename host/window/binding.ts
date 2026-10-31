import { existsSync } from "node:fs";
import { join } from "node:path";
import { type Pointer, dlopen } from "bun:ffi";
import { Effect } from "effect";
import type { PointerReading } from "../../src/headless/pointer";
import { type KeyTransition, unpackKey } from "../../src/headless/keyInput";
import { buildWindowLibrary, cachedWindowLibrary } from "./library";

const root = join(import.meta.dir, "../..");
const windowDirectory = join(root, "window");
const libraryFile = process.platform === "win32" ? "wisp_window.dll" : "libwisp_window.so";

/** `WISP_WINDOW_LIBRARY`, else the library beside the player executable, else the release build in this checkout, else the build of this package's `window/` source in the user cache (`prepareWindowLibrary` makes it). */
export function windowLibraryPath(): string {
  const beside = join(process.execPath, "..", libraryFile);
  const checkout = join(root, "window/target/release", libraryFile);
  return process.env.WISP_WINDOW_LIBRARY ?? (existsSync(beside) ? beside : existsSync(checkout) ? checkout : cachedWindowLibrary(windowDirectory, libraryFile));
}

/** `windowLibraryPath()`, built first from this package's `window/` source when it is not there and `WISP_WINDOW_LIBRARY` is unset. */
export const prepareWindowLibrary = Effect.suspend(() => process.env.WISP_WINDOW_LIBRARY === undefined ? buildWindowLibrary(windowLibraryPath(), windowDirectory) : Effect.succeed(windowLibraryPath()));

const symbols = {
  wisp_window_now_ns: { args: [], returns: "f64" },
  wisp_window_open: { args: ["ptr", "usize", "u32", "u32"], returns: "ptr" },
  wisp_window_open_error: { args: ["ptr", "usize"], returns: "usize" },
  wisp_window_start: { args: ["ptr"], returns: "void" },
  wisp_window_status: { args: ["ptr", "ptr", "usize"], returns: "void" },
  wisp_window_start_baseline: { args: ["ptr"], returns: "void" },
  wisp_window_assets_pending: { args: ["ptr"], returns: "u64" },
  wisp_window_asset: { args: ["ptr", "ptr", "usize", "ptr", "usize"], returns: "void" },
  wisp_window_submit: { args: ["ptr", "ptr", "usize", "f64", "u32"], returns: "void" },
  wisp_window_next_event: { args: ["ptr", "ptr", "u32"], returns: "u32" },
  wisp_window_take_keys: { args: ["ptr", "ptr", "usize"], returns: "usize" },
  wisp_window_select_pad: { args: ["ptr", "i32"], returns: "void" },
  wisp_window_set_present: { args: ["ptr", "u32"], returns: "void" },
  wisp_window_set_fullscreen: { args: ["ptr", "u32"], returns: "void" },
  wisp_window_metric: { args: ["ptr", "u32", "ptr", "usize"], returns: "usize" },
  wisp_window_info: { args: ["ptr", "ptr", "usize"], returns: "usize" },
  wisp_window_error: { args: ["ptr", "ptr", "usize"], returns: "usize" },
  wisp_window_vocabulary: { args: ["ptr", "usize"], returns: "usize" },
  wisp_window_stop: { args: ["ptr"], returns: "void" },
  wisp_window_attach: { args: ["ptr"], returns: "ptr" },
  wisp_window_release: { args: ["ptr"], returns: "void" },
} as const;

/** What `wisp_window_next_event` returns: a sample from the render thread, nothing within the timeout, or why the samples ended. */
const EVENT_KINDS = ["timeout", "frame", "closed", "failed", "stopped"] as const;

export const PRESENT_MODES = ["Fifo", "Mailbox", "Immediate"] as const;
export type PresentMode = (typeof PRESENT_MODES)[number];

export interface NativeWindowOptions {
  readonly title: string;
  /** `WISP_WINDOW_SIZE=WIDTHxHEIGHT` replaces both. */
  readonly width: number;
  readonly height: number;
  readonly library?: string | undefined;
  /** The present mode to ask for; `WISP_WINDOW_PRESENT` (Fifo, Mailbox or Immediate) when unset. */
  readonly present?: PresentMode | undefined;
  /** Opens borderless fullscreen; `WISP_WINDOW_FULLSCREEN=1` when unset. */
  readonly fullscreen?: boolean | undefined;
}

/** The next thing a thread that steps the game hears from the window. */
export type WindowEvent = { readonly kind: "frame"; readonly sample: InputSample } | { readonly kind: "timeout" | "closed" | "failed" | "stopped" };

/** One input sample the render thread took at a display frame: its number, when it was taken on the library's clock and the pad's buttons as a bit mask and the left stick. */
export interface InputSample {
  readonly frame: number;
  readonly sampleNs: number;
  readonly mask: number;
  /** The mouse over the window at the sample. */
  readonly pointer: PointerReading;
  /** The keys pressed and released since the sample before, oldest first, as Warcraft names them. */
  readonly keys: readonly KeyTransition[];
  /** The left stick, Y up, as the pad reports it. */
  readonly axisX: number;
  readonly axisY: number;
}

export interface WindowInfo {
  readonly adapter: string;
  readonly backend: string;
  readonly presentMode: string;
  readonly desiredMaximumFrameLatency: number;
  /** The distinct images `Fifo` has handed back so far; the swapchain's image count once the acquires have cycled. */
  readonly imageCount: number;
}

/** What the thread that steps the game needs from an open window: the samples and scenes, the status and the measured series. Any thread can hold one. */
export interface WindowView {
  readonly handle: number;
  /** Starts the frames; until then the window shows its loading state and takes no samples. The thread that steps the game calls it once its frame loop is ready. */
  start(): void;
  /** Starts the frames with no game: the render thread submits a canned scene at each sample point, which measures the display path alone. */
  startBaseline(): void;
  status(text: string): void;
  /** Selects the pad at `slot` (the browser's `gamepadIndex`); undefined takes the first connected pad. */
  selectPad(slot: number | undefined): void;
  /** Blocks this thread, running no JavaScript, until the render thread queues a sample, the window closes or fails, or the window is stopped, for at most `timeoutMs`; a zero timeout never waits. Samples come oldest first. */
  nextEvent(timeoutMs: number): WindowEvent;
  /** Hands the render thread a model or texture file, named by its Warcraft path, to upload before it draws its next scene. */
  asset(path: string, bytes: Uint8Array): void;
  /** How many pushed files the window has not finished building. */
  assetsPending(): number;
  /** Asks for a present mode; `info().presentMode` says which one the surface granted. */
  setPresent(mode: PresentMode): void;
  setFullscreen(on: boolean): void;
  /** Encodes `scene` into one buffer the view reuses and hands it to the render thread as the answer to the sample numbered `frame`. */
  submit(scene: string, step: number, frame: number): void;
  /** One of the library's per-frame series, in milliseconds. */
  metric(name: string): Float64Array;
  info(): WindowInfo;
  error(): string | undefined;
  /** The names of the buttons set in a sample's mask. */
  buttons(mask: number): readonly string[];
  /** The library's clock now, in the nanoseconds of a sample's `sampleNs`. */
  nowNs(): number;
}

export interface NativeWindow extends WindowView {
  /** Takes a reference for another thread, which adopts it with `adoptNativeWindow` and releases it; taking it here, on the thread that owns the window, means the host cannot be freed before that thread has it. */
  lend(): number;
  /** Stops the library's threads, wakes a thread blocked in `nextEvent` with a stop, then gives back this reference and unloads the library. Another thread's attached view stays valid and sees a stopped window. */
  close(): void;
}

type Library = ReturnType<typeof dlopen<typeof symbols>>;

const textFrom = (read: (pointer: Uint8Array, capacity: number) => number | bigint) => {
  let buffer = new Uint8Array(1024);
  let length = Number(read(buffer, buffer.length));
  if (length > buffer.length) {
    buffer = new Uint8Array(length);
    length = Number(read(buffer, buffer.length));
  }
  return new TextDecoder().decode(buffer.subarray(0, length));
};

const vocabularyOf = (library: Library) => JSON.parse(textFrom((out, capacity) => library.symbols.wisp_window_vocabulary(out, capacity))) as { buttons: string[]; metrics: string[] };

/** The sample's mouse fields (`wisp_window_next_event`): the cursor and window size, then the bits `PointerSample::bits` packs: held 0 to 2, pressed 4 to 6, released 8 to 10, inside 12. */
const pointerOf = (sample: Float64Array): PointerReading => {
  const bits = sample[9]!;
  return { x: sample[5]!, y: sample[6]!, width: sample[7]!, height: sample[8]!, inside: (bits & 1 << 12) !== 0, held: bits & 7, pressed: bits >> 4 & 7, released: bits >> 8 & 7 };
};

const KEY_BATCH = 64;
const NO_KEYS: readonly KeyTransition[] = [];

const viewOf = (library: Library, handle: Pointer, vocabulary: { buttons: string[]; metrics: string[] }): WindowView => {
  const call = library.symbols;
  const encoder = new TextEncoder();
  // A fresh array per frame reports external memory to the collector, which then collects every frame; one reused buffer keeps the pause count to what the frame allocates.
  let sceneBuffer = new Uint8Array(64 * 1024);
  const sample = new Float64Array(10);
  const keyBuffer = new Uint32Array(KEY_BATCH);
  const takeKeys = () => {
    let count = Number(call.wisp_window_take_keys(handle, keyBuffer, KEY_BATCH));
    if (count === 0) return NO_KEYS;
    const keys: KeyTransition[] = [];
    for (;;) {
      for (let index = 0; index < count; index++) keys.push(unpackKey(keyBuffer[index]!));
      if (count < KEY_BATCH) return keys;
      count = Number(call.wisp_window_take_keys(handle, keyBuffer, KEY_BATCH));
    }
  };
  return {
    handle: handle as number,
    start: () => call.wisp_window_start(handle),
    startBaseline: () => call.wisp_window_start_baseline(handle),
    status: (text) => { const bytes = Buffer.from(text); call.wisp_window_status(handle, bytes, bytes.length); },
    selectPad: (slot) => call.wisp_window_select_pad(handle, slot ?? -1),
    nextEvent: (timeoutMs) => {
      const kind = EVENT_KINDS[call.wisp_window_next_event(handle, sample, timeoutMs)] ?? "failed";
      return kind === "frame" ? { kind, sample: { frame: sample[0]!, sampleNs: sample[1]!, mask: sample[2]!, axisX: sample[3]!, axisY: sample[4]!, pointer: pointerOf(sample), keys: takeKeys() } } : { kind };
    },
    asset: (path, bytes) => { const name = Buffer.from(path); call.wisp_window_asset(handle, name, name.length, bytes, bytes.length); },
    assetsPending: () => Number(call.wisp_window_assets_pending(handle)),
    setPresent: (mode) => call.wisp_window_set_present(handle, PRESENT_MODES.indexOf(mode)),
    setFullscreen: (on) => call.wisp_window_set_fullscreen(handle, on ? 1 : 0),
    submit: (scene, step, frame) => {
      let written = encoder.encodeInto(scene, sceneBuffer);
      while (written.read < scene.length) {
        sceneBuffer = new Uint8Array(sceneBuffer.length * 2);
        written = encoder.encodeInto(scene, sceneBuffer);
      }
      call.wisp_window_submit(handle, sceneBuffer, written.written, step, frame);
    },
    metric: (name) => {
      const which = vocabulary.metrics.indexOf(name);
      const count = Number(call.wisp_window_metric(handle, which, null, 0));
      const values = new Float64Array(count);
      call.wisp_window_metric(handle, which, values, count);
      return values;
    },
    info: () => JSON.parse(textFrom((out, capacity) => call.wisp_window_info(handle, out, capacity)) || "{}") as WindowInfo,
    error: () => textFrom((out, capacity) => call.wisp_window_error(handle, out, capacity)) || undefined,
    buttons: (mask) => vocabulary.buttons.filter((_, bit) => (mask >> bit & 1) === 1),
    nowNs: () => call.wisp_window_now_ns(),
  };
};

/** The worker thread's view of a window: it loads the library again and uses the reference `NativeWindow.lend` took for it, which the library guards with its own locks. `release` gives that reference back and unloads this view's copy; the host outlives the window's stop until every reference is released. */
export function adoptNativeWindow(lent: number, library?: string): WindowView & { release(): void } {
  const loaded = dlopen(library ?? windowLibraryPath(), symbols);
  return {
    ...viewOf(loaded, lent as Pointer, vocabularyOf(loaded)),
    release: () => {
      loaded.symbols.wisp_window_release(lent as Pointer);
      loaded.close();
    },
  };
}

export function openNativeWindow(options: NativeWindowOptions): NativeWindow {
  const library = dlopen(options.library ?? windowLibraryPath(), symbols);
  const call = library.symbols;
  const vocabulary = vocabularyOf(library);
  const title = Buffer.from(options.title);
  const size = /^(\d+)x(\d+)$/.exec(process.env.WISP_WINDOW_SIZE ?? "");
  const handle = call.wisp_window_open(title, title.length, size === null ? options.width : Number(size[1]), size === null ? options.height : Number(size[2]));
  if (handle === null) {
    const reason = textFrom((out, capacity) => call.wisp_window_open_error(out, capacity));
    library.close();
    throw new Error(`the window didn't open: ${reason}`);
  }
  let closed = false;
  const view = viewOf(library, handle as Pointer, vocabulary);
  const present = options.present ?? PRESENT_MODES.find((mode) => mode === process.env.WISP_WINDOW_PRESENT);
  if (present !== undefined) view.setPresent(present);
  if (options.fullscreen ?? process.env.WISP_WINDOW_FULLSCREEN === "1") view.setFullscreen(true);
  return {
    ...view,
    lend: () => call.wisp_window_attach(handle as Pointer) as number,
    close: () => {
      if (closed) return;
      closed = true;
      call.wisp_window_stop(handle as Pointer);
      call.wisp_window_release(handle as Pointer);
      library.close();
    },
  };
}
