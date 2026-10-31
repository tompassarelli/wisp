import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { transpileProject } from "typescript-to-lua";
import { report } from "../host/toolchain/compiler";
import * as native from "../src/game/native/effects";
import * as nativeEvents from "../src/game/native/events";
import * as nativeFrames from "../src/game/native/frames";
import * as nativeSound from "../src/game/native/sound";
import { bindWorld } from "../src/game/native/world";
import { HeadlessClient } from "../src/headless/client";
import { readNativeDeclarations } from "../host/headless/headless";
import { parseTemplate } from "../src/game/warcraft/lowering";
import { effects } from "../src/game/warcraft/effects";
import { events } from "../src/game/warcraft/events";
import { frames } from "../src/game/warcraft/frames";
import { sound } from "../src/game/warcraft/sound";
import type { VolumeGroup } from "../src/game/sound";

const root = join(import.meta.dir, "..");

function compile(source: string): { readonly diagnostics: string; readonly lua: string } {
  mkdirSync(join(root, "build"), { recursive: true });
  const directory = mkdtempSync(join(root, "build/game-api-"));
  try {
    writeFileSync(join(directory, "main.ts"), source);
    const config = join(directory, "tsconfig.json");
    writeFileSync(config, JSON.stringify({
      compilerOptions: { target: "ESNext", module: "ESNext", moduleResolution: "Bundler", strict: true, types: [], skipLibCheck: true, rootDir: "../..", outDir: "out" },
      files: ["main.ts", "../../src/natives/warcraft.d.ts"],
      tstl: { luaTarget: "5.3", luaBundle: "map.lua", luaBundleEntry: "main.ts", noImplicitSelf: true, noHeader: true,
        luaPlugins: [{ name: "../../plugins/warcraft-numbers.ts" }, { name: "../../plugins/game-api.ts" }] },
    }));
    const result = transpileProject(config);
    const diagnostics = report(result.diagnostics);
    return { diagnostics, lua: diagnostics === "" ? readFileSync(join(directory, "out/map.lua"), "utf8").replaceAll(basename(directory), "fixture") : "" };
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

const wrap = (body: string) => `export function run(model: string, owner: player): void {\n${body}\n}\n`;

test("a lowered call compiles to the native call it replaced, byte for byte", () => {
  const lowered = compile(`import { createEffect, setEffectScale, setEffectTeamColor, createBeam, destroyBeam } from "../../src/game/effects";\n` + wrap(`
  const effect = createEffect(model, 1.5, 2);
  setEffectScale(effect, 2.0);
  setEffectTeamColor(effect, owner);
  const beam = createBeam("LEAS", 0, 0, 1, 2, 3, 4);
  destroyBeam(beam);`));
  const raw = compile(wrap(`
  const effect = AddSpecialEffect(model, 1.5, 2);
  BlzSetSpecialEffectScale(effect, 2.0);
  BlzSetSpecialEffectColorByPlayer(effect, owner);
  const beam = AddLightningEx("LEAS", false, 0, 0, 1, 2, 3, 4);
  DestroyLightning(beam);`));
  expect(lowered.diagnostics).toBe("");
  expect(raw.diagnostics).toBe("");
  expect(lowered.lua).toBe(raw.lua);
  expect(lowered.lua).toContain("BlzSetSpecialEffectScale(effect, 2.0)");
  expect(lowered.lua).not.toContain("effects");
});

test("an API function used as a value is rejected, since Lua has no function to pass", () => {
  const { diagnostics } = compile(`import { setEffectScale } from "../../src/game/effects";\n` + wrap(`  const apply = setEffectScale;\n  void apply;`));
  expect(diagnostics).toContain("setEffectScale");
  expect(diagnostics).toContain("9310");
});

const families = [
  { name: "effects", table: effects, backend: native },
  { name: "frames", table: frames, backend: nativeFrames },
  { name: "events", table: events, backend: nativeEvents },
  { name: "sound", table: sound, backend: nativeSound },
] as const;

test.each(families)("every $name lowering row names a declared native with the arity of its Wisp function and an implemented backend call", ({ name, table, backend }) => {
  const declared = new Map(readNativeDeclarations().functions.map(([native, , parameters]) => [native, parameters] as const));
  const dts = readFileSync(join(root, `src/game/${name}.d.ts`), "utf8");
  const exported = [...dts.matchAll(/export declare function (\w+)\(([^)]*)\)/g)].map(match => [match[1]!, (match[2] ?? "").trim() === "" ? 0 : (match[2] ?? "").split(/,(?![^()]*\))/).length] as const);
  expect(exported.map(([fn]) => fn).sort()).toEqual(Object.keys(table).sort());
  expect(Object.keys(backend).sort()).toEqual(Object.keys(table).sort());
  for (const [fn, parameters] of exported) {
    const template = parseTemplate(table[fn] ?? "");
    expect(declared.get(template.native)).toBe(template.args.length);
    expect(template.args.filter(part => "arg" in part).length).toBe(parameters);
  }
});

test("the native backend logs the native call of its lowering row and keeps each client's effects apart", () => {
  const declarations = readNativeDeclarations();
  const make = (slot: number) => new HeadlessClient({ slot, humans: [0, 1], declarations, filePrefix: "game-api", localNatives: { BlzGetLocalSpecialEffectX: "local" }, network: [] });
  const [first, second] = [make(0), make(1)];
  bindWorld(first.world);
  const a = native.createEffect("a.mdx", 1, 2);
  native.setEffectScale(a, 2);
  native.effectX(a);
  bindWorld(second.world);
  native.createEffect("b.mdx", 3, 4);
  native.createEffect("c.mdx", 5, 6);
  bindWorld(undefined);
  expect(first.effectPoses().map(pose => pose.model)).toEqual(["a.mdx"]);
  expect(second.effectPoses().map(pose => pose.model)).toEqual(["b.mdx", "c.mdx"]);
  expect(first.log.map(call => call.name)).toEqual(["AddSpecialEffect", "BlzSetSpecialEffectScale"]);
  expect(second.log.map(call => call.name)).toEqual(["AddSpecialEffect", "AddSpecialEffect"]);
  expect(first.effectPoses()[0]?.scale).toBe(2);
  expect([...first.emulatedCalls.keys(), ...second.emulatedCalls.keys()]).toEqual([]);
  const natives = first.natives as Record<string, (...args: unknown[]) => unknown>;
  natives.BlzSetSpecialEffectScale?.(first.effectPoses()[0]?.handle, 3);
  natives.BlzGetLocalSpecialEffectX?.(first.effectPoses()[0]?.handle);
  expect(Object.fromEntries(first.emulatedCalls)).toEqual({ BlzSetSpecialEffectScale: 1, BlzGetLocalSpecialEffectX: 1 });
});

test("the native backend refuses to run with no world bound", () => {
  expect(() => native.createEffect("x.mdx", 0, 0)).toThrow("no world bound");
});

test("frame and event calls lower to the natives they replaced, byte for byte", () => {
  const lowered = compile(`import { createEvents, onEvents } from "../../src/game/events";\nimport { addFrameEvent, createFrameByType, frameColor, originFrame, setFramePoint, setFrameText, setFrameVisible } from "../../src/game/frames";\n` + `export function run(): void {
  const root = originFrame(ORIGIN_FRAME_GAME_UI, 0);
  const box = createFrameByType("EDITBOX", "Box", root, "", 0);
  setFramePoint(box, FRAMEPOINT_TOPLEFT, root, FRAMEPOINT_TOPLEFT, 0.5, -0.25);
  setFrameText(box, "hi");
  setFrameVisible(box, frameColor(255, 1, 2, 3) > 0);
  const events = createEvents();
  addFrameEvent(events, box, FRAMEEVENT_EDITBOX_ENTER);
  onEvents(events, () => setFrameText(box, ""));
}\n`);
  const raw = compile(`export function run(): void {
  const root = BlzGetOriginFrame(ORIGIN_FRAME_GAME_UI, 0);
  const box = BlzCreateFrameByType("EDITBOX", "Box", root, "", 0);
  BlzFrameSetPoint(box, FRAMEPOINT_TOPLEFT, root, FRAMEPOINT_TOPLEFT, 0.5, -0.25);
  BlzFrameSetText(box, "hi");
  BlzFrameSetVisible(box, BlzConvertColor(255, 1, 2, 3) > 0);
  const events = CreateTrigger();
  BlzTriggerRegisterFrameEvent(events, box, FRAMEEVENT_EDITBOX_ENTER);
  TriggerAddAction(events, () => BlzFrameSetText(box, ""));
}\n`);
  expect(lowered.diagnostics).toBe("");
  expect(raw.diagnostics).toBe("");
  expect(lowered.lua).toBe(raw.lua);
  expect(lowered.lua).toContain("BlzTriggerRegisterFrameEvent(events, box, FRAMEEVENT_EDITBOX_ENTER)");
});

test("the native backend runs frames, events and the quest log in the bound world and refuses a second registration of one frame event", () => {
  const declarations = readNativeDeclarations();
  const make = (slot: number) => new HeadlessClient({ slot, humans: [0, 1], declarations, filePrefix: "game-api", localNatives: { BlzFrameGetText: "local" }, network: [] });
  const [first, second] = [make(0), make(1)];
  const click = first.natives.FRAMEEVENT_CONTROL_CLICK;
  bindWorld(first.world);
  const events = nativeEvents.createEvents();
  const button = nativeFrames.createFrameByType("BUTTON", "Go", nativeFrames.originFrame(first.natives.ORIGIN_FRAME_GAME_UI as never, 0), "", 0);
  nativeFrames.setFrameText(button, "go");
  nativeFrames.addFrameEvent(events, button, click as never);
  expect(() => nativeFrames.addFrameEvent(events, button, click as never)).toThrow("already registers");
  let clicked = 0;
  nativeEvents.onEvents(events, () => { clicked++; });
  nativeFrames.frameText(button);
  const quest = nativeFrames.createQuest();
  nativeFrames.setQuestTitle(quest, "Controls");
  nativeFrames.displayText(0 as never, 0, 0, "hello");
  nativeFrames.displayText(1 as never, 0, 0, "not mine");
  bindWorld(second.world);
  nativeFrames.createFrameByType("TEXT", "Other", nativeFrames.originFrame(second.natives.ORIGIN_FRAME_GAME_UI as never, 0), "", 0);
  bindWorld(undefined);
  first.frameEvent(0, (button as unknown as { id: number }).id, click);
  expect(clicked).toBe(1);
  expect(first.frames.snapshot().filter(frame => frame.name !== "").map(frame => frame.name)).toEqual(["Go"]);
  expect(second.frames.snapshot().filter(frame => frame.name !== "").map(frame => frame.name)).toEqual(["Other"]);
  expect(first.quests.entries().map(entry => entry.title)).toEqual(["Controls"]);
  expect(first.messages).toEqual(["hello"]);
  expect(first.log.map(call => call.name).filter(name => name !== "BlzTriggerRegisterFrameEvent")).toEqual(["CreateTrigger", "BlzGetOriginFrame", "BlzCreateFrameByType", "BlzFrameSetText", "TriggerAddAction", "CreateQuest", "QuestSetTitle", "DisplayTextToPlayer", "DisplayTextToPlayer"]);
  expect([...first.emulatedCalls.keys(), ...second.emulatedCalls.keys()]).toEqual([]);
});

test("a lowered sound call compiles to the native call it replaced, byte for byte", () => {
  const lowered = compile(`import { createSound, playSound, setSoundPosition, stopSound, playTheme, endTheme } from "../../src/game/sound";\n` + wrap(`
  const cue = createSound(model, false, true, true, 10, 10, "DefaultEAXON");
  setSoundPosition(cue, 1.5, 2, 3);
  stopSound(cue, false, true);
  playSound(cue);
  playTheme(model);
  endTheme();`));
  const raw = compile(wrap(`
  const cue = CreateSound(model, false, true, true, 10, 10, "DefaultEAXON");
  SetSoundPosition(cue, 1.5, 2, 3);
  StopSound(cue, false, true);
  StartSound(cue);
  PlayThematicMusic(model);
  EndThematicMusic();`));
  expect(lowered.diagnostics).toBe("");
  expect(raw.diagnostics).toBe("");
  expect(lowered.lua).toBe(raw.lua);
  expect(lowered.lua).toContain("EndThematicMusic()");
});

test("the native backend plays sounds through the bound world's cue log and logs the native call of each row", () => {
  const declarations = readNativeDeclarations();
  const make = (slot: number) => new HeadlessClient({ slot, humans: [0, 1], declarations, filePrefix: "game-api", localNatives: {}, network: [] });
  const [first, second] = [make(0), make(1)];
  bindWorld(first.world);
  const cue = nativeSound.soundFromLabel("Defend", false, true, true, 10, 10);
  nativeSound.setSoundDuration(cue, nativeSound.soundFileDuration("Sound\\Defend.wav") + 400);
  nativeSound.setSoundPosition(cue, 1, 2, 3);
  nativeSound.setSoundDistances(cue, 600, 3500);
  nativeSound.playSound(cue);
  nativeSound.stopSound(cue, false, false);
  nativeSound.playMusic("a.mp3");
  nativeSound.playTheme("b.mp3");
  nativeSound.setVolumeGroup({} as VolumeGroup, 0);
  bindWorld(second.world);
  nativeSound.playSound(nativeSound.createSound("c.wav", true, false, false, 10, 10, "DefaultEAXON"));
  bindWorld(undefined);
  expect(first.soundLog.map(cue => [cue.event, cue.kind, cue.label ?? cue.source, cue.x, cue.y, cue.z])).toEqual([
    ["create", "sound", "Defend", 0, 0, 0], ["start", "sound", "Defend", 1, 2, 3], ["stop", "sound", "Defend", 1, 2, 3],
    ["start", "music", "a.mp3", 0, 0, 0], ["stop", "music", "a.mp3", 0, 0, 0], ["start", "music", "b.mp3", 0, 0, 0],
  ]);
  expect(second.soundLog.map(cue => cue.event)).toEqual(["create", "start"]);
  expect(first.log.map(call => call.name)).toEqual(["CreateSoundFromLabel", "GetSoundFileDuration", "SetSoundDuration", "SetSoundPosition", "SetSoundDistances", "StartSound", "StopSound", "PlayMusic", "PlayThematicMusic", "VolumeGroupSetVolume"]);
  expect([...first.emulatedCalls.keys(), ...second.emulatedCalls.keys()]).toEqual([]);
});
