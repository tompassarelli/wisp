// Frame cost in 32-bit Lua (wisp:docs/frame-cost.md): the map's compiled
// bundle plays in simulated clients, as runLuaJourney does, and each client's
// frames are measured: Lua instructions, Lua time, calls to Warcraft's
// functions, memory allocated and text typed, and from them the frame's
// predicted cost in Warcraft (nativeCost.ts). Instructions are what CI
// compares: the same code and journey count the same instructions on every run.
//
// While a client runs, a count hook on the main thread counts every HOOK_STEP
// instructions, restarted at each run, so a run counts its instructions
// rounded down to a multiple of HOOK_STEP. The emulated functions run on a
// coroutine of their own without the hook, so neither their instructions,
// their time nor their allocations are the map's. The collector stops while a
// client runs, so Lua time holds none of its work and the memory counted is
// what the map allocated; between runs it collects once the heap has grown.
import { type ClientScope, type HeadlessClient } from "./client";
import { parseNativeDeclarations } from "./declarations";
import { type Journey, type JourneyResult, journeyLines, journeyProblems, runJourney } from "./journey";
import { Lockstep, type SyncDelivery } from "./lockstep";
import { type LuaHeadlessMap, luaLockstep, readFile } from "./lua";
import { type NativeCostModel, WARCRAFT_COST, nativeFrameCost } from "./nativeCost";
import { f32 } from "../sim/f32";
import { floorDiv, floorMod } from "../sim/intMath";

/** Instructions between the hook's counts: each run of a client counts its instructions rounded down to a multiple of this. */
export const HOOK_STEP = 100;

/** Kilobytes the heap may grow by between full collections, outside the measured runs. */
const COLLECT_EVERY_KB = 16384;

type Native = (this: void, ...args: unknown[]) => unknown;

/** One client's values per frame; index 0 is its start. */
interface ClientCost {
  readonly slot: number;
  readonly instructions: number[];
  readonly microseconds: number[];
  readonly natives: number[];
  readonly allocatedKb: number[];
  readonly typed: number[];
  calls: number;
  /** Kilobytes the emulated natives allocated, which are not the map's. */
  nativeKb: number;
}

/** What a game's own driver tells the measurement while it plays the clients. */
export interface PerfMeasure {
  /** `characters` were typed into `slot`'s edit box before the next frame. */
  typed(this: void, slot: number, characters: number): void;
  /** Counts frames from the next one on, such as a match's first frame after its menus. */
  begin(this: void): void;
}

export interface LuaPerfOptions {
  /** The model the predicted lines use; Warcraft's measured one by default. */
  readonly model?: NativeCostModel;
  /** Also print every client's every frame, `frame F pSLOT ...`, to calibrate a model. */
  readonly samples?: boolean;
  /** When synchronized messages arrive, such as Warcraft's measured latency; before the next frame without it. */
  readonly delivery?: SyncDelivery;
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

/** The value at a share of the sorted values, nearest rank. */
function rank(sorted: readonly number[], share: number): number {
  if (sorted.length === 0) return 0;
  const index = Math.max(0, Math.min(sorted.length - 1, Math.ceil(share * sorted.length) - 1));
  return sorted[index] ?? 0;
}

function valueLine(slot: number, name: string, values: readonly number[], first: number, last: number): string {
  const perFrame: number[] = [];
  let total = 0;
  for (let frame = first; frame <= last; frame++) {
    const value = values[frame] ?? 0;
    perFrame.push(value);
    total += value;
  }
  perFrame.sort((left, right) => left - right);
  const middle = floorDiv(perFrame.length, 2);
  const median = perFrame.length === 0 ? 0 : floorMod(perFrame.length, 2) === 1 ? perFrame[middle] ?? 0 : ((perFrame[middle - 1] ?? 0) + (perFrame[middle] ?? 0)) / 2;
  const mean = perFrame.length === 0 ? 0 : total / perFrame.length;
  return `p${slot} ${name} start=${whole(values[0] ?? 0)} total=${whole(total)} median=${whole(median)} p95=${whole(rank(perFrame, f32(0.95)))} mean=${whole(mean)} max=${whole(rank(perFrame, 1))}`;
}

function costLines(cost: ClientCost, first: number, last: number, model: NativeCostModel): string[] {
  const callbacks: number[] = [];
  const typing: number[] = [];
  for (let frame = 0; frame <= last; frame++) {
    const predicted = nativeFrameCost(model, {
      instructions: cost.instructions[frame] ?? 0, natives: cost.natives[frame] ?? 0,
      allocatedKb: cost.allocatedKb[frame] ?? 0, typedCharacters: cost.typed[frame] ?? 0,
    });
    callbacks.push(predicted.callbacksUs);
    typing.push(predicted.typingUs);
  }
  const named: readonly (readonly [string, readonly number[]])[] = [
    ["instructions", cost.instructions], ["lua-us", cost.microseconds], ["natives", cost.natives],
    ["alloc-kb", cost.allocatedKb], ["typed", cost.typed], ["native-us", callbacks], ["typing-us", typing],
  ];
  return named.map(([name, values]) => valueLine(cost.slot, name, values, first, last));
}

/**
 * Measures every client's frames while `play` drives the clients of the
 * bundle and declarations at these paths, prints the result as `wisp perf`
 * reads it and returns how many problems `play` found.
 */
export function runLuaPerfWith(
  map: LuaHeadlessMap,
  bundlePath: string,
  declarationsPath: string,
  play: (this: void, clients: Lockstep, measure: PerfMeasure) => { readonly problems: number; readonly lines: readonly string[] },
  options: LuaPerfOptions = {},
): number {
  const declarations = readFile(declarationsPath);
  const costs = new Map<HeadlessClient, ClientCost>();
  const bySlot = new Map<number, ClientCost>();
  let fired = 0;
  const count = () => {
    fired++;
  };
  let nativeSeconds = 0;
  let depth = 0;
  let thread = nativeThread();
  let entered = { fired: 0, seconds: 0, natives: 0, calls: 0, kb: 0, nativeKb: 0 };
  let collectedKb = collectgarbage("count");
  /** The full collections between runs: their time and the kilobytes they freed. */
  const collector = { us: 0, kb: 0 };
  let clients: Lockstep | undefined;
  const scope: ClientScope = {
    enter: (client) => {
      const heap = collectgarbage("count");
      if (heap > collectedKb + COLLECT_EVERY_KB) {
        const started = os.clock();
        collectgarbage("collect");
        collectedKb = collectgarbage("count");
        collector.us += (os.clock() - started) * 1000000;
        collector.kb += heap - collectedKb;
      }
      collectgarbage("stop");
      const cost = costs.get(client);
      // Restarting the count makes each run's count its own instructions, whatever ran before it.
      debug.sethook(count, "", HOOK_STEP);
      entered = { fired, seconds: os.clock(), natives: nativeSeconds, calls: cost?.calls ?? 0, kb: collectgarbage("count"), nativeKb: cost?.nativeKb ?? 0 };
    },
    leave: (client) => {
      const seconds = os.clock();
      debug.sethook();
      const kb = collectgarbage("count");
      collectgarbage("restart");
      const cost = costs.get(client);
      if (cost === undefined) return;
      const frame = clients?.frame ?? 0;
      add(cost.instructions, frame, (fired - entered.fired) * HOOK_STEP);
      add(cost.microseconds, frame, (seconds - entered.seconds - (nativeSeconds - entered.natives)) * 1000000);
      add(cost.natives, frame, cost.calls - entered.calls);
      add(cost.allocatedKb, frame, kb - entered.kb - (cost.nativeKb - entered.nativeKb));
    },
  };
  const counted = (cost: ClientCost, native: Native): Native => (...args: unknown[]) => {
    cost.calls++;
    // A native that runs map code, which calls another, runs it where it is.
    if (depth > 0) return native(...args);
    depth++;
    const started = os.clock();
    const kb = collectgarbage("count");
    const [ran, result] = coroutine.resume(thread, native, ...args);
    cost.nativeKb += collectgarbage("count") - kb;
    nativeSeconds += os.clock() - started;
    depth--;
    if (!ran) {
      thread = nativeThread();
      error(result, 0);
    }
    return result;
  };
  const lockstep = luaLockstep(map, readFile(bundlePath), declarations, scope, options.delivery);
  clients = lockstep;
  const names = parseNativeDeclarations(declarations).functions.map(([name]) => name);
  for (const client of lockstep.clients) {
    const cost: ClientCost = { slot: client.slot, instructions: [], microseconds: [], natives: [], allocatedKb: [], typed: [], calls: 0, nativeKb: 0 };
    costs.set(client, cost);
    bySlot.set(client.slot, cost);
    for (const name of names) {
      const native = client.natives[name];
      if (typeof native === "function") client.natives[name] = counted(cost, native as Native);
    }
  }
  /** The first frame the summaries count. */
  let first = 1;
  const measure: PerfMeasure = {
    begin: () => {
      first = lockstep.frame + 1;
    },
    typed: (slot, characters) => {
      const cost = bySlot.get(slot);
      // Text typed now reaches the client before its next frame.
      if (cost !== undefined) add(cost.typed, lockstep.frame + 1, characters);
    },
  };
  let result: { readonly problems: number; readonly lines: readonly string[] };
  try {
    result = play(lockstep, measure);
  } finally {
    debug.sethook();
    collectgarbage("restart");
  }
  print(`frames ${lockstep.frame - first + 1} step ${HOOK_STEP} problems ${result.problems}`);
  // The collections between runs, all clients' garbage: this host's collector time per kilobyte.
  print(`collector us=${whole(collector.us)} kb=${whole(collector.kb)}`);
  const model = options.model ?? WARCRAFT_COST;
  for (const cost of costs.values()) for (const line of costLines(cost, first, lockstep.frame, model)) print(line);
  if (options.samples === true) {
    for (let frame = first; frame <= lockstep.frame; frame++) {
      for (const cost of costs.values()) {
        print(`frame ${frame} p${cost.slot} instructions=${cost.instructions[frame] ?? 0} lua-us=${whole(cost.microseconds[frame] ?? 0)} natives=${cost.natives[frame] ?? 0} alloc-bytes=${whole((cost.allocatedKb[frame] ?? 0) * 1024)} typed=${cost.typed[frame] ?? 0}`);
      }
    }
  }
  if (result.problems > 0) for (const line of result.lines) print(`journey: ${line}`);
  return result.problems;
}

/**
 * Plays `journey` with the bundle and declarations at these paths, measuring
 * every client's frames, prints the result as `wisp perf` reads it and
 * returns how many problems the journey found.
 */
export function runLuaPerf(map: LuaHeadlessMap, journey: Journey, bundlePath: string, declarationsPath: string, options: LuaPerfOptions = {}): number {
  return runLuaPerfWith(map, bundlePath, declarationsPath, (clients) => {
    const result: JourneyResult = runJourney(clients, journey, { checksums: false });
    return { problems: journeyProblems(result), lines: journeyLines(result) };
  }, options);
}
