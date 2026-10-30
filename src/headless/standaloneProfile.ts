import type { StandaloneProfile } from "./clientTypes";

export function enforceStandaloneProfile(profile: StandaloneProfile | undefined, declared: ReadonlySet<string>, natives: Record<string, unknown>, outside: (this: void, native: string) => void): void {
  if (profile === undefined) return;
  const allowed = new Set(profile);
  for (const name of allowed) if (!declared.has(name)) throw new Error(`standalone profile native ${name} is not a declared native`);
  for (const name of declared) if (!allowed.has(name)) natives[name] = reportedOnce(name, natives[name] as (this: void, ...args: unknown[]) => unknown, outside);
}

function reportedOnce(name: string, inner: (this: void, ...args: unknown[]) => unknown, outside: (this: void, native: string) => void): (this: void, ...args: unknown[]) => unknown {
  let reported = false;
  return (...args: unknown[]) => {
    if (!reported) outside(name);
    reported = true;
    return inner(...args);
  };
}
