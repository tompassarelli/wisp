import type { Effects } from "./effectStore";
import type { EventStore } from "./eventStore";
import type { FrameUi } from "./frameUi";
import type { Lightnings } from "./lightnings";
import type { Quests } from "./quests";
import type { Sounds } from "./soundStore";
import type { TextTags } from "./textTags";

/** The stores of one running game. A host binds the world it is about to run, and the family modules reach their store through it. */
export interface World {
  readonly effects: Effects;
  readonly beams: Lightnings;
  readonly floatingText: TextTags;
  readonly frames: FrameUi;
  readonly events: EventStore;
  readonly quests: Quests;
  /** Puts a line in the message area of the client that `player` plays, if this world is that client's. */
  readonly display: (this: void, player: unknown, text: string) => void;
  readonly sounds: Sounds;
  /** Records the Warcraft native a call stands for; only the headless client installs it. */
  readonly log?: (this: void, native: string, args: readonly unknown[]) => void;
}

let bound: World | undefined;

export function bindWorld(world: World | undefined): void {
  bound = world;
}

export function boundWorld(): World {
  if (bound === undefined) throw new Error("Wisp's game API was used with no world bound");
  return bound;
}
