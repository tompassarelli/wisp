import { dlopen } from "bun:ffi";
import { windowLibraryPath } from "./binding";

const symbols = {
  wisp_audio_open: { args: [], returns: "ptr" },
  wisp_audio_load: { args: ["ptr", "ptr", "usize", "ptr", "usize"], returns: "u32" },
  wisp_audio_error: { args: ["ptr", "usize"], returns: "usize" },
  wisp_audio_play: { args: ["ptr", "ptr", "usize", "f64", "f64"], returns: "u32" },
  wisp_audio_info: { args: ["ptr", "ptr", "usize"], returns: "usize" },
  wisp_audio_close: { args: ["ptr"], returns: "void" },
} as const;

export interface AudioInfo {
  readonly output: string;
  readonly channels: number;
  readonly sampleRate: number;
  readonly bufferFrames: number;
  readonly decoded: number;
  readonly started: number;
}

/** The library's sound output: sounds decoded once under a key and started by key with the page's volume and pitch. */
export interface NativeAudio {
  /** Decodes `bytes` under `key` unless the key is already loaded; throws the reason when the file can't be read. */
  load(key: string, bytes: Uint8Array): void;
  /** Starts the sound loaded under `key`; false when the key isn't loaded. */
  play(key: string, volume: number, pitch: number): boolean;
  info(): AudioInfo;
  close(): void;
}

const textFrom = (read: (out: Uint8Array, capacity: number) => number | bigint) => {
  let buffer = new Uint8Array(512);
  let length = Number(read(buffer, buffer.length));
  if (length > buffer.length) {
    buffer = new Uint8Array(length);
    length = Number(read(buffer, buffer.length));
  }
  return new TextDecoder().decode(buffer.subarray(0, length));
};

export function openNativeAudio(library?: string): NativeAudio {
  const loaded = dlopen(library ?? windowLibraryPath(), symbols);
  const call = loaded.symbols;
  const handle = call.wisp_audio_open();
  if (handle === null) {
    loaded.close();
    throw new Error("the sound output didn't open");
  }
  let closed = false;
  return {
    load: (key, bytes) => {
      const name = Buffer.from(key);
      if (call.wisp_audio_load(handle, name, name.length, bytes, bytes.length) !== 0) throw new Error(textFrom((out, capacity) => call.wisp_audio_error(out, capacity)));
    },
    play: (key, volume, pitch) => {
      const name = Buffer.from(key);
      return call.wisp_audio_play(handle, name, name.length, volume, pitch) === 1;
    },
    info: () => JSON.parse(textFrom((out, capacity) => call.wisp_audio_info(handle, out, capacity))) as AudioInfo,
    close: () => {
      if (closed) return;
      closed = true;
      call.wisp_audio_close(handle);
      loaded.close();
    },
  };
}
