import type { HeadlessClient } from "./client";
import type { Frame } from "./frames";
import { f32 } from "../sim/f32";

const UI_WIDTH = f32(0.8), UI_HEIGHT = f32(0.6);

export function point(client: HeadlessClient, x: number, y: number, left: boolean | undefined): void {
  client.mouseScreenX = x;
  client.mouseScreenY = y;
  if (left === true) client.heldMouseButtons.add(client.natives.MOUSE_BUTTON_TYPE_LEFT);
  else if (left === false) client.heldMouseButtons.delete(client.natives.MOUSE_BUTTON_TYPE_LEFT);
}

export const POINTER_LEFT = 1, POINTER_RIGHT = 2;
const POINTER_MIDDLE = 4;

/** What a window read of the mouse at one sample: the cursor in physical pixels from its top-left, the window's size, and the buttons (`POINTER_*` bits) held now and pressed or released since the sample before. */
export interface PointerReading {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly inside: boolean;
  readonly held: number;
  readonly pressed: number;
  readonly released: number;
}

/** The cursor on Warcraft's 0.8 by 0.6 UI screen, Y up: the window draws the frames across its whole client area (`ui_area` in the window's draw.rs), so the cursor maps by fractions of the window. */
export function uiPoint(reading: Pick<PointerReading, "x" | "y" | "width" | "height">): { readonly x: number; readonly y: number } {
  return { x: UI_WIDTH * reading.x / Math.max(1, reading.width), y: UI_HEIGHT - UI_HEIGHT * reading.y / Math.max(1, reading.height) };
}

/** The cursor in the pixels of a client's screen, Y down, which is what `BlzGetMouseScreenPosX`/`Y` return: the inverse of the game's `pointerX`/`pointerY`, which centre a 4:3 area in the screen and scale it by the screen's height, so the point it computes is the one the window drew under the cursor. */
export function screenPoint(reading: Pick<PointerReading, "x" | "y" | "width" | "height">, screen: { readonly width: number; readonly height: number }): { readonly x: number; readonly y: number } {
  const ui = uiPoint(reading), scale = screen.height / UI_HEIGHT;
  return { x: Math.round(ui.x * scale + (screen.width - screen.height * 4 / 3) / 2), y: Math.round((UI_HEIGHT - ui.y) * scale) };
}

/** The clients a window's mouse drives; `LockstepClients` is one. */
export interface PointerClients {
  client(slot: number): HeadlessClient;
  click(sender: number, x: number, y: number): boolean;
}

/**
 * Feeds one player's window mouse to the clients: the cursor and held buttons are that client's local mouse natives, and a left press and release on the same frame that takes clicks is the player's `FRAMEEVENT_CONTROL_CLICK`,
 * which goes through the lockstep like a key so every client runs the handler on the same frame. The frame under the cursor is the topmost one that takes clicks (`Frames.at`).
 */
export function createPointerFeed(clients: PointerClients, slot: number): (reading: PointerReading) => void {
  let pressedOn: Frame | undefined;
  return (reading) => {
    const client = clients.client(slot);
    const natives = client.natives;
    const buttons: readonly [number, unknown][] = [[POINTER_LEFT, natives.MOUSE_BUTTON_TYPE_LEFT], [POINTER_RIGHT, natives.MOUSE_BUTTON_TYPE_RIGHT], [POINTER_MIDDLE, natives.MOUSE_BUTTON_TYPE_MIDDLE]];
    if (reading.inside) {
      const screen = screenPoint(reading, client.screen);
      client.mouseScreenX = screen.x;
      client.mouseScreenY = screen.y;
    }
    for (const [bit, button] of buttons) {
      if ((reading.held & bit) !== 0) client.heldMouseButtons.add(button);
      else client.heldMouseButtons.delete(button);
    }
    const at = uiPoint(reading);
    if ((reading.pressed & POINTER_LEFT) !== 0) pressedOn = client.clickTarget(at.x, at.y);
    if ((reading.released & POINTER_LEFT) !== 0) {
      const target = client.clickTarget(at.x, at.y);
      if (target !== undefined && target === pressedOn) clients.click(slot, at.x, at.y);
      pressedOn = undefined;
    }
  };
}
