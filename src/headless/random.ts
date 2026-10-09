


import { floorDiv, floorMod } from "../sim/intMath";

/** Park-Miller minimal standard generator in Schrage's form: every product stays below 2^31. */
export class Random {
  private state: number;

  constructor(seed: number) {
    this.state = floorMod(Math.abs(Math.trunc(seed)), 2147483646) + 1;
  }


  next(): number {
    const high = floorDiv(this.state, 44488);
    const next = 48271 * (this.state - high * 44488) - 3399 * high;
    this.state = next > 0 ? next : next + 2147483647;
    return this.state / 2147483647;
  }


  between(low: number, high: number): number {
    return low + Math.min(high - low, Math.floor(this.next() * (high - low + 1)));
  }


  chance(p: number): boolean {
    return this.next() < p;
  }


  pick<T>(items: readonly T[]): T {
    const item = items[this.between(0, items.length - 1)];
    if (item === undefined) throw new Error("pick from no items");
    return item;
  }
}
