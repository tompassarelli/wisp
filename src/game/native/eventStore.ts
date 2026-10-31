import type { Handle } from "./types";

/** The event triggers of one running game, which the native backend's `wisp/game/events` and frame event calls run. */
export interface EventStore {
  create(): Handle;
  addAction(events: Handle, handler: (this: void) => void): Handle;
  destroy(events: Handle): void;
  registerFrame(events: Handle, frame: unknown, event: unknown): Handle;
  hasFrame(events: Handle, frame: unknown, event: unknown): boolean;
  registerLeave(events: Handle, slot: number): Handle;
  registerKey(events: Handle, slot: number, key: number, meta: number, down: boolean): Handle;
  registerChat(events: Handle, slot: number, text: string, exact: boolean): Handle;
  registerMouseMove(events: Handle, slot: number): Handle;
  registerSync(events: Handle, slot: number, prefix: string): Handle;
  syncData(): string;
  syncPrefix(): string;
  triggerPlayer(): unknown;
  triggerKey(): number;
  triggerChat(): string;
  triggerMouseX(): number;
  triggerMouseY(): number;
  triggerFrame(): unknown;
  triggerFrameEvent(): unknown;
  triggerFrameText(): string;
}
