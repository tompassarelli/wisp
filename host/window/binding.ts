import { existsSync } from "node:fs";
import { join } from "node:path";
import { JSCallback, type Pointer, dlopen } from "bun:ffi";

const root = join(import.meta.dir, "../..");
const libraryFile = process.platform === "win32" ? "wisp_window.dll" : "libwisp_window.so";

/** The `wisp-window` library beside the player executable, else `WISP_WINDOW_LIBRARY`, else the release build in this checkout. */
export function windowLibraryPath(): string {
  const beside = join(process.execPath, "..", libraryFile);
  return process.env.WISP_WINDOW_LIBRARY ?? (existsSync(beside) ? beside : join(root, "window/target/release", libraryFile));
}

export const windowLibraryBuild = { manifest: join(root, "window/Cargo.toml"), path: windowLibraryPath };

const symbols = {
  wisp_window_now_ns: { args: [], returns: "f64" },
  wisp_window_open: { args: ["ptr", "usize", "u32", "u32", "ptr"], returns: "ptr" },
  wisp_window_open_error: { args: ["ptr", "usize"], returns: "usize" },
  wisp_window_start: { args: ["ptr"], returns: "void" },
  wisp_window_status: { args: ["ptr", "ptr", "usize"], returns: "void" },
  wisp_window_start_baseline: { args: ["ptr"], returns: "void" },
  wisp_window_submit: { args: ["ptr", "ptr", "usize", "f64", "u32"], returns: "void" },
  wisp_window_next_event: { args: ["ptr", "ptr", "u32"], returns: "u32" },
  wisp_window_metric: { args: ["ptr", "u32", "ptr", "usize"], returns: "usize" },
  wisp_window_info: { args: ["ptr", "ptr", "usize"], returns: "usize" },
  wisp_window_error: { args: ["ptr", "ptr", "usize"], returns: "usize" },
  wisp_window_vocabulary: { args: ["ptr", "usize"], returns: "usize" },
  wisp_window_close: { args: ["ptr"], returns: "void" },
} as const;

/** What the render thread tells Bun at each sample point: the kind below, the frame to step, when the sample was taken, the held buttons as a bit mask and when Bun began handling it. */
export const WAKE_FRAME = 0, WAKE_CLOSED = 1, WAKE_ERROR = 2;

/** Called on Bun's main thread for every wake, with numbers only so the seam allocates nothing; `handledNs` is the library's clock when the callback began, in the same nanoseconds as `sampleNs`. */
export type OnWake = (kind: number, frame: number, sampleNs: number, mask: number, handledNs: number) => void;

export interface NativeWindowOptions {
  readonly title: string;
  readonly width: number;
  readonly height: number;
  readonly library?: string | undefined;
  readonly onWake: OnWake;
}

/** One input sample the render thread took at a display frame: its number, when it was taken on the library's clock and the held buttons as a bit mask. */
export interface InputSample {
  readonly frame: number;
  readonly sampleNs: number;
  readonly mask: number;
}

export interface WindowInfo {
  readonly adapter: string;
  readonly backend: string;
  readonly presentMode: string;
  readonly desiredMaximumFrameLatency: number;
}

/** What the thread that steps the game needs from an open window: the samples and scenes, the status and the measured series. Any thread can hold one. */
export interface WindowView {
  readonly handle: number;
  /** Starts the frames; until then the window shows its loading state and takes no samples. The thread that steps the game calls it once its frame loop is ready. */
  start(): void;
  /** Starts the frames with no game: the render thread submits a canned scene at each sample point, which measures the display path alone. */
  startBaseline(): void;
  status(text: string): void;
  /** The oldest queued sample without waiting, or undefined when there is none; call it until it returns undefined to take every sample in order. */
  nextSample(): InputSample | undefined;
  /** Encodes `scene` into one buffer the view reuses and hands it to the render thread as the answer to the sample numbered `frame`. */
  submit(scene: string, step: number, frame: number): void;
  /** One of the library's per-frame series, in milliseconds. */
  metric(name: string): Float64Array;
  info(): WindowInfo;
  error(): string | undefined;
  /** The names of the buttons set in a wake's mask. */
  buttons(mask: number): readonly string[];
  /** The library's clock now, in the nanoseconds of a wake's `sampleNs`. */
  nowNs(): number;
}

export interface NativeWindow extends WindowView {
  /** Stops the library's threads, then releases the callback and the library; the wake is never called after it returns. */
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

const viewOf = (library: Library, handle: Pointer, vocabulary: { buttons: string[]; metrics: string[] }): WindowView => {
  const call = library.symbols;
  const encoder = new TextEncoder();
  // A fresh array per frame reports external memory to the collector, which then collects every frame; one reused buffer keeps the pause count to what the frame allocates.
  let sceneBuffer = new Uint8Array(64 * 1024);
  const sample = new Float64Array(3);
  return {
    handle: handle as number,
    start: () => call.wisp_window_start(handle),
    startBaseline: () => call.wisp_window_start_baseline(handle),
    status: (text) => { const bytes = Buffer.from(text); call.wisp_window_status(handle, bytes, bytes.length); },
    nextSample: () => (call.wisp_window_next_event(handle, sample, 0) === 0 ? undefined : { frame: sample[0]!, sampleNs: sample[1]!, mask: sample[2]! }),
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

/** Another thread's view of a window `openNativeWindow` opened: it loads the library again and calls the same handle, which the library guards with its own locks. `release` unloads this view's copy. */
export function attachNativeWindow(handle: number, library?: string): WindowView & { release(): void } {
  const loaded = dlopen(library ?? windowLibraryPath(), symbols);
  return { ...viewOf(loaded, handle as Pointer, vocabularyOf(loaded)), release: () => loaded.close() };
}

export function openNativeWindow(options: NativeWindowOptions): NativeWindow {
  const library = dlopen(options.library ?? windowLibraryPath(), symbols);
  const call = library.symbols;
  const vocabulary = vocabularyOf(library);
  let closed = false;
  const wake = new JSCallback((kind: number, frame: number, sampleNs: number, mask: number) => {
    if (closed) return;
    options.onWake(kind, frame, sampleNs, mask, call.wisp_window_now_ns());
  }, { args: ["u32", "u32", "f64", "u32"], returns: "void", threadsafe: true });
  const title = Buffer.from(options.title);
  const handle = call.wisp_window_open(title, title.length, options.width, options.height, wake.ptr);
  if (handle === null) {
    const reason = textFrom((out, capacity) => call.wisp_window_open_error(out, capacity));
    wake.close();
    library.close();
    throw new Error(`the window didn't open: ${reason}`);
  }
  return {
    ...viewOf(library, handle as Pointer, vocabulary),
    close: () => {
      if (closed) return;
      closed = true;
      call.wisp_window_close(handle);
      wake.close();
      library.close();
    },
  };
}
