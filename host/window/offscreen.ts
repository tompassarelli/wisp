import { type Pointer, dlopen } from "bun:ffi";
import { windowLibraryPath } from "./binding";

const symbols = {
  wisp_offscreen_open: { args: ["u32", "u32"], returns: "ptr" },
  wisp_offscreen_error: { args: ["ptr", "usize"], returns: "usize" },
  wisp_offscreen_asset: { args: ["ptr", "ptr", "usize", "ptr", "usize"], returns: "void" },
  wisp_offscreen_pending: { args: ["ptr"], returns: "u64" },
  wisp_offscreen_render: { args: ["ptr", "ptr", "usize"], returns: "u32" },
  wisp_offscreen_picture: { args: ["ptr", "ptr", "usize"], returns: "usize" },
  wisp_offscreen_info: { args: ["ptr", "ptr", "usize"], returns: "usize" },
  wisp_offscreen_close: { args: ["ptr"], returns: "void" },
} as const;

export interface OffscreenInfo {
  readonly adapter: string;
  readonly backend: string;
  /** What the renderer found wrong with the files it was given, drained by each call. */
  readonly problems: readonly string[];
}

/** The native renderer with no window: it takes the same assets and scene JSON as the window and answers with a PNG (wisp:docs/native-window-plan.md, W3). */
export interface Offscreen {
  asset(path: string, bytes: Uint8Array): void;
  /** How many pushed files the renderer has not finished building. */
  pending(): number;
  /** Draws `scene` and returns the image as a PNG. */
  render(scene: string): Uint8Array;
  info(): OffscreenInfo;
  close(): void;
}

const textFrom = (read: (out: Uint8Array, capacity: number) => number | bigint): Uint8Array => {
  let buffer = new Uint8Array(1024);
  const length = Number(read(buffer, buffer.length));
  if (length > buffer.length) {
    buffer = new Uint8Array(length);
    read(buffer, buffer.length);
  }
  return buffer.subarray(0, length);
};

export function openOffscreen(width: number, height: number, library: string = windowLibraryPath()): Offscreen {
  const loaded = dlopen(library, symbols);
  const call = loaded.symbols;
  const handle = call.wisp_offscreen_open(width, height);
  if (handle === null) {
    const reason = new TextDecoder().decode(textFrom((out, capacity) => call.wisp_offscreen_error(out, capacity)));
    loaded.close();
    throw new Error(`the offscreen renderer didn't open: ${reason}`);
  }
  const pointer = handle as Pointer;
  return {
    asset: (path, bytes) => { const name = Buffer.from(path); call.wisp_offscreen_asset(pointer, name, name.length, bytes, bytes.length); },
    pending: () => Number(call.wisp_offscreen_pending(pointer)),
    render: (scene) => {
      const bytes = Buffer.from(scene);
      if (call.wisp_offscreen_render(pointer, bytes, bytes.length) !== 1) throw new Error(`the offscreen renderer failed: ${new TextDecoder().decode(textFrom((out, capacity) => call.wisp_offscreen_error(out, capacity)))}`);
      return textFrom((out, capacity) => call.wisp_offscreen_picture(pointer, out, capacity)).slice();
    },
    info: () => JSON.parse(new TextDecoder().decode(textFrom((out, capacity) => call.wisp_offscreen_info(pointer, out, capacity)))) as OffscreenInfo,
    close: () => { call.wisp_offscreen_close(pointer); loaded.close(); },
  };
}
