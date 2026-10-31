import type { LocalNatives, NativeCall } from "./clientTypes";

export class EmulatedCalls {
  readonly byName = new Map<string, number>();

  readonly count: (this: void, name: string) => void = (name) => {
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

type Behave = (this: void, ...args: unknown[]) => unknown;

export function loggedNative(log: NativeCall[], count: (this: void, name: string) => void, name: string, parameters: number, behave: Behave): Behave {
  switch (parameters) {
    case 0: return () => {
      log.push({ name, args: [] });
      count(name);
      return behave();
    };
    case 1: return (a: unknown) => {
      log.push({ name, args: [a] });
      count(name);
      return behave(a);
    };
    case 2: return (a: unknown, b: unknown) => {
      log.push({ name, args: [a, b] });
      count(name);
      return behave(a, b);
    };
    case 3: return (a: unknown, b: unknown, c: unknown) => {
      log.push({ name, args: [a, b, c] });
      count(name);
      return behave(a, b, c);
    };
    case 4: return (a: unknown, b: unknown, c: unknown, d: unknown) => {
      log.push({ name, args: [a, b, c, d] });
      count(name);
      return behave(a, b, c, d);
    };
    default: return (...args: unknown[]) => {
      log.push({ name, args });
      count(name);
      return behave(...args);
    };
  }
}

export function checkIntentionalNoops(noops: Readonly<Record<string, string>>, functions: readonly (readonly [string, ...unknown[]])[]): void {
  for (const name of Object.keys(noops)) {
    if (!functions.some(([native]) => native === name) || (noops[name] ?? "").trim() === "") {
      throw new Error(`intentional no-op ${name} needs a declared native and a concrete reason`);
    }
  }
}
