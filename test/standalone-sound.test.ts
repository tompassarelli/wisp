import { expect, test } from "bun:test";
import type { SoundCue } from "../src/headless/client";
import { createSoundResolver } from "../scripts/wisp/standaloneSound";

const cue = (source: string | undefined, label: string | undefined): SoundCue => ({
  event: "create", frame: 1, handle: { kind: "sound", id: 2 }, source, label,
  volume: 127, pitch: 1, x: 0, y: 0, z: 0,
});

test("[spec docs/play.md] stock SLK labels and direct paths resolve installed encodings with one read per sound", async () => {
  const bytes = new Uint8Array([1, 2, 3]);
  const table = new TextEncoder().encode([
    "ID;PWXL;N;E", 'C;X1;Y1;K"SoundName"', 'C;X2;K"DirectoryBase"', 'C;X3;K"FileNames"',
    'C;X1;Y2;K"Fixture;Footstep"', 'C;X2;K"Sound\\Steps"', 'C;X3;K"Missing.wav,Present.wav"', "E",
  ].join("\r\n"));
  const reads: string[] = [];
  const resolve = createSoundResolver(async (path) => {
    reads.push(path);
    if (path === "UI/SoundInfo/AnimSounds.slk") return table;
    return path === "Sound/Steps/Present.flac" || path === "Imported/Hit.ogg" ? bytes : undefined;
  });
  const created = cue(undefined, "Fixture;Footstep");
  expect(await resolve(created)).toEqual({ path: "Sound/Steps/Present.flac", bytes });
  expect(await resolve({ ...created, event: "start" })).toEqual({ path: "Sound/Steps/Present.flac", bytes });
  expect(reads.filter((path) => path === "UI/SoundInfo/AnimSounds.slk")).toHaveLength(1);
  expect(reads.filter((path) => path === "Sound/Steps/Present.flac")).toHaveLength(1);
  expect(await resolve(cue("Imported\\Hit.wav", undefined))).toEqual({ path: "Imported/Hit.ogg", bytes });
  expect(await resolve(cue(undefined, "Unknown"))).toBeUndefined();
});
