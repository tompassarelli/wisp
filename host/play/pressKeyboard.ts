import type { Effect, Scope } from "effect";
import type { DesktopFailure } from "../contract/client";
import { openVirtualKeyboard, waylandSocketPath } from "./waylandKeyboard";
import type { Keyboard } from "./keyboard";
import { openKeyboard as openXtestKeyboard } from "./xtest";

export const PRESS_INPUTS = ["xtest", "wayland"] as const;
/** `xtest` presses through the X server an Xwayland window reads; `wayland` through the compositor's virtual keyboard, which a native Wayland window reads. */
export type PressInput = (typeof PRESS_INPUTS)[number];

export interface KeyboardTarget {
  readonly input: PressInput;
  readonly display: string | undefined;
  readonly waylandRuntime: string;
  readonly waylandDisplay: string;
}

export const openPressKeyboard = (target: KeyboardTarget, key: string): Effect.Effect<Keyboard, DesktopFailure, Scope.Scope> =>
  target.input === "wayland"
    ? openVirtualKeyboard(waylandSocketPath(target.waylandRuntime, target.waylandDisplay), key)
    : openXtestKeyboard(target.display ?? "", key);
