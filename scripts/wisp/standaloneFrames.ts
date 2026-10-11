import type { SoundCue } from "../../src/headless/client";
import type { RenderScene } from "./headlessRender";

/** What the standalone page sends and receives each step; the page imports only this, not the host runner (wisp:scripts/wisp/standalone.ts). */
export interface StandaloneInput {
  readonly buttons: readonly string[];
  readonly axisX: number;
  readonly axisY: number;
}

export interface StandaloneFrame {
  readonly scene: RenderScene;
  readonly sounds: readonly SoundCue[];
  readonly frame: number;
  readonly step: number;
  readonly checksum?: string;
  readonly capture: boolean;
  readonly done: boolean;

  readonly serverMs: number;
}
