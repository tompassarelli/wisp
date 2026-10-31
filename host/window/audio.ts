import { dlopen } from "bun:ffi";
import { windowLibraryPath } from "./binding";

const symbols = {
  wisp_audio_open: { args: [], returns: "ptr" },
  wisp_audio_load: { args: ["ptr", "ptr", "usize", "ptr", "usize"], returns: "u32" },
  wisp_audio_error: { args: ["ptr", "usize"], returns: "usize" },
  wisp_audio_play: { args: ["ptr", "ptr", "usize", "ptr", "usize", "f64", "f64", "u32"], returns: "u32" },
  wisp_audio_stop: { args: ["ptr", "ptr", "usize"], returns: "void" },
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
  /** Starts the sound loaded under `key` as a voice of `owner`, looping until `stop(owner)` when `looping`; false when the key isn't loaded. */
  play(key: string, owner: string, volume: number, pitch: number, looping: boolean): boolean;
  /** Ends every voice `owner` started. */
  stop(owner: string): void;
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
    play: (key, owner, volume, pitch, looping) => {
      const name = Buffer.from(key), voice = Buffer.from(owner);
      return call.wisp_audio_play(handle, name, name.length, voice, voice.length, volume, pitch, looping ? 1 : 0) === 1;
    },
    stop: (owner) => {
      const voice = Buffer.from(owner);
      call.wisp_audio_stop(handle, voice, voice.length);
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
