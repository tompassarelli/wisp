import { expect, test } from "bun:test";
import * as nativeEvents from "../src/game/native/events";
import * as nativeInput from "../src/game/native/input";
import * as nativePlayers from "../src/game/native/players";
import { bindWorld } from "../src/game/native/world";
import { HeadlessClient } from "../src/headless/client";
import { readNativeDeclarations } from "../host/headless/headless";
import { compile, wrap } from "./gameApiCompile";

test("input calls lower to the natives they replaced, byte for byte", () => {
  const lowered = compile(`import { createEvents } from "../../src/game/events";\nimport { addChatEvent, addKeyEvent, addPointerMoveEvent, chatText, enableSelections, enableUserControl, eventKey, eventPointerX, eventPointerY, keyDown, mouseDown, osKey, pointerX, pointerY, setPointer, showCursor, windowFocused } from "../../src/game/input";\n` + wrap(`
  const events = createEvents();
  const space = osKey(32);
  addKeyEvent(events, owner, space, 2, true);
  addPointerMoveEvent(events, owner);
  addChatEvent(events, owner, model, false);
  if (eventKey() === 27 || keyDown(space) || windowFocused() || mouseDown(MOUSE_BUTTON_TYPE_LEFT)) BJDebugMsg(chatText());
  setPointer(pointerX() + eventPointerX(), pointerY() + eventPointerY());
  showCursor(false);
  enableSelections(false, false);
  enableUserControl(true);`));
  const raw = compile(wrap(`
  const events = CreateTrigger();
  const space = ConvertOsKeyType(32);
  BlzTriggerRegisterPlayerKeyEvent(events, owner, space, 2, true);
  TriggerRegisterPlayerEvent(events, owner, EVENT_PLAYER_MOUSE_MOVE);
  TriggerRegisterPlayerChatEvent(events, owner, model, false);
  if (GetHandleId(BlzGetTriggerPlayerKey()) === 27 || BlzIsKeyPressed(space) || BlzIsLocalClientActive() || BlzIsMouseButtonPressed(MOUSE_BUTTON_TYPE_LEFT)) BJDebugMsg(GetEventPlayerChatString());
  BlzSetMousePos(BlzGetMouseScreenPosX() + BlzGetTriggerPlayerMouseX(), BlzGetMouseScreenPosY() + BlzGetTriggerPlayerMouseY());
  BlzEnableCursor(false);
  BlzEnableSelections(false, false);
  EnableUserControl(true);`));
  expect(lowered.diagnostics).toBe("");
  expect(raw.diagnostics).toBe("");
  expect(lowered.lua).toBe(raw.lua);
  expect(lowered.lua).toContain("GetHandleId(BlzGetTriggerPlayerKey())");
  expect(lowered.lua).toContain("ConvertOsKeyType(32)");
});

test("the native backend runs a client's key, chat and pointer events and local reads over its own input, and the emulated natives stay at zero", () => {
  const declarations = readNativeDeclarations();
  const make = (slot: number) => new HeadlessClient({ slot, humans: [0, 1], declarations, filePrefix: "game-api", localNatives: {}, network: [] });
  const [first, second] = [make(0), make(1)];
  const heard: string[] = [];
  bindWorld(first.world);
  const events = nativeEvents.createEvents();
  const space = nativeInput.osKey(32);
  nativeInput.addKeyEvent(events, nativePlayers.player(1), space, 2, true);
  nativeInput.addChatEvent(events, nativePlayers.player(1), "-hi", false);
  nativeInput.addPointerMoveEvent(events, nativePlayers.player(1));
  nativeEvents.onEvents(events, () => {
    heard.push(`${nativeInput.eventKey()}|${nativeInput.chatText()}|${nativeInput.eventPointerX()},${nativeInput.eventPointerY()}|${nativePlayers.playerSlot(nativePlayers.eventPlayer())}`);
  });
  first.keyEvent(1, 32, 2, true);
  first.keyEvent(1, 32, 0, true);
  first.keyEvent(0, 32, 2, true);
  first.chat(1, "say -hi there");
  first.playerMouse(1, { x: 4, y: 5 });
  first.hold(32, 0, true);
  first.mouseScreenX = 640;
  first.mouseScreenY = 360;
  first.heldMouseButtons.add(first.natives.MOUSE_BUTTON_TYPE_LEFT);
  expect(heard).toEqual(["32||0,0|1", "32|say -hi there|0,0|1", "32|say -hi there|4,5|1"]);
  expect([nativeInput.keyDown(space), nativeInput.windowFocused(), nativeInput.pointerX(), nativeInput.pointerY(), nativeInput.mouseDown(first.natives.MOUSE_BUTTON_TYPE_LEFT as never), nativeInput.mouseDown(first.natives.MOUSE_BUTTON_TYPE_RIGHT as never)]).toEqual([true, true, 640, 360, true, false]);
  nativeInput.setPointer(1, 2);
  nativeInput.showCursor(false);
  nativeInput.enableSelections(false, false);
  nativeInput.enableUserControl(true);
  bindWorld(second.world);
  expect([nativeInput.keyDown(space), nativeInput.pointerX(), nativeInput.mouseDown(second.natives.MOUSE_BUTTON_TYPE_LEFT as never)]).toEqual([false, 0, false]);
  bindWorld(undefined);
  expect([...first.emulatedCalls.keys(), ...second.emulatedCalls.keys()]).toEqual([]);
});
