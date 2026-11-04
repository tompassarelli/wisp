import type { LocalNatives, NativeCall } from "./clientTypes";
import { type EmulatedCalls, loggedNative } from "./nativeCalls";

type Behave = (this: void, ...args: unknown[]) => unknown;

const isWispHook = (name: string): boolean => name.startsWith("Wisp");

const uncounted = (): void => undefined;

export class NativeTable {
  private readonly arity = new Map<string, number>();
  private readonly natives: Record<string, unknown>;
  private readonly log: NativeCall[];
  private readonly local: LocalNatives;
  private readonly emulated: EmulatedCalls;
  private readonly warcraft: boolean;

  constructor(natives: Record<string, unknown>, log: NativeCall[], local: LocalNatives, emulated: EmulatedCalls, warcraft: boolean) {
    this.natives = natives;
    this.log = log;
    this.local = local;
    this.emulated = emulated;
    this.warcraft = warcraft;
  }

  declare(name: string, parameters: number, behave: Behave): void {
    this.arity.set(name, parameters);
    const hook = isWispHook(name);
    if (!this.warcraft && !hook) return;
    if (this.local[name] === undefined) this.natives[name] = loggedNative(this.log, hook ? uncounted : this.emulated.count, name, parameters, behave);
    else this.natives[name] = hook ? behave : this.emulated.counting(name, behave);
  }

  constants(values: Readonly<Record<string, unknown>>): void {
    if (this.warcraft) Object.assign(this.natives, values);
  }

  extra(name: string, value: unknown): void {
    const parameters = this.arity.get(name);
    if (parameters === undefined) {
      this.natives[name] = value;
      return;
    }
    const hook = isWispHook(name);
    if (!this.warcraft && !hook) return;
    this.natives[name] = typeof value === "function" && this.local[name] === undefined ? loggedNative(this.log, hook ? uncounted : this.emulated.count, name, parameters, value as Behave) : value;
  }
}
