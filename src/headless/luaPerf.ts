import { type ClientScope, type HeadlessClient } from "./client";
import { parseNativeDeclarations } from "./declarations";
import { type Journey, type JourneyResult, journeyLines, journeyProblems, runJourney } from "./journey";
import { Lockstep, type SyncDelivery } from "./lockstep";
import { type LuaHeadlessMap, luaLockstep, readFile } from "./lua";
import { type NativeCostModel, WARCRAFT_COST, nativeFrameCost } from "./nativeCost";
import { f32 } from "../sim/f32";
import { floorDiv, floorMod } from "../sim/intMath";
import { PERF_COLLECTOR_VARIABLE, type PerfCollector } from "./perfCollector";

export const HOOK_STEP = 100;

const COLLECT_AT_LEAST_KB = 16384;

type Native = (this: void, ...args: unknown[]) => unknown;

declare global {
  // Wisp's Lua32 counts requested bytes in a wrapping integer (native/requested-bytes.h).
  function collectgarbage(option: "requested"): number;
  function collectgarbage(option: "step", size: number): boolean;
}

const requested = () => collectgarbage("requested");

const kilobytes = (bytes: number) => bytes / 1024;

interface ClientCost {
  readonly slot: number;
  readonly instructions: number[];
  readonly microseconds: number[];
  readonly callbacks: number[];
  readonly natives: number[];
  readonly allocatedBytes: number[];
  readonly runtimeInstructions: number[];
  readonly runtimeBytes: number[];
  readonly moduleBytes: Map<string, number[]>;
  readonly typed: number[];
  calls: number;

  nativeBytes: number;
}

export interface PerfMeasure {

  typed(this: void, slot: number, characters: number): void;

  begin(this: void): void;
}

export interface LuaPerfOptions {

  readonly model?: NativeCostModel;

  readonly samples?: boolean;

  readonly delivery?: SyncDelivery;

  readonly collector?: PerfCollector;
}

const collectorFromEnvironment = (): PerfCollector => (os.getenv(PERF_COLLECTOR_VARIABLE) === "incremental" ? "incremental" : "stopped");

function callbackLine(cost: ClientCost): string {
  const sorted = [...cost.callbacks].sort((left, right) => left - right);
  let over = 0;
  for (const value of sorted) if (value >= 100000) over++;
  return `callback p${cost.slot} count=${sorted.length} median-us=${whole(rank(sorted, f32(0.5)))} p99-us=${whole(rank(sorted, f32(0.99)))} max-us=${whole(rank(sorted, 1))} over-100ms=${over}`;
}

function cycleLine(): string {
  collectgarbage("collect");
  const heap = collectgarbage("count");
  collectgarbage("stop");
  const steps: number[] = [];
  let total = 0;
  let done = false;
  while (!done && steps.length < 1000000) {
    const started = os.clock();
    done = collectgarbage("step", 0);
    const us = (os.clock() - started) * 1000000;
    steps.push(us);
    total += us;
  }
  const sorted = [...steps].sort((left, right) => left - right);
  return `cycle kb=${whole(heap)} steps=${steps.length} us=${whole(total)} step-median-us=${whole(rank(sorted, f32(0.5)))} step-max-us=${whole(rank(sorted, 1))}`;
}

// Varargs retain nil arguments; tail calls keep the native coroutine one frame deep.

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

const whole = (value: number) => `${Math.floor(value + 0.5)}`;

function rank(sorted: readonly number[], share: number): number {
  if (sorted.length === 0) return 0;
  const index = Math.max(0, Math.min(sorted.length - 1, Math.ceil(share * sorted.length) - 1));
  return sorted[index] ?? 0;
}

function bundleModules(bundle: string): string[] {
  const modules: string[] = [];
  let name = "(bundle)";
  let line = 0;
  for (const text of bundle.split("\n")) {
    line++;
    const [header] = string.match(text, '^%["(.-)"%] = function%(%.%.%.%) $');
    if (header !== undefined) name = header;
    modules[line] = name;
  }
  return modules;
}

export const TOP_SHARE = f32(0.01);

function topMean(sorted: readonly number[]): number {
  if (sorted.length === 0) return 0;
  const count = Math.max(1, Math.ceil(TOP_SHARE * sorted.length));
  let sum = 0;
  for (let index = sorted.length - count; index < sorted.length; index++) sum += sorted[index] ?? 0;
  return sum / count;
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
  return `p${slot} ${name} start=${whole(values[0] ?? 0)} total=${whole(total)} median=${whole(median)} p95=${whole(rank(perFrame, f32(0.95)))} mean=${whole(mean)} max=${whole(rank(perFrame, 1))} top=${whole(topMean(perFrame))}`;
}

const sum = (values: readonly number[], first: number, last: number): number => {
  let total = 0;
  for (let frame = first; frame <= last; frame++) total += values[frame] ?? 0;
  return total;
};

function moduleLines(cost: ClientCost, first: number, last: number): string[] {
  const names: string[] = [];
  for (const [name] of cost.moduleBytes) names.push(name);
  names.sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));
  const frames = Math.max(1, last - first + 1);
  return names.map((name) => {
    const bytes = sum(cost.moduleBytes.get(name) ?? [], first, last);
    return `p${cost.slot} module-alloc-bytes ${name} total=${whole(bytes)} mean=${whole(bytes / frames)}`;
  });
}

function costLines(cost: ClientCost, first: number, last: number, model: NativeCostModel): string[] {
  const allocatedKb: number[] = [];
  const runtimeKb: number[] = [];
  const callbacks: number[] = [];
  const typing: number[] = [];
  for (let frame = 0; frame <= last; frame++) {
    allocatedKb.push(kilobytes(cost.allocatedBytes[frame] ?? 0));
    runtimeKb.push(kilobytes(cost.runtimeBytes[frame] ?? 0));
    const predicted = nativeFrameCost(model, {
      instructions: cost.instructions[frame] ?? 0, natives: cost.natives[frame] ?? 0,
      allocatedKb: allocatedKb[frame] ?? 0, typedCharacters: cost.typed[frame] ?? 0,
    });
    callbacks.push(predicted.callbacksUs);
    typing.push(predicted.typingUs);
  }
  const named: readonly (readonly [string, readonly number[]])[] = [
    ["instructions", cost.instructions], ["lua-us", cost.microseconds], ["natives", cost.natives],
    ["alloc-kb", allocatedKb], ["typed", cost.typed], ["native-us", callbacks], ["typing-us", typing],
    ["runtime-instructions", cost.runtimeInstructions], ["runtime-alloc-kb", runtimeKb],
  ];
  return [...named.map(([name, values]) => valueLine(cost.slot, name, values, first, last)), ...moduleLines(cost, first, last)];
}

export function runLuaPerfWith(
  map: LuaHeadlessMap,
  bundlePath: string,
  declarationsPath: string,
  play: (this: void, clients: Lockstep, measure: PerfMeasure) => { readonly problems: number; readonly lines: readonly string[] },
  options: LuaPerfOptions = {},
): number {
  const declarations = readFile(declarationsPath);
  const incremental = (options.collector ?? collectorFromEnvironment()) === "incremental";
  const costs = new Map<HeadlessClient, ClientCost>();
  const bySlot = new Map<number, ClientCost>();
  const runtimeSource = debug.getinfo(1, "S")?.source;
  const moduleOfLine = bundleModules(readFile(bundlePath));
  let active: ClientCost | undefined;
  let lastBytes = 0;
  let lastNativeBytes = 0;
  // Level 1 is this hook, level 2 the Lua function the count interrupted.
  const count = () => {
    const bytesNow = requested();
    const info = debug.getinfo(2, "Sl");
    const cost = active;
    if (cost !== undefined && info !== undefined) {
      const frame = clients?.frame ?? 0;
      const bytes = bytesNow - lastBytes - (cost.nativeBytes - lastNativeBytes);
      const source = info.source ?? "";
      if (source === runtimeSource) {
        add(cost.runtimeInstructions, frame, HOOK_STEP);
        add(cost.runtimeBytes, frame, bytes);
      } else {
        add(cost.instructions, frame, HOOK_STEP);
        add(cost.allocatedBytes, frame, bytes);
        const name = source === "=map" ? moduleOfLine[info.currentline ?? 0] ?? "(bundle)" : source;
        let series = cost.moduleBytes.get(name);
        if (series === undefined) {
          series = [];
          cost.moduleBytes.set(name, series);
        }
        add(series, frame, bytes);
      }
      lastNativeBytes = cost.nativeBytes;
    }
    lastBytes = requested();
    // Instructions run inside the hook use up the count; setting it again restarts the full step.
    debug.sethook(count, "", HOOK_STEP);
  };
  let nativeSeconds = 0;
  let depth = 0;
  let thread = nativeThread();
  let entered = { seconds: 0, natives: 0, calls: 0 };
  let collectedKb = collectgarbage("count");

  const collector = { us: 0, kb: 0 };
  let clients: Lockstep | undefined;
  const scope: ClientScope = {
    enter: (client) => {
      if (incremental) {
        const cost = costs.get(client);
        active = cost;
        lastBytes = requested();
        lastNativeBytes = cost?.nativeBytes ?? 0;
        entered = { seconds: os.clock(), natives: nativeSeconds, calls: cost?.calls ?? 0 };
        return;
      }
      const heap = collectgarbage("count");
      if (heap > collectedKb + Math.max(COLLECT_AT_LEAST_KB, collectedKb)) {
        const started = os.clock();
        collectgarbage("collect");
        collectedKb = collectgarbage("count");
        collector.us += (os.clock() - started) * 1000000;
        collector.kb += heap - collectedKb;
      }
      collectgarbage("stop");
      const cost = costs.get(client);
      active = cost;
      lastBytes = requested();
      lastNativeBytes = cost?.nativeBytes ?? 0;
      debug.sethook(count, "", HOOK_STEP);
      entered = { seconds: os.clock(), natives: nativeSeconds, calls: cost?.calls ?? 0 };
    },
    leave: (client) => {
      const seconds = os.clock();
      debug.sethook();
      const bytes = requested();
      active = undefined;
      const cost = costs.get(client);
      if (cost === undefined) return;
      const frame = clients?.frame ?? 0;
      add(cost.microseconds, frame, (seconds - entered.seconds - (nativeSeconds - entered.natives)) * 1000000);
      if (incremental) {
        cost.callbacks.push((seconds - entered.seconds) * 1000000);
        add(cost.allocatedBytes, frame, bytes - lastBytes - (cost.nativeBytes - lastNativeBytes));
        add(cost.natives, frame, cost.calls - entered.calls);
        return;
      }
      add(cost.natives, frame, cost.calls - entered.calls);
      add(cost.runtimeBytes, frame, bytes - lastBytes - (cost.nativeBytes - lastNativeBytes));
    },
  };
  const counted = (cost: ClientCost, native: Native): Native => (...args: unknown[]) => {
    cost.calls++;

    if (depth > 0) return native(...args);
    depth++;
    const started = os.clock();
    const bytes = requested();
    const [ran, result] = coroutine.resume(thread, native, ...args);
    cost.nativeBytes += requested() - bytes;
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
    const cost: ClientCost = { slot: client.slot, instructions: [], microseconds: [], callbacks: [], natives: [], allocatedBytes: [], runtimeInstructions: [], runtimeBytes: [], moduleBytes: new Map(), typed: [], calls: 0, nativeBytes: 0 };
    costs.set(client, cost);
    bySlot.set(client.slot, cost);
    for (const name of names) {
      const native = client.natives[name];
      if (typeof native === "function") client.natives[name] = counted(cost, native as Native);
    }
  }

  let first = 1;
  const measure: PerfMeasure = {
    begin: () => {
      first = lockstep.frame + 1;
    },
    typed: (slot, characters) => {
      const cost = bySlot.get(slot);

      if (cost !== undefined) add(cost.typed, lockstep.frame + 1, characters);
    },
  };
  let result: { readonly problems: number; readonly lines: readonly string[] };
  collectgarbage("collect");
  if (incremental) collectgarbage("restart");
  else collectgarbage("stop");
  collectedKb = collectgarbage("count");
  try {
    result = play(lockstep, measure);
  } finally {
    debug.sethook();
    collectgarbage("restart");
  }
  print(`frames ${lockstep.frame - first + 1} step ${HOOK_STEP} problems ${result.problems}`);

  print(`collector us=${whole(collector.us)} kb=${whole(collector.kb)}`);
  if (incremental) {
    for (const cost of costs.values()) print(callbackLine(cost));
    print(cycleLine());
    collectgarbage("restart");
  }
  const model = options.model ?? WARCRAFT_COST;
  for (const cost of costs.values()) for (const line of costLines(cost, first, lockstep.frame, model)) print(line);
  if (options.samples === true) {
    for (let frame = first; frame <= lockstep.frame; frame++) {
      for (const cost of costs.values()) {
        print(`frame ${frame} p${cost.slot} instructions=${cost.instructions[frame] ?? 0} lua-us=${whole(cost.microseconds[frame] ?? 0)} natives=${cost.natives[frame] ?? 0} alloc-bytes=${cost.allocatedBytes[frame] ?? 0} typed=${cost.typed[frame] ?? 0}`);
      }
    }
  }
  if (result.problems > 0) for (const line of result.lines) print(`journey: ${line}`);
  return result.problems;
}

export function runLuaPerf(map: LuaHeadlessMap, journey: Journey, bundlePath: string, declarationsPath: string, options: LuaPerfOptions = {}): number {
  return runLuaPerfWith(map, bundlePath, declarationsPath, (clients) => {
    const result: JourneyResult = runJourney(clients, journey, { checksums: false });
    return { problems: journeyProblems(result), lines: journeyLines(result) };
  }, options);
}

export const OUTSIDE_MAP = -1;

export interface AllocationSampler {

  start(this: void, into: Map<number, [self: number, inclusive: number]>): void;

  stop(this: void): void;
}

export function allocationSampler(source = "=map"): AllocationSampler {
  let into: Map<number, [number, number]> | undefined;
  let mark = 0;
  const charge = (line: number, bytes: number, self: boolean) => {
    if (into === undefined || bytes === 0) return;
    let entry = into.get(line);
    if (entry === undefined) {
      entry = [0, 0];
      into.set(line, entry);
    }
    if (self) entry[0] += bytes;
    entry[1] += bytes;
  };
  // A count hook every instruction runs before the next one, so level 2 is the function whose instruction just allocated.
  const sample = () => {
    const bytes = requested() - mark;
    if (bytes !== 0) {
      const top = debug.getinfo(2, "S");
      if (top === undefined || top.source !== source) charge(OUTSIDE_MAP, bytes, true);
      else {
        const seen = new Set<number>();
        for (let level = 2; ; level++) {
          const info = debug.getinfo(level, "S");
          if (info === undefined) break;
          if (info.source !== source) continue;
          const line = info.linedefined ?? 0;
          if (seen.has(line)) continue;
          charge(line, bytes, seen.size === 0);
          seen.add(line);
        }
      }
    }
    mark = requested();
  };
  return {
    start: (target) => {
      into = target;
      mark = requested();
      debug.sethook(sample, "", 1);
    },
    stop: () => {
      debug.sethook();
      charge(OUTSIDE_MAP, requested() - mark, true);
      into = undefined;
    },
  };
}
