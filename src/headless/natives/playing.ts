import type { NativeBehavior } from "../clientTypes";

/** Whether the map says a match is on (`WispSetPlaying`), so the native window does no background art work and keeps its art until play stops. */
export class Playing {
  on = false;

  behaviors(): Readonly<Record<string, NativeBehavior>> {
    return { WispSetPlaying: (playing: unknown) => { this.on = playing === true; } };
  }
}
