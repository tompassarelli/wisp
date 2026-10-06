// Frame cost in 32-bit Lua (wisp:docs/frame-cost.md): the map's compiled
// bundle plays a journey in simulated clients, as runLuaJourney does, and each
// client's frames are measured: Lua instructions, Lua time and calls to
// Warcraft's functions. Instructions are what CI compares: the same code and
// journey count the same instructions on every run.
//
// While a client runs, a count hook on the main thread counts every HOOK_STEP
// instructions, restarted at each run, so a run counts its instructions
// rounded down to a multiple of HOOK_STEP. The emulated functions run on a
// coroutine of their own without the hook, so neither their instructions nor
// their time are the map's.
import { type ClientScope, type HeadlessClient } from "./client";
import { parseNativeDeclarations } from "./declarations";
import { type Journey, type JourneyResult, journeyLines, journeyProblems, runJourney } from "./journey";
import { Lockstep } from "./lockstep";
import { type LuaHeadlessMap, luaLockstep, readFile } from "./lua";
import { spread } from "../runtime/frameCost";

/** Instructions between the hook's counts: each run of a client counts its instructions rounded down to a multiple of this. */
export const HOOK_STEP = 100;

type Native = (this: void, ...args: unknown[]) => unknown;

/** One client's cost per frame; index 0 is its start. */
interface ClientCost {
  readonly slot: number;
  readonly instructions: number[];
  readonly microseconds: number[];
  readonly natives: number[];
  calls: number;
}

/**
 * Runs the native it is resumed with on the arguments after it, yields the
 * result and serves the next call it is resumed with; tail calls keep it one
 * frame deep. Varargs pass every argument, nil ones included.
 */
const serve = (...call: unknown[]): unknown => {
  const [native] = select(1, ...call);
  return serve(...coroutine.yield((native as Native)(...select(2, ...call))));
};

function nativeThread(): LuaThread {
  return coroutine.create((...call: unknown[]) => {
    // A coroutine starts with its creator's hook.
    debug.sethook();
    return serve(...call);
  });
}

const add = (values: number[], index: number, amount: number) => {
  values[index] = (values[index] ?? 0) + amount;
};

/** A value to the nearest whole number: binary32 has too few digits for a frame's hundredths of a million instructions. */
const whole = (value: number) => `${Math.floor(value + 0.5)}`;

function costLines(cost: ClientCost, frames: number): string[] {
  const lines: string[] = [];
  const named: readonly (readonly [string, readonly number[]])[] = [["instructions", cost.instructions], ["lua-us", cost.microseconds], ["natives", cost.natives]];
  for (const [name, values] of named) {
    const perFrame: number[] = [];
    let total = 0;
    for (let frame = 1; frame <= frames; frame++) {
      const value = values[frame] ?? 0;
      perFrame.push(value);
      total += value;
    }
    const { median, mean, max } = spread(perFrame, perFrame.length);
    lines.push(`p${cost.slot} ${name} start=${whole(values[0] ?? 0)} total=${whole(total)} median=${whole(median)} mean=${whole(mean)} max=${whole(max)}`);
  }
  return lines;
}

/**
 * Plays `journey` with the bundle and declarations at these paths, measuring
 * every client's frames, prints the result as `wisp perf` reads it and
 * returns how many problems the journey found.
 */
export function runLuaPerf(map: LuaHeadlessMap, journey: Journey, bundlePath: string, declarationsPath: string): number {
  const declarations = readFile(declarationsPath);
  const costs = new Map<HeadlessClient, ClientCost>();
  let fired = 0;
  const count = () => {
    fired++;
  };
  let nativeSeconds = 0;
  let depth = 0;
  let thread = nativeThread();
  let entered = { fired: 0, seconds: 0, natives: 0, calls: 0 };
  let clients: Lockstep | undefined;
  const scope: ClientScope = {
    enter: (client) => {
      // Restarting the count makes each run's count its own instructions, whatever ran before it.
      debug.sethook(count, "", HOOK_STEP);
      entered = { fired, seconds: os.clock(), natives: nativeSeconds, calls: costs.get(client)?.calls ?? 0 };
    },
    leave: (client) => {
      debug.sethook();
      const cost = costs.get(client);
      if (cost === undefined) return;
      const frame = clients?.frame ?? 0;
      add(cost.instructions, frame, (fired - entered.fired) * HOOK_STEP);
      add(cost.microseconds, frame, (os.clock() - entered.seconds - (nativeSeconds - entered.natives)) * 1000000);
      add(cost.natives, frame, cost.calls - entered.calls);
    },
  };
  const counted = (cost: ClientCost, native: Native): Native => (...args: unknown[]) => {
    cost.calls++;
    // A native that runs map code, which calls another, runs it where it is.
    if (depth > 0) return native(...args);
    depth++;
    const started = os.clock();
    const [ran, result] = coroutine.resume(thread, native, ...args);
    nativeSeconds += os.clock() - started;
    depth--;
    if (!ran) {
      thread = nativeThread();
      error(result, 0);
    }
    return result;
  };
  const lockstep = luaLockstep(map, readFile(bundlePath), declarations, scope);
  clients = lockstep;
  const names = parseNativeDeclarations(declarations).functions.map(([name]) => name);
  for (const client of lockstep.clients) {
    const cost: ClientCost = { slot: client.slot, instructions: [], microseconds: [], natives: [], calls: 0 };
    costs.set(client, cost);
    for (const name of names) {
      const native = client.natives[name];
      if (typeof native === "function") client.natives[name] = counted(cost, native as Native);
    }
  }
  let result: JourneyResult;
  try {
    result = runJourney(lockstep, journey, { checksums: false });
  } finally {
    debug.sethook();
  }
  const problems = journeyProblems(result);
  print(`frames ${lockstep.frame} step ${HOOK_STEP} problems ${problems}`);
  for (const cost of costs.values()) for (const line of costLines(cost, lockstep.frame)) print(line);
  if (problems > 0) for (const line of journeyLines(result)) print(`journey: ${line}`);
  return problems;
}
