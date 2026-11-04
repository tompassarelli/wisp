import type { HeadlessClient } from "../../src/headless/client";
import type { LockstepLink } from "../../src/headless/lockstep";
import type { NetSession } from "../net/peer";
import type { HeadlessRenderProject } from "../render/headlessRender";
import type { StandaloneInput } from "../render/standaloneFrames";

export interface StandaloneSession {
  readonly client: HeadlessClient;
  step(input: StandaloneInput): void;
  checksum(): string;
  frame?(): number;
  finished?(): boolean;
  /** The named stage times of the last step in milliseconds, such as the sim tick or a rollback's resimulation; the step adds `scene`, the time from the headless client to the scene, and the native window reports a spread for each name. */
  stages?(): Readonly<Record<string, number>>;
  close(): void;
  /** Frames advance on their own (a networked match); `step` only hands over the input and the scene is read as it stands. */
  readonly paced?: boolean;
}

/** One slot of a networked match: the transport steps it, the window reads its scene and gives it the local input. */
export interface StandaloneNetSession extends NetSession {
  readonly client: HeadlessClient;
  input(this: void, input: StandaloneInput): void;
  finished?(this: void): boolean;
  /** The named stage times since the window last asked, summed over the transport's steps in between, such as the sim tick and the rollback's resimulation (`StandaloneSession.stages`). */
  stages?(this: void): Readonly<Record<string, number>>;
}

export interface StandaloneGame {
  readonly title: string;
  readonly render: HeadlessRenderProject;
  create(options?: { readonly script?: string }): Promise<StandaloneSession>;
  /** Host and join (wisp:docs/play.md): the map's hash, compared before a match, and one slot's session over the link. */
  readonly net?: {
    mapHash(this: void): Promise<string>;
    create(this: void, link: LockstepLink, slot: number, humans: number, options?: { readonly script?: string }): Promise<StandaloneNetSession>;
  };
}

export type StandaloneNet = { readonly host: { readonly port: number; readonly relay?: string } } | { readonly join: string };
