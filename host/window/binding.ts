import { existsSync } from "node:fs";
import { join } from "node:path";
import { JSCallback, dlopen } from "bun:ffi";

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
  wisp_window_submit: { args: ["ptr", "ptr", "usize", "f64"], returns: "void" },
  wisp_window_metric: { args: ["ptr", "u32", "ptr", "usize"], returns: "usize" },
  wisp_window_missed_scenes: { args: ["ptr"], returns: "f64" },
  wisp_window_info: { args: ["ptr", "ptr", "usize"], returns: "usize" },
  wisp_window_error: { args: ["ptr", "ptr", "usize"], returns: "usize" },
  wisp_window_vocabulary: { args: ["ptr", "usize"], returns: "usize" },
  wisp_window_close: { args: ["ptr"], returns: "void" },
} as const;

export type WakeKind = "frame" | "closed" | "error";

/** What the render thread tells Bun at each sample point: the frame to step, the buttons held and when the sample was taken. */
export interface Wake {
  readonly kind: WakeKind;
  readonly frame: number;
  readonly sampleNs: number;
  readonly buttons: readonly string[];
  /** The library's clock when Bun began handling the wake, in the same nanoseconds as `sampleNs`. */
  readonly handledNs: number;
}

export interface NativeWindowOptions {
  readonly title: string;
  readonly width: number;
  readonly height: number;
  readonly library?: string;
  readonly onWake: (wake: Wake) => void;
}

export interface WindowInfo {
  readonly adapter: string;
  readonly backend: string;
  readonly presentMode: string;
  readonly desiredMaximumFrameLatency: number;
}

export interface NativeWindow {
  /** Starts the frame wakes; until then the window shows its loading state. */
  start(): void;
  status(text: string): void;
  submit(scene: string, step: number): void;
  /** One of the library's per-frame series, in milliseconds. */
  metric(name: string): Float64Array;
  missedScenes(): number;
  info(): WindowInfo;
  error(): string | undefined;
  /** Stops the library's threads, then releases the callback and the library; the wake is never called after it returns. */
  close(): void;
}

const kinds: readonly WakeKind[] = ["frame", "closed", "error"];

export function openNativeWindow(options: NativeWindowOptions): NativeWindow {
  const library = dlopen(options.library ?? windowLibraryPath(), symbols);
  const call = library.symbols;
  const readText = (read: (pointer: Uint8Array, capacity: number) => number | bigint) => {
    let buffer = new Uint8Array(1024);
    let length = Number(read(buffer, buffer.length));
    if (length > buffer.length) {
      buffer = new Uint8Array(length);
      length = Number(read(buffer, buffer.length));
    }
    return new TextDecoder().decode(buffer.subarray(0, length));
  };
  const vocabulary = JSON.parse(readText((out, capacity) => call.wisp_window_vocabulary(out, capacity))) as { buttons: string[]; metrics: string[] };
  let closed = false;
  // A fresh array per frame reports external memory to the collector, which then collects every frame; one reused buffer keeps the pause count to what the frame allocates.
  const encoder = new TextEncoder();
  let sceneBuffer = new Uint8Array(64 * 1024);
  const wake = new JSCallback((kind: number, frame: number, sampleNs: number, mask: number) => {
    if (closed) return;
    const handledNs = call.wisp_window_now_ns();
    const buttons = vocabulary.buttons.filter((_, bit) => (mask >> bit & 1) === 1);
    options.onWake({ kind: kinds[kind] ?? "error", frame, sampleNs, buttons, handledNs });
  }, { args: ["u32", "u32", "f64", "u32"], returns: "void", threadsafe: true });
  const title = Buffer.from(options.title);
  const handle = call.wisp_window_open(title, title.length, options.width, options.height, wake.ptr);
  if (handle === null) {
    const reason = readText((out, capacity) => call.wisp_window_open_error(out, capacity));
    wake.close();
    library.close();
    throw new Error(`the window didn't open: ${reason}`);
  }
  return {
    start: () => call.wisp_window_start(handle),
    status: (text) => { const bytes = Buffer.from(text); call.wisp_window_status(handle, bytes, bytes.length); },
    submit: (scene, step) => {
      let written = encoder.encodeInto(scene, sceneBuffer);
      while (written.read < scene.length) {
        sceneBuffer = new Uint8Array(sceneBuffer.length * 2);
        written = encoder.encodeInto(scene, sceneBuffer);
      }
      call.wisp_window_submit(handle, sceneBuffer, written.written, step);
    },
    metric: (name) => {
      const which = vocabulary.metrics.indexOf(name);
      const count = Number(call.wisp_window_metric(handle, which, null, 0));
      const values = new Float64Array(count);
      call.wisp_window_metric(handle, which, values, count);
      return values;
    },
    missedScenes: () => call.wisp_window_missed_scenes(handle),
    info: () => JSON.parse(readText((out, capacity) => call.wisp_window_info(handle, out, capacity)) || "{}") as WindowInfo,
    error: () => readText((out, capacity) => call.wisp_window_error(handle, out, capacity)) || undefined,
    close: () => {
      if (closed) return;
      closed = true;
      call.wisp_window_close(handle);
      wake.close();
      library.close();
    },
  };
}
