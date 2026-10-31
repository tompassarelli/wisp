import type { SoundCue } from "../../src/headless/clientTypes";
import type { PointerReading } from "../../src/headless/pointer";
import type { RenderScene } from "./headlessRender";

/** What the standalone page sends and receives each step; the page imports only this, not the host runner (wisp:host/play/standalone.ts). */
export interface StandaloneInput {
  readonly buttons: readonly string[];
  readonly axisX: number;
  readonly axisY: number;
  /** The window's mouse; a session that takes clicks feeds it to its clients with `createPointerFeed` (wisp:src/headless/pointer.ts). */
  readonly pointer?: PointerReading;
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
