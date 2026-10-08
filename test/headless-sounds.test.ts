// wisp#60: the sound rules of wisp:docs/warsmash-notes.md#sound-start-stop-and-channel-limits,
// one row each, in Bun and in the same fixture compiled to 32-bit Lua.
import { afterAll, expect, test } from "bun:test";
import { join } from "node:path";
import { mapCompiler, report } from "../scripts/compiler";
import { installHeadless } from "../scripts/wisp/headless";
import { assertSoundCue } from "../src/headless/client";
import { runJourney } from "../src/headless/journey";
import { install, start } from "./sounds60/main";
import { SOUND_NATIVES, SOUND_PATH } from "./sounds60/cases";

const runtime = installHeadless({ filePrefix: "sounds60", globalPrefixes: ["__sounds60"], natives: SOUND_NATIVES });
afterAll(runtime.restore);

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

test("the same sound rules pass in emitted 32-bit Lua", { timeout: 120_000 }, () => {
  for (const config of ["test/sounds60/tsconfig.json", "test/sounds60/tsconfig.headless.json"]) expect(report(mapCompiler(join(import.meta.dir, "..", config))())).toBe("");
  const run = Bun.spawnSync([process.env.LUA ?? "lua", join(import.meta.dir, "../build/sounds60/headless/headless.lua"), join(import.meta.dir, "../build/sounds60/map.lua"), join(import.meta.dir, "../src/natives/warcraft.d.ts")], { stdout: "pipe", stderr: "pipe" });
  expect({ code: run.exitCode, stderr: run.stderr.toString() }).toEqual({ code: 0, stderr: "" });
  expect(run.stdout.toString().trimEnd().split("\n")).toEqual([0, 1].flatMap(slot => EXPECTED.map(row => `p${slot} ${row}`)));
});
