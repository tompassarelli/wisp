import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { transpileProject } from "typescript-to-lua";
import { report } from "../host/toolchain/compiler";
import * as native from "../src/game/native/effects";
import * as nativeEvents from "../src/game/native/events";
import * as nativeFrames from "../src/game/native/frames";
import * as nativeSound from "../src/game/native/sound";
import * as nativeText from "../src/game/native/text";
import * as filesApi from "../src/game/native/files";
import * as nativePlayers from "../src/game/native/players";
import * as nativeSync from "../src/game/native/sync";
import * as nativeView from "../src/game/native/view";
import { bindWorld } from "../src/game/native/world";
import { HeadlessClient } from "../src/headless/client";
import { readNativeDeclarations } from "../host/headless/headless";
import { parseTemplate, templateParts } from "../src/game/warcraft/lowering";
import { effects } from "../src/game/warcraft/effects";
import { events } from "../src/game/warcraft/events";
import { frames } from "../src/game/warcraft/frames";
import { sound } from "../src/game/warcraft/sound";
import type { VolumeGroup } from "../src/game/sound";
import { text } from "../src/game/warcraft/text";
import { files } from "../src/game/warcraft/files";
import { players } from "../src/game/warcraft/players";
import { sync } from "../src/game/warcraft/sync";
import { view } from "../src/game/warcraft/view";
import type { CameraField } from "../src/game/view";
import type { SyncMessage } from "../src/headless/clientTypes";

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
  { name: "text", table: text, backend: nativeText },
  { name: "files", table: files, backend: filesApi },
  { name: "players", table: players, backend: nativePlayers },
  { name: "sync", table: sync, backend: nativeSync },
] as const;

test.each(families)("every $name lowering row names a declared native with the arity of its Wisp function and an implemented backend call", ({ name, table, backend }) => {
  const declarations = readNativeDeclarations();
  const declared = new Map(declarations.functions.map(([native, , parameters]) => [native, parameters] as const));
  const constants = new Set(declarations.constants.map(([constant]) => constant));
  const dts = readFileSync(join(root, `src/game/${name}.d.ts`), "utf8");
  const exported = [...dts.matchAll(/export declare function (\w+)\(([^)]*)\)/g)].map(match => [match[1]!, (match[2] ?? "").trim() === "" ? 0 : (match[2] ?? "").split(/,(?![^()]*\))/).length] as const);
  expect(exported.map(([fn]) => fn).sort()).toEqual(Object.keys(table).sort());
  expect(Object.keys(backend).sort()).toEqual(Object.keys(table).sort());
  for (const [fn, parameters] of exported) {
    const template = parseTemplate(table[fn] ?? "");
    const parts = templateParts(template);
    for (const call of parts.calls) expect(declared.get(call.native)).toBe(call.args.length);
    for (const global of parts.globals) expect(constants.has(global)).toBe(true);
    expect(parts.arguments).toBe(parameters);
  }
});

test("the text family lowers to the native calls it replaced, byte for byte", () => {
  const lowered = compile(`import { formatInt, formatReal, formatRealWidth, parseInt, parseReal, textLength, toReal, truncate } from "../../src/game/text";\n` + wrap(`
  const total = truncate(toReal(parseInt(model)) * parseReal("1.5"));
  const label = formatInt(total) + formatReal(1.25) + formatRealWidth(2.5, 6, 2);
  const size = textLength(label);`));
  const raw = compile(wrap(`
  const total = R2I(I2R(S2I(model)) * S2R("1.5"));
  const label = I2S(total) + R2S(1.25) + R2SW(2.5, 6, 2);
  const size = StringLength(label);`));
  expect(lowered.diagnostics).toBe("");
  expect(raw.diagnostics).toBe("");
  expect(lowered.lua).toBe(raw.lua);
  expect(lowered.lua).toContain("R2SW(0x5p-1, 6, 2)");
});

test("the text native backend logs its row's native in a headless client and works with no world bound", () => {
  expect(nativeText.formatReal(0.0625)).toBe("0.063");
  const client = new HeadlessClient({ slot: 0, humans: [0], declarations: readNativeDeclarations(), filePrefix: "game-api", localNatives: {}, network: [] });
  bindWorld(client.world);
  nativeText.formatInt(7);
  nativeText.formatRealWidth(2.5, 6, 2);
  nativeText.parseInt("12");
  nativeText.textLength("ab");
  bindWorld(undefined);
  expect(client.log.map(call => call.name)).toEqual(["I2S", "R2SW", "S2I", "StringLength"]);
  expect([...client.emulatedCalls.keys()]).toEqual([]);
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

test("the files family lowers one to one and its native backend keeps a 300-byte line whole", () => {
  const lowered = compile(`import { clearFileLines, startFile, addFileLine, endFile, preloadAsset } from "../../src/game/files";\n` + wrap(`
  clearFileLines();
  startFile();
  addFileLine(model);
  preloadAsset(model);
  endFile("out.txt");`));
  const raw = compile(wrap(`
  PreloadGenClear();
  PreloadGenStart();
  Preload(model);
  Preload(model);
  PreloadGenEnd("out.txt");`));
  expect(lowered.diagnostics).toBe("");
  expect(lowered.lua).toBe(raw.lua);
  const line = "x".repeat(300);
  const written: [string, readonly string[]][] = [];
  const client = new HeadlessClient({ slot: 0, humans: [0], declarations: readNativeDeclarations(), filePrefix: "game-api", localNatives: {}, network: [],
    files: { written: (name, lines) => { written.push([name, lines]); }, read: () => undefined } });
  bindWorld(client.world);
  filesApi.clearFileLines();
  filesApi.startFile();
  filesApi.addFileLine(line);
  filesApi.preloadAsset("model.mdx");
  filesApi.endFile("out.txt");
  bindWorld(undefined);
  expect(client.files.get("out.txt")?.[0]?.length).toBe(300);
  expect(written).toEqual([["out.txt", [line]]]);
  expect(client.log.map(call => call.name)).toEqual(["PreloadGenClear", "PreloadGenStart", "Preload", "Preload", "PreloadGenEnd"]);
  expect([...client.emulatedCalls.keys()]).toEqual([]);
  const natives = client.natives as Record<string, (...args: unknown[]) => unknown>;
  natives.PreloadGenClear?.();
  natives.Preload?.(line);
  natives.PreloadGenEnd?.("cut.txt");
  expect(client.files.get("cut.txt")?.[0]?.length).toBe(259);
  expect(Object.fromEntries(client.emulatedCalls)).toEqual({ PreloadGenClear: 1, Preload: 1, PreloadGenEnd: 1 });
});

test("player calls lower to the natives they replaced, with a nested native and a global argument, byte for byte", () => {
  const lowered = compile(`import { createEvents } from "../../src/game/events";\nimport { addLeaveEvent, eventPlayer, localPlayer, player, playerControl, playerName, playerSlot, playerSlotState, setPlayerColor } from "../../src/game/players";\n` + `export function run(slot: number): void {
  const leave = createEvents();
  const who = player(slot);
  addLeaveEvent(leave, who);
  setPlayerColor(who, slot);
  if (eventPlayer() === localPlayer() && playerControl(who) === MAP_CONTROL_USER && playerSlotState(who) === PLAYER_SLOT_STATE_PLAYING) BJDebugMsg(playerName(who) + playerSlot(who));
}\n`);
  const raw = compile(`export function run(slot: number): void {
  const leave = CreateTrigger();
  const who = Player(slot);
  TriggerRegisterPlayerEvent(leave, who, EVENT_PLAYER_LEAVE);
  SetPlayerColor(who, ConvertPlayerColor(slot));
  if (GetTriggerPlayer() === GetLocalPlayer() && GetPlayerController(who) === MAP_CONTROL_USER && GetPlayerSlotState(who) === PLAYER_SLOT_STATE_PLAYING) BJDebugMsg(GetPlayerName(who) + GetPlayerId(who));
}\n`);
  expect(lowered.diagnostics).toBe("");
  expect(raw.diagnostics).toBe("");
  expect(lowered.lua).toBe(raw.lua);
  expect(lowered.lua).toContain("ConvertPlayerColor(slot)");
  expect(lowered.lua).toContain("TriggerRegisterPlayerEvent(leave, who, EVENT_PLAYER_LEAVE)");
});

test("the template grammar takes nested natives and globals and refuses a reused argument", () => {
  expect(parseTemplate("SetPlayerColor($1, ConvertPlayerColor($2))")).toEqual({ native: "SetPlayerColor", args: [{ arg: 1 }, { call: { native: "ConvertPlayerColor", args: [{ arg: 2 }] } }] });
  expect(parseTemplate("TriggerRegisterPlayerEvent($1, $2, EVENT_PLAYER_LEAVE)").args[2]).toEqual({ global: "EVENT_PLAYER_LEAVE" });
  expect(() => parseTemplate("Native($1, Inner($1))")).toThrow("reuses or reorders $1");
  expect(() => parseTemplate("Native($1")).toThrow("lowering template");
});

test("the native backend answers from each client's slots", () => {
  const declarations = readNativeDeclarations();
  const make = (slot: number) => new HeadlessClient({ slot, humans: [0, 1, 3], playerNames: { 1: "Ada" }, declarations, filePrefix: "game-api", localNatives: { GetLocalPlayer: "local" }, network: [] });
  const [first, second] = [make(0), make(1)];
  bindWorld(first.world);
  const events = nativeEvents.createEvents();
  nativeEvents.onEvents(events, () => undefined);
  nativePlayers.addLeaveEvent(events, nativePlayers.player(3));
  expect(nativePlayers.playerSlot(nativePlayers.localPlayer())).toBe(0);
  expect(nativePlayers.playerControl(nativePlayers.player(3))).toBe(first.natives.MAP_CONTROL_USER);
  expect(nativePlayers.playerControl(nativePlayers.player(2))).toBe(first.natives.MAP_CONTROL_NONE);
  expect(nativePlayers.playerSlotState(nativePlayers.player(1))).toBe(first.natives.PLAYER_SLOT_STATE_PLAYING);
  expect(nativePlayers.playerSlotState(nativePlayers.player(2))).toBe(first.natives.PLAYER_SLOT_STATE_EMPTY);
  expect(nativePlayers.playerName(nativePlayers.player(1))).toBe("Ada");
  expect(nativePlayers.playerName(nativePlayers.player(2))).toBe("Player 3");
  nativePlayers.setPlayerColor(nativePlayers.player(1), 4);
  bindWorld(second.world);
  expect(nativePlayers.playerSlot(nativePlayers.localPlayer())).toBe(1);
  bindWorld(undefined);
  expect(first.players.color(1)).toBe(4);
  expect(second.players.color(1)).toBeUndefined();
  expect(first.log.map(call => call.name).slice(0, 7)).toEqual(["CreateTrigger", "TriggerAddAction", "Player", "TriggerRegisterPlayerEvent", "GetPlayerId", "Player", "GetPlayerController"]);
  expect([...first.emulatedCalls.keys(), ...second.emulatedCalls.keys()]).toEqual([]);
});

test("view calls compile to the native calls they replaced, byte for byte", () => {
  const lowered = compile(`import { setCameraField, cameraField, cameraTargetX, setTerrainFog, setSkyModel, setFilterStartColor, showFilter, resetTerrainFog } from "../../src/game/view";\n` + wrap(`
  setCameraField(CAMERA_FIELD_ZOFFSET, 12.5, 0.0);
  const distance = cameraField(CAMERA_FIELD_TARGET_DISTANCE) + cameraTargetX();
  setTerrainFog(0, 100.0, 200.0, 0.0, 0.25, 0.5, 0.75);
  setSkyModel(model);
  setFilterStartColor(distance, 1, 2, 3);
  showFilter(true);
  resetTerrainFog();`));
  const raw = compile(wrap(`
  SetCameraField(CAMERA_FIELD_ZOFFSET, 12.5, 0.0);
  const distance = GetCameraField(CAMERA_FIELD_TARGET_DISTANCE) + GetCameraTargetPositionX();
  SetTerrainFogEx(0, 100.0, 200.0, 0.0, 0.25, 0.5, 0.75);
  SetSkyModel(model);
  SetCineFilterStartColor(distance, 1, 2, 3);
  DisplayCineFilter(true);
  ResetTerrainFog();`));
  expect(lowered.diagnostics).toBe("");
  expect(raw.diagnostics).toBe("");
  expect(lowered.lua).toBe(raw.lua);
  expect(lowered.lua).toContain("GetCameraTargetPositionX()");
});

test("every view lowering row names a declared native with the arity of its Wisp function and an implemented backend call", () => {
  const declared = new Map(readNativeDeclarations().functions.map(([name, , parameters]) => [name, parameters] as const));
  const dts = readFileSync(join(root, "src/game/view.d.ts"), "utf8");
  const exported = [...dts.matchAll(/export declare function (\w+)\(([^)]*)\)/g)].map(match => [match[1]!, (match[2] ?? "").trim() === "" ? 0 : (match[2] ?? "").split(",").length] as const);
  expect(exported.map(([name]) => name).sort()).toEqual(Object.keys(view).sort());
  expect(Object.keys(nativeView).sort()).toEqual(Object.keys(view).sort());
  for (const [name, parameters] of exported) {
    const template = parseTemplate(view[name] ?? "");
    expect(declared.get(template.native)).toBe(template.args.length);
    expect(template.args.filter(part => "arg" in part).length).toBe(parameters);
  }
});

test("the view backend logs the native call of its lowering row, keeps each client's view apart and shares it with the client's Warcraft-named natives", () => {
  const declarations = readNativeDeclarations();
  const make = (slot: number) => new HeadlessClient({ slot, humans: [0, 1], declarations, filePrefix: "game-api", localNatives: { GetCameraField: "local", GetCameraTargetPositionX: "local", GetCameraTargetPositionY: "local" }, network: [] });
  const [first, second] = [make(0), make(1)];
  const field = first.natives.CAMERA_FIELD_ZOFFSET as CameraField;
  bindWorld(first.world);
  nativeView.setCameraField(field, 12.5, 0);
  nativeView.setCameraPosition(3, 4);
  nativeView.setTerrainFog(0, 100, 200, 0.5, 0.25, 0.5, 0.75);
  nativeView.setSkyModel("sky.mdx");
  nativeView.showSky(false);
  nativeView.setFilterEndColor(1, 2, 3, 4);
  nativeView.showFilter(true);
  const read = [nativeView.cameraField(field), nativeView.cameraTargetX(), nativeView.cameraTargetY()];
  nativeView.setCameraBounds(0, 0, 0, 0, 0, 0, 0, 0);
  bindWorld(second.world);
  nativeView.setCameraPosition(9, 9);
  bindWorld(undefined);
  expect(read).toEqual([12.5, 3, 4]);
  expect(first.cameraPose()).toEqual({ x: 3, y: 4, fields: { CAMERA_FIELD_ZOFFSET: 12.5 } });
  expect(second.cameraPose().x).toBe(9);
  expect(first.cineFilterPose()?.color).toEqual([1, 2, 3, 4]);
  expect(first.scenery.environment.sky).toBe("sky.mdx");
  expect(first.scenery.environment.skyVisible).toBe(false);
  expect(first.scenery.fog).toEqual({ style: 0, zStart: 100, zEnd: 200, density: 0.5, color: [0.25, 0.5, 0.75] });
  expect(first.log.map(call => call.name)).toEqual(["SetCameraField", "SetCameraPosition", "SetTerrainFogEx", "SetSkyModel", "BlzShowSkyBox", "SetCineFilterEndColor", "DisplayCineFilter", "SetCameraBounds"]);
  expect([...first.emulatedCalls.keys(), ...second.emulatedCalls.keys()]).toEqual([]);
  const natives = first.natives as Record<string, (...args: unknown[]) => unknown>;
  expect(natives.GetCameraField?.(field)).toBe(12.5);
  natives.SetCameraPosition?.(5, 6);
  expect(first.cameraPose().y).toBe(6);
  expect(Object.fromEntries(first.emulatedCalls)).toEqual({ GetCameraField: 1, SetCameraPosition: 1 });
});

test("sync calls lower to the natives they replaced, byte for byte", () => {
  const lowered = compile(`import { createEvents } from "../../src/game/events";\nimport { addSyncEvent, sendSync, syncData, syncPrefix } from "../../src/game/sync";\n` + wrap(`
  const events = createEvents();
  addSyncEvent(events, owner, "pre");
  if (!sendSync(syncPrefix(), syncData() + model)) BJDebugMsg("lost");`));
  const raw = compile(wrap(`
  const events = CreateTrigger();
  BlzTriggerRegisterPlayerSyncEvent(events, owner, "pre", false);
  if (!BlzSendSyncData(BlzGetTriggerSyncPrefix(), BlzGetTriggerSyncData() + model)) BJDebugMsg("lost");`));
  expect(lowered.diagnostics).toBe("");
  expect(raw.diagnostics).toBe("");
  expect(lowered.lua).toBe(raw.lua);
  expect(lowered.lua).toContain('BlzTriggerRegisterPlayerSyncEvent(events, owner, "pre", false)');
});

test("the native backend delivers a client's messages to its registrations in order and refuses a 256-character one", () => {
  const declarations = readNativeDeclarations();
  const make = (slot: number, network: SyncMessage[]) => new HeadlessClient({ slot, humans: [0, 1], declarations, filePrefix: "game-api", localNatives: {}, network });
  const [outbox0, outbox1]: SyncMessage[][] = [[], []];
  const [first, second] = [make(0, outbox0), make(1, outbox1)];
  const heard: string[] = [];
  bindWorld(first.world);
  const events = nativeEvents.createEvents();
  nativeSync.addSyncEvent(events, nativePlayers.player(1), "ab");
  nativeEvents.onEvents(events, () => { heard.push(`${nativeSync.syncPrefix()}:${nativeSync.syncData()}:${nativePlayers.playerSlot(nativePlayers.eventPlayer())}`); });
  expect(nativeSync.sendSync("ab", "x".repeat(255))).toBe(true);
  expect(() => nativeSync.sendSync("ab", "x".repeat(256))).toThrow("at most 255 characters");
  nativeSync.sendSync("ab", "second");
  bindWorld(second.world);
  nativeSync.sendSync("ab", "from one");
  nativeSync.sendSync("ab", "and again");
  bindWorld(undefined);
  expect(outbox0.map(message => [message.sender, message.data.length])).toEqual([[0, 255], [0, 6]]);
  expect(outbox1.map(message => [message.sender, message.data])).toEqual([[1, "from one"], [1, "and again"]]);
  bindWorld(first.world);
  for (const message of [...outbox1, ...outbox0]) first.deliverSync(message);
  bindWorld(undefined);
  expect(heard).toEqual(["ab:from one:1", "ab:and again:1"]);
  expect(first.log.map(call => call.name).filter(name => name.startsWith("Blz"))).toEqual(["BlzTriggerRegisterPlayerSyncEvent", "BlzSendSyncData", "BlzSendSyncData", "BlzGetTriggerSyncPrefix", "BlzGetTriggerSyncData", "BlzGetTriggerSyncPrefix", "BlzGetTriggerSyncData"]);
  expect([...first.emulatedCalls.keys(), ...second.emulatedCalls.keys()]).toEqual([]);
});
