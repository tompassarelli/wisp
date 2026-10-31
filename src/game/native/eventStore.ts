import type { Handle } from "./types";

/** The event triggers of one running game, which the native backend's `wisp/game/events` and frame event calls run. */
export interface EventStore {
  create(): Handle;
  addAction(events: Handle, handler: (this: void) => void): Handle;
  destroy(events: Handle): void;
  registerFrame(events: Handle, frame: unknown, event: unknown): Handle;
  hasFrame(events: Handle, frame: unknown, event: unknown): boolean;
  triggerFrame(): unknown;
  triggerFrameEvent(): unknown;
  triggerFrameText(): string;
}
