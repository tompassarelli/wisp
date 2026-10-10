import { afterAll, expect, test } from "bun:test";
import { join } from "node:path";
import { mapCompiler, report } from "../scripts/compiler";
import { installHeadless } from "../scripts/wisp/headless";
import { assertSoundCue } from "../src/headless/client";
import { runJourney } from "../src/headless/journey";
import { install, start } from "./sounds60/main";
import { SOUND_NATIVES, SOUND_PATH } from "./sounds60/cases";
import { farmTest } from "../scripts/wisp/farmTest";
import * as audio80 from "./audio80/main";

const runtime = installHeadless({ filePrefix: "sounds60", globalPrefixes: ["__sounds60"], natives: SOUND_NATIVES });
afterAll(runtime.restore);

const AUDIO80 = [
  "0 sound create Imported\\Hit.ogg loop=true volume=127",
  "0 sound start Imported\\Hit.ogg loop=true volume=127",
  "0 music start Imported\\Stage.ogg loop=true volume=127",
  "6 sound volume Imported\\Hit.ogg loop=true volume=64",
  "6 music volume Imported\\Stage.ogg loop=true volume=64",
  "12 sound volume Imported\\Hit.ogg loop=true volume=0",
  "12 music volume Imported\\Stage.ogg loop=true volume=0",
  "18 sound stop Imported\\Hit.ogg loop=true volume=0",
  "18 music stop Imported\\Stage.ogg loop=true volume=0",
  "24 music start Imported\\Stage.ogg loop=true volume=0",
  "30 music volume Imported\\Stage.ogg loop=true volume=127",
  "36 music stop Imported\\Stage.ogg loop=true volume=127",
  "36 music start Imported\\NextStage.ogg loop=true volume=127",
  "42 music stop Imported\\NextStage.ogg loop=true volume=127",
];

test("[spec #80] map sound and stage music record loop, stop and mute in event order", () => {
  const clients = runtime.clients(audio80);
  const result = runJourney(clients, { frames: 48, events: [] });
  expect(result.divergence).toBeUndefined();
  for (const client of clients.clients) {
    expect(client.missingNatives).toEqual([]);
    expect(client.soundLog.map(cue => `${cue.frame} ${cue.kind} ${cue.event} ${cue.source} loop=${cue.looping} volume=${cue.volume}`)).toEqual(AUDIO80);
    expect(client.soundLog.map(cue => cue.effectiveVolume)).toEqual([1, 1, 1, 64 / 127, 64 / 127, 0, 0, 0, 0, 0, 1, 1, 1, 1]);
  }
});

test("player music volume slider scales music cues' effective gain and leaves sound effects unchanged", () => {
  const clients = runtime.clients(audio80, [0], { musicSlider: 0.5 });
  runJourney(clients, { frames: 48, events: [] });
  const cues = clients.clients[0]?.soundLog ?? [];
  expect(cues.map(cue => cue.effectiveVolume)).toEqual([1, 1, 0.5, 64 / 127, 32 / 127, 0, 0, 0, 0, 0, 0.5, 0.5, 0.5, 0.5]);
});

farmTest("[spec #80] emitted Lua32 map records the same sound and stage music events", { timeout: 120_000 }, () => {
  for (const config of ["test/audio80/tsconfig.json", "test/audio80/tsconfig.headless.json"]) expect(report(mapCompiler(join(import.meta.dir, "..", config))())).toBe("");
  const run = Bun.spawnSync([process.env.LUA ?? "lua", join(import.meta.dir, "../build/audio80/headless/headless.lua"), join(import.meta.dir, "../build/audio80/map.lua"), join(import.meta.dir, "../src/natives/warcraft.d.ts")], { stdout: "pipe", stderr: "pipe" });
  expect({ code: run.exitCode, stderr: run.stderr.toString() }).toEqual({ code: 0, stderr: "" });
  expect(run.stdout.toString().trimEnd().split("\n")).toEqual([0, 1].flatMap(slot => AUDIO80.map(row => `p${slot} ${row}`)));
});

export const EXPECTED = [
  "pitch-two-at-0.25=true",
  "kill-when-done-at-0.5=false",
  "stopped-kill-when-done-restarted=false",
  "same-file-playing=0/12",
  "pitch-two-at-0.75=false",
  "fade-stopped-loop-at-1=false",
  "start-while-playing-at-1.25=false",
  "stop-then-start-at-1.25=true",
  "released-handle-started=false",
  "fade-stopped-loop-restarted=true",
];

test("each sound rule's row agrees in two clients", () => {
  const clients = runtime.clients({ install, start });
  const result = runJourney(clients, { frames: 240, events: [] });
  expect(result.divergence).toBeUndefined();
  expect(result.clients.map(client => client.errors)).toEqual([[], []]);
  for (const client of clients.clients) expect(client.files.get(`sounds60-p${client.slot}.txt`)).toEqual(EXPECTED);
});

test("a start on a playing sound is not a cue, and pitch and position are binary32", () => {
  const third = 1 / 3;
  const clients = runtime.clients({ install, start: () => {
    const s = CreateSound(SOUND_PATH, false, true, true, 10, 10, "DefaultEAXON");
    SetSoundDuration(s, 1000);
    SetSoundPitch(s, third);
    SetSoundPosition(s, third, -third, 2 * third);
    StartSound(s);
    StartSound(s);
  } });
  clients.start();
  for (const client of clients.clients) {
    assertSoundCue(client.soundLog, { source: SOUND_PATH, count: 1 });
    const started = client.soundLog.find(cue => cue.event === "start");
    expect([started?.pitch, started?.x, started?.y, started?.z]).toEqual([Math.fround(third), Math.fround(third), Math.fround(-third), Math.fround(2 * third)]);
  }
});

farmTest("the same sound rules pass in emitted 32-bit Lua", { timeout: 120_000 }, () => {
  for (const config of ["test/sounds60/tsconfig.json", "test/sounds60/tsconfig.headless.json"]) expect(report(mapCompiler(join(import.meta.dir, "..", config))())).toBe("");
  const run = Bun.spawnSync([process.env.LUA ?? "lua", join(import.meta.dir, "../build/sounds60/headless/headless.lua"), join(import.meta.dir, "../build/sounds60/map.lua"), join(import.meta.dir, "../src/natives/warcraft.d.ts")], { stdout: "pipe", stderr: "pipe" });
  expect({ code: run.exitCode, stderr: run.stderr.toString() }).toEqual({ code: 0, stderr: "" });
  expect(run.stdout.toString().trimEnd().split("\n")).toEqual([0, 1].flatMap(slot => EXPECTED.map(row => `p${slot} ${row}`)));
});
