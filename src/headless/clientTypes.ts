import type { Handle } from "../game/native/types";
import type { AnimationState } from "../game/native/animation";

export interface NativeCall {
  readonly name: string;
  readonly args: readonly unknown[];
}

export interface SyncMessage {
  readonly sender: number;
  readonly prefix: string;
  readonly data: string;
}

export type MouseButton = "left" | "middle" | "right";

/** A player's mouse at world coordinates: a move, or a button pressed or released there. */
export type PlayerMouseInput =
  | { readonly x: number; readonly y: number }
  | { readonly x: number; readonly y: number; readonly button: MouseButton; readonly down: boolean };

export interface MapEntry {
  start(this: void): void;
  install(this: void): void;
}

export type LocalNatives = Readonly<Record<string, string>>;

export type IntentionalNoops = Readonly<Record<string, string>>;

export type StandaloneProfile = readonly string[];

export interface MissingNative {
  readonly native: string;
  readonly client: number;
  readonly frame: number;
  readonly outsideProfile?: true;
}

export type NativeBehavior = (this: void, ...args: never[]) => unknown;

export type NativeBehaviors = Readonly<Record<string, unknown>>;

export type { SoundCue } from "../game/native/types";

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

export interface ClientFiles {

  written(this: void, name: string, lines: readonly string[]): void;

  read(this: void, name: string): readonly string[] | undefined;
}
