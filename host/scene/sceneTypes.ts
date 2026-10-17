import type { SceneModel } from "../../src/runtime/scene";

export interface SceneReport {
  readonly serial: number;

  readonly frame: number;

  readonly effects: number;
  readonly models: readonly SceneModel[];
}

export interface SceneKind {

  readonly name: string;

  readonly models: readonly string[];

  readonly lifetime?: number;
}

export interface SceneProblem {

  readonly seen: string;

  readonly evidence: string;
}
