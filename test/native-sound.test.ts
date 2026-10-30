import { expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { SoundCue } from "../src/headless/clientTypes";
import { openNativeAudio, type NativeAudio } from "../host/window/audio";
import { windowLibraryPath } from "../host/window/binding";
import { Effect } from "effect";
import { installHeadless } from "../host/headless/headless";
import { openStandalone, type StandaloneGame } from "../host/play/standalone";
import { createSoundPlayer } from "../host/window/soundPlayer";

const cue = (overrides: Partial<SoundCue> & { handle: { kind: string; id: number } }): SoundCue => ({
  event: "start", kind: "sound", frame: 1, source: "Sound\\a.flac", label: undefined, volume: 127, effectiveVolume: 127, looping: false, pitch: 1, x: 0, y: 0, z: 0, ...overrides,
});

const fakeAudio = () => {
  const loads: string[] = [], plays: { key: string; volume: number; pitch: number }[] = [];
  const audio: NativeAudio = {
    load: (key) => { if (key.includes("broken")) throw new Error("not audio"); if (!loads.includes(key)) loads.push(key); },
    play: (key, volume, pitch) => { plays.push({ key, volume, pitch }); return true; },
    info: () => ({ output: "fake", channels: 2, sampleRate: 48_000, bufferFrames: 256, decoded: loads.length, started: plays.length }),
    close: () => undefined,
  };
  return { audio, loads, plays };
};

test("[spec docs/native-window-plan.md] a start plays at the cue's volume and pitch, and a second handle with the same resolved file decodes nothing new", async () => {
  const { audio, loads, plays } = fakeAudio();
  const player = createSoundPlayer(async () => ({ path: "Sound\\A.flac", bytes: new Uint8Array(4) }), audio);
  player.cues([cue({ handle: { kind: "sound", id: 1 }, volume: 64, pitch: 1.5 }), cue({ handle: { kind: "sound", id: 2 } }), cue({ handle: { kind: "sound", id: 1 }, event: "stop" })]);
  const figures = await player.settle();
  expect(loads).toEqual(["sound/a.flac"]);
  expect(plays).toEqual([{ key: "sound/a.flac", volume: 64, pitch: 1.5 }, { key: "sound/a.flac", volume: 127, pitch: 1 }]);
  expect(figures).toMatchObject({ audioEvents: 3, audioReadyEvents: 3, audioPlayed: 2, audioDecodedAssets: 1, missingSounds: [], audioOutput: "fake" });
});

test.skipIf(!existsSync(windowLibraryPath()))("[spec docs/native-window-plan.md] the library decodes Vorbis, plays it and reports the output it used", () => {
  const audio = openNativeAudio();
  try {
    expect(audio.play("tone", 127, 1)).toBe(false);
    audio.load("tone", new Uint8Array(readFileSync(join(import.meta.dir, "fixtures/tone.ogg"))));
    audio.load("tone", new Uint8Array(0));
    expect(audio.play("tone", 127, 0.5)).toBe(true);
    expect(() => audio.load("bad", new TextEncoder().encode("not audio"))).toThrow();
    expect(audio.info()).toMatchObject({ decoded: 1, started: 1, bufferFrames: expect.any(Number) });
    expect(audio.info().bufferFrames).toBeLessThanOrEqual(256);
  } finally {
    audio.close();
  }
});

test.skipIf(!existsSync(windowLibraryPath()))("[spec docs/native-window-plan.md] a native standalone run plays its step's cues through the library and finishes with the audio counts", async () => {
  const tone = new Uint8Array(readFileSync(join(import.meta.dir, "fixtures/tone.ogg")));
  const runtime = installHeadless({ filePrefix: "native-sound-fixture", globalPrefixes: [] });
  const clients = runtime.clients({ install() {}, start() {} }, [0]);
  clients.start();
  const game: StandaloneGame = {
    title: "Native sound fixture", render: { readAsset: async (path) => (path.endsWith("tone.ogg") ? tone : undefined) },
    create: async () => ({ client: clients.client(0), step: () => clients.frames(1), checksum: () => "", close: () => runtime.restore() }),
  };
  const result = await Effect.runPromise(Effect.scoped(Effect.gen(function*() {
    const player = yield* openStandalone(game, { window: "native" });
    clients.client(0).soundLog.push(
      cue({ source: "Sound\\tone.ogg", handle: { kind: "sound", id: 7 }, volume: 90, pitch: 1.25 }),
      cue({ source: "Sound\\absent.ogg", handle: { kind: "sound", id: 8 } }),
    );
    player.native.advance({ buttons: [], axisX: 0, axisY: 0 });
    return yield* Effect.promise(() => player.native.finish({ frames: 1 }));
  })));
  expect(result).toMatchObject({ frames: 1, audioEvents: 2, audioPlayed: 1, audioDecodedAssets: 1, missingSounds: ["missing sound: Sound\\absent.ogg"] });
  expect(typeof result.audioOutput).toBe("string");
});
