import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { SoundCue } from "../src/headless/clientTypes";
import { type NativeAudio } from "../host/window/audio";
import { createSoundResolver } from "../host/render/standaloneSound";
import { loadGame } from "../host/window/gameModule";
import { createSoundPlayer } from "../host/window/soundPlayer";
import { Sounds } from "../src/game/native/soundStore";

const cue = (overrides: Partial<SoundCue> & { handle: { kind: string; id: number } }): SoundCue => ({
  event: "start", kind: "sound", frame: 1, source: "Sound\\a.flac", label: undefined, volume: 127, effectiveVolume: 127, looping: false, pitch: 1, x: 0, y: 0, z: 0, ...overrides,
});

const fakeAudio = () => {
  const loads: string[] = [], plays: { key: string; volume: number; pitch: number }[] = [];
  let voices: { key: string; owner: string; looping: boolean }[] = [];
  const audio: NativeAudio = {
    load: (key) => { if (key.includes("broken")) throw new Error("not audio"); if (!loads.includes(key)) loads.push(key); },
    play: (key, owner, volume, pitch, looping) => { plays.push({ key, volume, pitch }); voices.push({ key, owner, looping }); return true; },
    stop: (owner) => { voices = voices.filter((voice) => voice.owner !== owner); },
    info: () => ({ output: "fake", channels: 2, sampleRate: 48_000, bufferFrames: 256, decoded: loads.length, started: plays.length }),
    close: () => undefined,
  };
  return { audio, loads, plays, voices: () => voices };
};

test("[spec docs/native-window-plan.md] changing the music, from menu to stage to victory theme and back, leaves exactly one music voice, and stopping the music silences it", async () => {
  const { audio, voices } = fakeAudio();
  let id = 0;
  const sounds = new Sounds((kind) => ({ kind, id: id++ }), 1, () => 0);
  const player = createSoundPlayer(async (cue) => ({ path: cue.source ?? "", bytes: new Uint8Array(4) }), audio);
  let figures: Awaited<ReturnType<typeof player.settle>> | undefined;
  const music = async () => {
    player.cues(sounds.log.splice(0));
    figures = await player.settle();
    return voices().map((voice) => `${voice.key}${voice.looping ? " (looping)" : ""}`);
  };
  sounds.playMusic("Menu.mp3");
  sounds.playMusic("Menu.mp3");
  expect(await music()).toEqual(["menu.mp3 (looping)"]);
  sounds.stopMusic();
  sounds.playMusic("Stage.mp3");
  expect(await music()).toEqual(["stage.mp3 (looping)"]);
  sounds.stopMusic();
  sounds.playMusic("Victory.mp3", false);
  expect(await music()).toEqual(["victory.mp3"]);
  sounds.playMusic("Menu.mp3");
  expect(await music()).toEqual(["menu.mp3 (looping)"]);
  sounds.stopMusic();
  expect(await music()).toEqual([]);
  expect(figures?.musicLog.map(({ event, track, held }) => [event, track, held.length])).toEqual([
    ["start", "menu.mp3", 1], ["stop", undefined, 0], ["start", "menu.mp3", 1], ["stop", undefined, 0], ["start", "stage.mp3", 1], ["stop", undefined, 0], ["start", "victory.mp3", 1], ["stop", undefined, 0], ["start", "menu.mp3", 1], ["stop", undefined, 0],
  ]);
});

test("[spec docs/play.md] a worker's game export given as a function is built with the flags the player ran with", async () => {
  const module = join(import.meta.dir, "fixtures/argumentGame.ts");
  expect((await loadGame({ module, export: "game", arguments: ["--map", "Makgora.w3x", "--player-assets-only"] })).title).toBe("--map Makgora.w3x --player-assets-only");
  expect((await loadGame({ module, export: "plain" })).title).toBe("plain");
  await expect(loadGame({ module, export: "absent" })).rejects.toThrow("exports no absent");
});

const stockSounds = JSON.parse(readFileSync(join(import.meta.dir, "fixtures/stock-sounds.json"), "utf8")) as { absent: string[]; present: { ask: string; stored: string }[] };

test("[native] every stock sound the cpu-expert run asks for resolves to the file the install holds under its locale mod, and each one the install lacks resolves to nothing", async () => {
  const held = new Map(stockSounds.present.map(({ stored }) => [stored, new Uint8Array([1])]));
  const slk = ['ID;PWXL;N;E', 'C;X1;Y1;K"SoundName"', 'C;X2;K"AnimationEventCode"', 'C;X3;K"FileNames"', 'C;X1;Y2;K"RiflemanDeath"', 'C;X2;K"DDTH"', 'C;X3;K"RiflemanDeath1"', 'E'].join("\n");
  const resolve = createSoundResolver(async (path) => path === "UI/SoundInfo/AnimSounds.slk" ? new TextEncoder().encode(slk) : held.get(path.toLowerCase()));
  for (const [index, { ask, stored }] of stockSounds.present.entries()) {
    const found = await resolve(cue({ source: ask.replaceAll("/", "\\"), handle: { kind: "sound", id: index } }));
    expect(found?.path.toLowerCase()).toBe(stored);
  }
  for (const [index, name] of stockSounds.absent.entries()) {
    const asked = name.includes("\\") ? cue({ source: name, handle: { kind: "sound", id: index } }) : cue({ source: undefined, label: name, handle: { kind: "sound", id: index } });
    expect(await resolve(asked)).toBeUndefined();
  }
});
