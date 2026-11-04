import { f32 } from "../sim/f32";
import { POINTER_LEFT, type PointerReading } from "./pointer";

const UI_WIDTH = f32(0.8), UI_HEIGHT = f32(0.6);
const MAX_NOTCHES = 8;
const WINDOW_HEIGHT = 1200, WINDOW_WIDTH = WINDOW_HEIGHT * 4 / 3;

export type PointerStep =
  | { readonly frame: number; readonly kind: "pointer"; readonly x: number; readonly y: number }
  | { readonly frame: number; readonly kind: "click"; readonly x: number; readonly y: number; readonly frames: number }
  | { readonly frame: number; readonly kind: "wheel"; readonly x: number; readonly y: number; readonly notches: number };

const coordinate = (text: string | undefined, high: number, name: string): number => {
  const value = Number(text);
  if (text === undefined || !Number.isFinite(value) || value < 0 || value > high) throw new Error(`pointer ${name} runs 0..${high.toFixed(1)}`);
  return value;
};

/** The pointer step of a pad script line (`pointer X Y` moves; `click X Y [FRAMES]` moves, presses the left button and releases it FRAMES later, 1 by default); `wheel X Y DELTA` moves and turns the wheel DELTA notches on that frame, positive away from the user, X and Y on Warcraft's 0.8 by 0.6 UI screen with Y up; undefined for any other action. */
export function pointerStep(frame: number, action: string, args: readonly string[]): PointerStep | undefined {
  if (action !== "pointer" && action !== "click" && action !== "wheel") return undefined;
  const x = coordinate(args[0], UI_WIDTH, "X"), y = coordinate(args[1], UI_HEIGHT, "Y");
  if (action === "pointer") return { frame, kind: "pointer", x, y };
  if (action === "wheel") {
    const notches = Number(args[2]);
    if (args[2] === undefined || !Number.isInteger(notches) || notches === 0 || Math.abs(notches) > MAX_NOTCHES) throw new Error(`wheel DELTA is a whole number of notches, 1..${MAX_NOTCHES} away from the user or -1..-${MAX_NOTCHES} toward`);
    return { frame, kind: "wheel", x, y, notches };
  }
  const frames = args[2] === undefined ? 1 : Number(args[2]);
  if (!Number.isInteger(frames) || frames < 1 || frames > 600) throw new Error("click FRAMES runs 1..600");
  return { frame, kind: "click", x, y, frames };
}

/** The window reading that puts the cursor on a UI-screen point, in a 4:3 window whose height maps one to one onto the UI's 0.6 (the inverse of `uiPoint`). */
export function uiReading(x: number, y: number, rest: Partial<Pick<PointerReading, "held" | "pressed" | "released" | "wheel">> = {}): PointerReading {
  const scale = WINDOW_HEIGHT / UI_HEIGHT;
  return { x: WINDOW_WIDTH / 2 + (x - UI_WIDTH / 2) * scale, y: (UI_HEIGHT - y) * scale, width: WINDOW_WIDTH, height: WINDOW_HEIGHT, inside: true, held: 0, pressed: 0, released: 0, ...rest };
}

/** The window mouse a script of pointer steps plays: ask once per frame, in order, and it gives the reading for that frame (the cursor where the script last put it, the left button down from a click's frame until its release), or undefined before the first step. */
export function scriptedPointer(steps: readonly PointerStep[]): (frame: number) => PointerReading | undefined {
  const ordered = [...steps].sort((a, b) => a.frame - b.frame);
  let next = 0, x = 0, y = 0, started = false, releaseAt = 0, held = 0;
  return (frame) => {
    let pressed = 0, released = 0, wheel = 0;
    if (held !== 0 && releaseAt <= frame) {
      held = 0;
      released = POINTER_LEFT;
    }
    while ((ordered[next]?.frame ?? Infinity) <= frame) {
      const step = ordered[next++];
      if (step === undefined) break;
      ({ x, y } = step);
      started = true;
      if (step.kind === "wheel") wheel += step.notches;
      if (step.kind !== "click") continue;
      if (held !== 0) released = POINTER_LEFT;
      held = POINTER_LEFT;
      pressed = POINTER_LEFT;
      releaseAt = step.frame + step.frames;
    }
    return started ? uiReading(x, y, wheel === 0 ? { held, pressed, released } : { held, pressed, released, wheel }) : undefined;
  };
}
