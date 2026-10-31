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

export interface UnitPose extends AnimationState {
  readonly handle: Handle;
  readonly typeId: number;
  owner: number;
  x: number;
  y: number;
  z: number;

  facing: number;
  scale: [number, number, number];
  alpha: number;
  color: [number, number, number];
  teamColor: number;
  timeScale: number;
  visible: boolean;
}

export interface UnitStateFixture {
  readonly life: number;
  readonly maxLife: number;
  readonly mana: number;
  readonly maxMana: number;
}

export type UnitStateFixtures = Readonly<Record<number, UnitStateFixture>>;

export interface SoundCue {
  readonly event: "create" | "start" | "stop" | "volume";
  readonly kind: "sound" | "music";
  readonly frame: number;
  readonly handle: Handle;
  readonly source: string | undefined;
  readonly label: string | undefined;
  readonly volume: number;
  readonly effectiveVolume: number;
  readonly looping: boolean;
  readonly pitch: number;
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export type EffectDeaths = (this: void, model: string) => number | undefined;

/** The store's view of a handle that the contract names as a Warcraft handle type. */
export const asHandle = (value: unknown): Handle => value as Handle;

/** A handle the store made, returned as the Warcraft handle type the contract names. */
export const fromHandle = <T>(handle: Handle): T => handle as T;

/** The value a Warcraft player or animation type holds in the emulation: a slot number, or an animation name or number. */
export const asNumber = (value: unknown): number => value as number;

/** A value the contract names as a Warcraft handle type that the emulation holds as a plain value, such as a player's slot number. */
export const fromValue = <T>(value: unknown): T => value as T;

export const asAnimation = (value: unknown): string | number => value as string | number;
