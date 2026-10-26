import type { AnimationState } from "./animation";

export type Handle = { readonly kind: string; readonly id: number };

export type HandleFactory = (this: void, kind: string) => Handle;

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

export interface MapEntry {
  start(this: void): void;
  install(this: void): void;
}

export type LocalNatives = Readonly<Record<string, string>>;

export type IntentionalNoops = Readonly<Record<string, string>>;

export interface MissingNative {
  readonly native: string;
  readonly client: number;
  readonly frame: number;
}

export type NativeBehavior = (this: void, ...args: never[]) => unknown;

export type NativeBehaviors = Readonly<Record<string, unknown>>;

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

export interface CineFilterPose {
  readonly texture: string;

  readonly blendMode: string;
  readonly texMapFlags: unknown;

  readonly color: readonly [number, number, number, number];

  readonly uv: readonly [number, number, number, number];
}

export interface CameraPose {
  readonly x: number;
  readonly y: number;
  readonly fields: Readonly<Record<string, number>>;
}

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
