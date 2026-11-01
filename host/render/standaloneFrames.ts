import type { SoundCue } from "../../src/headless/clientTypes";
import type { KeyTransition } from "../../src/headless/keyInput";
import type { PointerReading } from "../../src/headless/pointer";
import type { RenderScene } from "./headlessRender";

/** What the standalone page sends and receives each step; the page imports only this, not the host runner (wisp:host/play/standalone.ts). */
export interface StandaloneInput {
  readonly buttons: readonly string[];
  readonly axisX: number;
  readonly axisY: number;
  /** The window's mouse; a session that takes clicks feeds it to its clients with `createPointerFeed` (wisp:src/headless/pointer.ts). */
  readonly pointer?: PointerReading;
  /** The window's keyboard since the step before, oldest first: every key as the OS key event Warcraft raises, for `createKeyFeed` (wisp:src/headless/keyInput.ts). A pad's presses stay in `buttons`. */
  readonly keys?: readonly KeyTransition[];
  /** The window's size in pixels, which the local client reports as its screen (`HeadlessClient.resize`); unset keeps the client's own. */
  readonly screen?: { readonly width: number; readonly height: number };
}

export interface StandaloneFrame {
  readonly scene: RenderScene;
  readonly sounds: readonly SoundCue[];
  readonly frame: number;
  readonly step: number;
  readonly checksum?: string;
  readonly capture: boolean;
  readonly done: boolean;
  /** Named stage times of this step in milliseconds, such as the sim tick or a rollback's resimulation; the native window keeps a series per name and reports each one's spread. */
  readonly stages?: Readonly<Record<string, number>> | undefined;

  readonly serverMs: number;
}
