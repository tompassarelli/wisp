import type { AnimationState } from "./animation";

export type Handle = { readonly kind: string; readonly id: number };

export type HandleFactory = (this: void, kind: string) => Handle;

export interface EffectPose extends AnimationState {
  readonly handle: Handle;
  readonly model: string;

  readonly created: number;
  x: number;
  y: number;

  z: number;
  alpha: number;
  scale: number;
  timeScale: number;
  queuedAnimations: string[];
  yaw: number;
  pitch: number;
  roll: number;
  color: [number, number, number];
  teamColor: number;
  matrixScale: [number, number, number];

  flat: boolean;

  destroyed?: number;

  death?: number;
}

export type EffectDeaths = (this: void, model: string) => number | undefined;

/** The store's view of a handle that the contract names as a Warcraft handle type. */
export const asHandle = (value: unknown): Handle => value as Handle;

/** A handle the store made, returned as the Warcraft handle type the contract names. */
export const fromHandle = <T>(handle: Handle): T => handle as T;

/** The value a Warcraft player or animation type holds in the emulation: a slot number, or an animation name or number. */
export const asNumber = (value: unknown): number => value as number;

export const asAnimation = (value: unknown): string | number => value as string | number;
