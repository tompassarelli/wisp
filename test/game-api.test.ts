import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import * as native from "../src/game/native/effects";
import * as nativeEvents from "../src/game/native/events";
import * as nativeFrames from "../src/game/native/frames";
import * as nativeSound from "../src/game/native/sound";
import * as nativeText from "../src/game/native/text";
import * as filesApi from "../src/game/native/files";
import * as nativePlayers from "../src/game/native/players";
import * as nativeClock from "../src/game/native/clock";
import { clock, clockConstants } from "../src/game/warcraft/clock";
import * as nativeInput from "../src/game/native/input";
import { input, inputConstants } from "../src/game/warcraft/input";
import * as nativeSync from "../src/game/native/sync";
import * as nativeView from "../src/game/native/view";
import { bindWorld } from "../src/game/native/world";
import { HeadlessClient } from "../src/headless/client";
import { readNativeDeclarations } from "../host/headless/headless";
import { parseTemplate, templateParts } from "../src/game/warcraft/lowering";
import { effects, effectsConstants } from "../src/game/warcraft/effects";
import { events } from "../src/game/warcraft/events";
import { frames, framesConstants } from "../src/game/warcraft/frames";
import { sound, soundConstants } from "../src/game/warcraft/sound";
import { text } from "../src/game/warcraft/text";
import { files } from "../src/game/warcraft/files";
import { players, playersConstants } from "../src/game/warcraft/players";
import { sync } from "../src/game/warcraft/sync";
import { bodies } from "../src/game/warcraft/bodies";
import * as nativeBodies from "../src/game/native/bodies";
import { compile, root, wrap } from "./gameApiCompile";
import { view, viewConstants } from "../src/game/warcraft/view";
import type { SyncMessage } from "../src/headless/clientTypes";


const families = [
  { name: "effects", table: effects, backend: native, constants: effectsConstants },
  { name: "frames", table: frames, backend: nativeFrames, constants: framesConstants },
  { name: "events", table: events, backend: nativeEvents, constants: {} },
  { name: "sound", table: sound, backend: nativeSound, constants: soundConstants },
  { name: "text", table: text, backend: nativeText, constants: {} },
  { name: "files", table: files, backend: filesApi, constants: {} },
  { name: "players", table: players, backend: nativePlayers, constants: playersConstants },
  { name: "sync", table: sync, backend: nativeSync, constants: {} },
  { name: "input", table: input, backend: nativeInput, constants: inputConstants },
  { name: "clock", table: clock, backend: nativeClock, constants: clockConstants },
  { name: "bodies", table: bodies, backend: nativeBodies, constants: {} },
  { name: "view", table: view, backend: nativeView, constants: viewConstants },
] as const;

test.each(families)("every $name lowering row names a declared native with the arity of its Wisp function and an implemented backend call", ({ name, table, backend, constants: families }) => {
  const declarations = readNativeDeclarations();
  const declared = new Map(declarations.functions.map(([native, , parameters]) => [native, parameters] as const));
  const constants = new Set([...declarations.constants, ...declarations.variables].map(([constant]) => constant));
  const dts = readFileSync(join(root, `src/game/${name}.d.ts`), "utf8");
  const exported = [...dts.matchAll(/export declare function (\w+)\(([^)]*)\)/g)].map(match => [match[1]!, (match[2] ?? "").trim() === "" ? 0 : (match[2] ?? "").split(/,(?![^()]*\))/).length] as const);
  expect(exported.map(([fn]) => fn).sort()).toEqual(Object.keys(table).sort());
  expect(Object.keys(backend).filter(key => !(key in families)).sort()).toEqual(Object.keys(table).sort());
  for (const [fn, parameters] of exported) {
    const template = parseTemplate(table[fn] ?? "");
    const parts = templateParts(template);
    for (const call of parts.calls) expect(declared.get(call.native)).toBe(call.args.length);
    for (const global of parts.globals) expect(constants.has(global)).toBe(true);
    expect(parts.arguments).toBe(parameters);
  }
});

test.each(families)("every $name constant is declared, implemented and lowered to a Warcraft global holding the value the native backend gives", ({ name, backend, constants: table }) => {
  const declarations = readNativeDeclarations();
  const globals = new Set(declarations.constants.map(([constant]) => constant));
  const client = new HeadlessClient({ screen: { width: 1920, height: 1080 }, slot: 0, humans: [0], declarations, filePrefix: "game-api", localNatives: {}, network: [] });
  const dts = readFileSync(join(root, `src/game/${name}.d.ts`), "utf8");
  const declared = [...dts.matchAll(/export declare const (\w+): \{([^}]*)\}/g)].map(match => [match[1]!, [...match[2]!.matchAll(/readonly (\w+):/g)].map(member => member[1]!).sort()] as const);
  expect(declared.map(([type]) => type).sort()).toEqual(Object.keys(table).sort());
  for (const [type, members] of declared) {
    const lowering = table[type] ?? {};
    const implemented = (backend as Record<string, Record<string, unknown>>)[type] ?? {};
    expect(Object.keys(lowering).sort()).toEqual(members);
    expect(Object.keys(implemented).sort()).toEqual(members);
    for (const [member, global] of Object.entries(lowering)) {
      expect(globals.has(global)).toBe(true);
      expect(implemented[member]).toBe(client.constants[global]);
    }
  }
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
  const make = (slot: number, network: SyncMessage[]) => new HeadlessClient({ screen: { width: 1920, height: 1080 }, slot, humans: [0, 1], declarations, filePrefix: "game-api", localNatives: {}, network });
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
