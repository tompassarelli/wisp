import type { SyncMessage } from "./clientTypes";
import { type CallbackTiming, turnStart } from "./frameRate";

export interface SyncOpening {

  opening?(this: void, players: readonly number[]): readonly SyncMessage[];
}

interface OpeningOptions {
  readonly link?: object;
  readonly delivery?: SyncOpening;
  readonly callbacks?: CallbackTiming;
}

export function openingFlights(options: OpeningOptions, players: readonly number[]): readonly { readonly arrival: number; readonly message: SyncMessage }[] {
  if (options.link !== undefined) return [];
  const arrival = turnStart(options.callbacks, 1);
  return (options.delivery?.opening?.(players) ?? []).map((message) => ({ arrival, message }));
}
