import type { HeadlessClient } from "./client";
import type { Frame, Frames } from "../game/native/frameStore";
import type { ChatEntry } from "./chatEntry";
import { f32 } from "../sim/f32";

const UI_HALF_WIDTH = f32(0.4), UI_HEIGHT = f32(0.6);

export function point(client: HeadlessClient, x: number, y: number, left: boolean | undefined): void {
  client.mouseScreenX = x;
  client.mouseScreenY = y;
  if (left === true) client.heldMouseButtons.add(client.natives.MOUSE_BUTTON_TYPE_LEFT);
  else if (left === false) client.heldMouseButtons.delete(client.natives.MOUSE_BUTTON_TYPE_LEFT);
}

export const POINTER_LEFT = 1, POINTER_RIGHT = 2;
const POINTER_MIDDLE = 4;

/** What Warcraft reports for one notch of the wheel as `BlzGetTriggerFrameValue`: 120 away from the user, -120 toward (wisp:docs/references.md). */
export const WHEEL_NOTCH = 120;
const WHEEL_BURST = 8;

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
  /** The whole notches the wheel turned since the sample before, positive away from the user; absent for none. */
  readonly wheel?: number;
}

/** The cursor on Warcraft's 0.8 by 0.6 UI screen, Y up: the window draws the 4:3 UI area centred in the window and scaled by the window's height (`layout::pixels` in the window's ui/layout.rs). */
export function uiPoint(reading: Pick<PointerReading, "x" | "y" | "width" | "height">): { readonly x: number; readonly y: number } {
  const scale = UI_HEIGHT / Math.max(1, reading.height);
  return { x: UI_HALF_WIDTH + (reading.x - reading.width / 2) * scale, y: UI_HEIGHT - reading.y * scale };
}

/** The cursor in the pixels of a client's screen, Y down, which is what `BlzGetMouseScreenPosX`/`Y` return: the window is mapped by height so the 4:3 area keeps its place whatever the two aspect ratios, and the game's `pointerX`/`pointerY` read back the point the window drew under the cursor. */
export function screenPoint(reading: Pick<PointerReading, "x" | "y" | "width" | "height">, screen: { readonly width: number; readonly height: number }): { readonly x: number; readonly y: number } {
  const scale = screen.height / Math.max(1, reading.height);
  return { x: Math.round((reading.x - reading.width / 2) * scale + screen.width / 2), y: Math.round(reading.y * scale) };
}

/** Only the frame store's `point` and the chat entry's `holds` and `open`: both classes have private members, so a consumer that sees Wisp through both its source and its published types would find the whole class incompatible with itself. */
export type PointerClient = Pick<HeadlessClient, "natives" | "screen" | "mouseScreenX" | "mouseScreenY" | "heldMouseButtons" | "eventTarget"> & { readonly frames: Pick<Frames, "point">; readonly chatEntry: Pick<ChatEntry, "holds" | "open"> };

/** The clients a window's mouse drives; `LockstepClients` is one. */
export interface PointerClients {
  client(slot: number): PointerClient;
  click(sender: number, x: number, y: number): boolean;
  wheel(sender: number, x: number, y: number, value: number): boolean;
}

function turnWheel(clients: PointerClients, slot: number, at: { readonly x: number; readonly y: number }, notches: number): void {
  const value = notches > 0 ? WHEEL_NOTCH : -WHEEL_NOTCH;
  for (let notch = 0; notch < Math.min(Math.abs(notches), WHEEL_BURST); notch++) clients.wheel(slot, at.x, at.y, value);
}

/**
 * Feeds one player's window mouse to the clients: the cursor and held buttons are that client's local mouse natives, and a left press and release on the same frame that takes clicks is the player's `FRAMEEVENT_CONTROL_CLICK`,
 * which goes through the lockstep like a key so every client runs the handler on the same frame. A turn of the wheel over a frame that registered `FRAMEEVENT_MOUSE_WHEEL` is that event once per notch, valued 120 or -120, sent the same way. The frame under the cursor is the topmost one that takes clicks (`Frames.at`). A left press where the map draws the chat line, on no frame that takes clicks, opens the line (wisp:src/headless/chatEntry.ts).
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
    const target = client.eventTarget(natives.FRAMEEVENT_CONTROL_CLICK, at.x, at.y);
    if ((reading.pressed & POINTER_LEFT) !== 0) {
      pressedOn = target;
      if (target === undefined && client.chatEntry.holds(at.x, at.y)) client.chatEntry.open();
    }
    if ((reading.released & POINTER_LEFT) !== 0) {
      if (target !== undefined && target === pressedOn) clients.click(slot, at.x, at.y);
      pressedOn = undefined;
    }
    if (reading.inside) turnWheel(clients, slot, at, reading.wheel ?? 0);
    client.frames.point(reading.inside ? target : undefined, pressedOn);
  };
}
