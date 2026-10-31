import type { Events } from "../events";
import type { MouseButton, OsKey } from "../input";
import type { Player } from "../players";
import { asHandle, asNumber, fromValue } from "./types";
import { boundWorld } from "./world";

export function osKey(code: number): OsKey {
  boundWorld().log?.("ConvertOsKeyType", [code]);
  return fromValue<OsKey>(code);
}

export function addKeyEvent(events: Events, player: Player, key: OsKey, modifiers: number, down: boolean): void {
  const world = boundWorld();
  world.log?.("BlzTriggerRegisterPlayerKeyEvent", [events, player, key, modifiers, down]);
  world.events.registerKey(asHandle(events), asNumber(player), asNumber(key), modifiers, down);
}

export function eventKey(): number {
  const world = boundWorld();
  world.log?.("BlzGetTriggerPlayerKey", []);
  const key = world.events.triggerKey();
  world.log?.("GetHandleId", [key]);
  return key;
}

export function keyDown(key: OsKey): boolean {
  const world = boundWorld();
  world.log?.("BlzIsKeyPressed", [key]);
  return world.input.keyHeld(asNumber(key));
}

export function windowFocused(): boolean {
  const world = boundWorld();
  world.log?.("BlzIsLocalClientActive", []);
  return world.input.focused();
}

export function pointerX(): number {
  const world = boundWorld();
  world.log?.("BlzGetMouseScreenPosX", []);
  return world.input.pointerX;
}

export function pointerY(): number {
  const world = boundWorld();
  world.log?.("BlzGetMouseScreenPosY", []);
  return world.input.pointerY;
}

export function eventPointerX(): number {
  const world = boundWorld();
  world.log?.("BlzGetTriggerPlayerMouseX", []);
  return world.events.triggerMouseX();
}

export function eventPointerY(): number {
  const world = boundWorld();
  world.log?.("BlzGetTriggerPlayerMouseY", []);
  return world.events.triggerMouseY();
}

export function mouseDown(button: MouseButton): boolean {
  const world = boundWorld();
  world.log?.("BlzIsMouseButtonPressed", [button]);
  return world.input.mouseButtonHeld(button);
}

export function setPointer(x: number, y: number): void {
  boundWorld().log?.("BlzSetMousePos", [x, y]);
}

export function showCursor(shown: boolean): void {
  boundWorld().log?.("BlzEnableCursor", [shown]);
}

export function addChatEvent(events: Events, player: Player, text: string, exact: boolean): void {
  const world = boundWorld();
  world.log?.("TriggerRegisterPlayerChatEvent", [events, player, text, exact]);
  world.events.registerChat(asHandle(events), asNumber(player), text, exact);
}

export function chatText(): string {
  const world = boundWorld();
  world.log?.("GetEventPlayerChatString", []);
  return world.events.triggerChat();
}

export function addPointerMoveEvent(events: Events, player: Player): void {
  const world = boundWorld();
  world.log?.("TriggerRegisterPlayerEvent", [events, player, "EVENT_PLAYER_MOUSE_MOVE"]);
  world.events.registerMouseMove(asHandle(events), asNumber(player));
}

export function enableSelections(selection: boolean, only: boolean): void {
  boundWorld().log?.("BlzEnableSelections", [selection, only]);
}

export function enableUserControl(enabled: boolean): void {
  boundWorld().log?.("EnableUserControl", [enabled]);
}
