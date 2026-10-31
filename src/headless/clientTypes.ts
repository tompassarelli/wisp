import type { Handle } from "../game/native/types";

export interface NativeCall {
  readonly name: string;
  readonly args: readonly unknown[];
}

export type { SyncMessage } from "../game/native/syncStore";

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

export type { UnitPose, UnitStateFixture, UnitStateFixtures } from "../game/native/types";

export interface ClientFiles {

  written(this: void, name: string, lines: readonly string[]): void;

  read(this: void, name: string): readonly string[] | undefined;
}
