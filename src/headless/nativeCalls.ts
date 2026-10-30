import type { LocalNatives, NativeCall } from "./clientTypes";

export class EmulatedCalls {
  readonly byName = new Map<string, number>();

  readonly count = (name: string): void => {
    this.byName.set(name, (this.byName.get(name) ?? 0) + 1);
  };

  counting(name: string, behave: (this: void, ...args: unknown[]) => unknown): (this: void, ...args: unknown[]) => unknown {
    return (...args) => {
      this.count(name);
      return behave(...args);
    };
  }
}

export const logUnlessLocal = (log: NativeCall[], local: LocalNatives) => (name: string, args: readonly unknown[]): void => {
  if (local[name] === undefined) log.push({ name, args });
};
