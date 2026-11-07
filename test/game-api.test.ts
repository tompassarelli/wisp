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
