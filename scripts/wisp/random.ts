// A seeded random generator for host simulations that must repeat exactly
// from their seed, such as sync delivery and the soak's input fuzzer.

/** Park-Miller minimal standard generator in Schrage's form: every product stays below 2^31. */
export class Random {
  private state: number;

  constructor(seed: number) {
    this.state = (Math.abs(Math.trunc(seed)) % 2147483646) + 1;
  }

  /** Uniform in (0, 1). */
  next(): number {
    const high = Math.floor(this.state / 44488);
    const next = 48271 * (this.state - high * 44488) - 3399 * high;
    this.state = next > 0 ? next : next + 2147483647;
    return this.state / 2147483647;
  }

  /** A whole number from `low` to `high`, both included. */
  between(low: number, high: number): number {
    return low + Math.min(high - low, Math.floor(this.next() * (high - low + 1)));
  }

  /** True with probability `p`. */
  chance(p: number): boolean {
    return this.next() < p;
  }

  /** One of `items`, which is not empty. */
  pick<T>(items: readonly T[]): T {
    const item = items[this.between(0, items.length - 1)];
    if (item === undefined) throw new Error("pick from no items");
    return item;
  }
}
