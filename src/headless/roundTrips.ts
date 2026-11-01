const PING_INTERVAL_MS = 250;

export class RoundTrips {
  private readonly smoothed = new Map<number, number>();
  private lastPing = Number.NEGATIVE_INFINITY;
  private nextId = 0;

  constructor(private readonly clock: (this: void) => number) {}

  ping(): { readonly id: number; readonly atMs: number } | undefined {
    const now = this.clock();
    if (now - this.lastPing < PING_INTERVAL_MS) return undefined;
    this.lastPing = now;
    return { id: this.nextId++, atMs: now };
  }

  pong(slot: number, atMs: number): void {
    const sample = Math.max(0, Math.min(10000, this.clock() - atMs));
    const before = this.smoothed.get(slot);
    this.smoothed.set(slot, before === undefined ? sample : before + (sample - before) / 8);
  }

  roundTripMs(slot: number): number {
    const value = this.smoothed.get(slot);
    return value === undefined ? -1 : Math.round(value);
  }
}

export const linkRoundTrips = (link: { roundTripMs?(this: void, slot: number): number } | undefined, local: number) =>
  (player: number): number => player === local ? -1 : link?.roundTripMs?.(player) ?? -1;
