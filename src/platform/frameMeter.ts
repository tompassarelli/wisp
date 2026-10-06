// The frame meter, for development and diagnostic builds
// (wisp:docs/frame-cost.md). It measures what each game frame costs: Lua time,
// calls to Warcraft's functions and the simulation frames the game caught up.
// A player can show it on screen, and after each hot reload every client
// writes the frames before and after the reload to a report the host prints.
//
// It changes no game code: it wraps the dispatch table's `run`, which every
// trampoline calls (wisp:src/platform/dispatch.ts), and, once at start, every
// global function whose name starts with a capital letter, Warcraft's natives
// and Blizzard.j's functions, with a counter. A build that never starts it
// carries none of it. Local to this client: it reads a clock, counts and
// writes a file, and nothing synchronized reads any of it; the overlay's frame
// is created on every client and only shown locally.
import { FILE_SLOTS } from "../runtime/gameFiles";
import { runtimeConfiguration } from "../runtime/config";
import { type FrameWindow, frameCostFile, frameCostHeading, frameWindowLine, reportNumber, spread } from "../runtime/frameCost";
import { f32 } from "../sim/f32";
import { floorMod } from "../sim/intMath";
import { on, trampoline } from "./dispatch";

/** Frames the overlay summarizes and each side of a reload's report covers: two seconds at 60 frames a second. */
export const FRAME_WINDOW = 120;
/** Frames between the overlay's updates, each of which sorts the window. */
const OVERLAY_FRAMES = 30;
/** Clock reads that may pass while finding its step before it counts as stopped. */
const CLOCK_READS = 1000000;
const TOGGLE = "wisp.frameMeter.toggle";

declare const os: { readonly clock?: (this: void) => number } | undefined;

export interface FrameMeterOptions {
  /** The handler the game runs once per frame, such as its 60 Hz timer's: each run ends a frame. */
  readonly frame: string;
  /** The game's simulation frame; what it advanced during a frame is that frame's catch-up. */
  readonly simulationFrame?: (this: void) => number;
  /** Chat text that shows or hides the overlay for the player who types it. */
  readonly toggle: string;
}

type Run = (this: void, name: string) => void;

interface DispatchTable {
  run: Run;
}

/** The last `values.length` samples, oldest overwritten first. */
interface Ring {
  readonly values: number[];
  next: number;
  count: number;
}

interface Window {
  readonly lua: Ring;
  readonly natives: Ring;
  readonly catchUp: Ring;
}

interface MeterState {
  readonly options: FrameMeterOptions;
  readonly clock: ((this: void) => number) | undefined;
  /** The clock's step in seconds; 0 without a clock. */
  readonly step: number;
  /** The bundle's own run, which the measured run calls. */
  plain: Run | undefined;
  measured: Run | undefined;
  /** Counted calls since start; frames take differences. */
  calls: number;
  /** The count when the current frame began. */
  frameCalls: number;
  /** Lua seconds the current frame's callbacks took. */
  lua: number;
  simulation: number;
  /** Every recent frame, for the overlay. */
  readonly recent: Window;
  /** The current version's frames, without the one it was installed in. */
  readonly current: Window;
  version: number;
  /** The previous version's frames, until the current version's window is full and the report is written. */
  before: { readonly version: number; readonly window: FrameWindow } | undefined;
  readonly overlay: framehandle;
  shown: boolean;
  frames: number;
}

const ring = (): Ring => ({ values: [], next: 0, count: 0 });
const emptyWindow = (): Window => ({ lua: ring(), natives: ring(), catchUp: ring() });

function push(target: Ring, value: number): void {
  target.values[target.next] = value;
  target.next = floorMod(target.next + 1, FRAME_WINDOW);
  if (target.count < FRAME_WINDOW) target.count++;
}

function clear(target: Window): void {
  for (const values of [target.lua, target.natives, target.catchUp]) {
    values.next = 0;
    values.count = 0;
  }
}

function summary(state: MeterState, source: Window): FrameWindow {
  return {
    frames: source.natives.count,
    lua: state.clock === undefined ? undefined : spread(source.lua.values, source.lua.count),
    natives: spread(source.natives.values, source.natives.count),
    catchUp: spread(source.catchUp.values, source.catchUp.count),
  };
}

function meter(): MeterState {
  const globals = globalThis as Record<`${string}FrameMeter`, MeterState | undefined>;
  const state = globals[`${runtimeConfiguration().globalPrefix}FrameMeter`];
  if (state === undefined) throw new Error("frame meter used before startFrameMeter");
  return state;
}

function dispatchTable(): DispatchTable {
  const globals = globalThis as Record<`${string}Dispatch`, DispatchTable | undefined>;
  const table = globals[`${runtimeConfiguration().globalPrefix}Dispatch`];
  if (table === undefined) throw new Error("frame meter installed before installDispatch");
  return table;
}

/** The hot-reload version this client runs: 0 for the map's own bundle or without the reloader. */
function installedVersion(): number {
  const globals = globalThis as Record<`${string}Hot`, { readonly applied: number } | undefined>;
  return globals[`${runtimeConfiguration().globalPrefix}Hot`]?.applied ?? 0;
}

/** The clock and its step: the smallest change two reads in a row show. */
function findClock(): { clock: ((this: void) => number) | undefined; step: number } {
  if (typeof os !== "object" || os === null || typeof os.clock !== "function") return { clock: undefined, step: 0 };
  const clock = os.clock;
  let changes = 0;
  let step = 0;
  let last = clock();
  for (let reads = 0; reads < CLOCK_READS && changes < 2; reads++) {
    const now = clock();
    if (now === last) continue;
    // The first change ends a step begun before the first read; the second is a whole step.
    if (changes > 0) step = now - last;
    changes++;
    last = now;
  }
  return changes < 2 ? { clock: undefined, step: 0 } : { clock, step };
}

const milliseconds = (microseconds: number) => reportNumber(microseconds / 1000);

/** The 95th percentile of a ring's values, nearest rank: what a cost model's p95 is checked against. */
function ninetyFifth(source: Ring): number {
  const sorted: number[] = [];
  for (let index = 0; index < source.count; index++) sorted.push(source.values[index] ?? 0);
  sorted.sort((left, right) => left - right);
  return sorted[Math.max(0, Math.ceil(f32(0.95) * sorted.length) - 1)] ?? 0;
}

function overlayText(state: MeterState): string {
  const { lua, natives, catchUp, frames } = summary(state, state.recent);
  const time = lua === undefined
    ? "Lua: no clock"
    : `Lua ms: ${milliseconds(lua.median * 1000000)} / ${milliseconds(ninetyFifth(state.recent.lua) * 1000000)} / ${milliseconds(lua.max * 1000000)} (clock step ${state.step * 100000 < 1 ? "under 0.01" : milliseconds(state.step * 1000000)} ms)`;
  return `frame cost, last ${frames} frames, median / p95 / max\n${time}\nnatives: ${reportNumber(natives.median)} / ${reportNumber(ninetyFifth(state.recent.natives))} / ${reportNumber(natives.max)}\ncatch-up frames: ${reportNumber(catchUp.median)} / ${reportNumber(ninetyFifth(state.recent.catchUp))} / ${reportNumber(catchUp.max)}`;
}

function microseconds(window: FrameWindow): FrameWindow {
  const { lua } = window;
  return lua === undefined ? window : { ...window, lua: { median: lua.median * 1000000, mean: lua.mean * 1000000, max: lua.max * 1000000 } };
}

function writeReport(state: MeterState, before: { readonly version: number; readonly window: FrameWindow }): void {
  PreloadGenClear();
  PreloadGenStart();
  Preload(frameCostHeading(state.version, before.version, state.step * 1000000));
  Preload(frameWindowLine("before", microseconds(before.window)));
  Preload(frameWindowLine("after", microseconds(summary(state, state.current))));
  PreloadGenEnd(frameCostFile(GetPlayerId(GetLocalPlayer()), runtimeConfiguration().filePrefix));
}

/** Ends a frame: its sample, the reload report once due, the overlay. The meter's own calls are not the game's. */
function endFrame(state: MeterState): void {
  const calls = state.calls - state.frameCalls;
  const read = state.options.simulationFrame;
  const simulation = read === undefined ? 0 : read();
  // A simulation that restarts, as at a rematch, caught up nothing.
  const catchUp = simulation > state.simulation ? simulation - state.simulation : 0;
  state.simulation = simulation;
  push(state.recent.lua, state.lua);
  push(state.recent.natives, calls);
  push(state.recent.catchUp, catchUp);
  const version = installedVersion();
  if (version !== state.version) {
    // This frame installed the version: its cost is the reload's, not either version's.
    state.before = { version: state.version, window: summary(state, state.current) };
    state.version = version;
    clear(state.current);
  } else {
    push(state.current.lua, state.lua);
    push(state.current.natives, calls);
    push(state.current.catchUp, catchUp);
    const before = state.before;
    if (before !== undefined && state.current.natives.count >= FRAME_WINDOW) {
      state.before = undefined;
      writeReport(state, before);
    }
  }
  state.frames++;
  if (state.shown && floorMod(state.frames, OVERLAY_FRAMES) === 0) BlzFrameSetText(state.overlay, overlayText(state));
  state.lua = 0;
  state.frameCalls = state.calls;
}

function measure(state: MeterState, name: string): void {
  const run = state.plain;
  if (run === undefined) return;
  const clock = state.clock;
  if (clock === undefined) run(name);
  else {
    const started = clock();
    run(name);
    state.lua += clock() - started;
  }
  if (name === state.options.frame) endFrame(state);
}

function toggle(): void {
  const state = meter();
  const calls = state.calls;
  if (GetTriggerPlayer() !== GetLocalPlayer()) {
    state.frameCalls += state.calls - calls;
    return;
  }
  state.shown = !state.shown;
  if (state.shown) BlzFrameSetText(state.overlay, overlayText(state));
  BlzFrameSetVisible(state.overlay, state.shown);
  // Showing the overlay is the meter's work, not the frame's.
  state.frameCalls += state.calls - calls;
}

/** Counts every call of each global function whose name starts with a capital letter. */
function countCalls(state: MeterState): void {
  const globals = globalThis as Record<string, unknown>;
  // Only in Lua: a JavaScript host's global object holds its own capitalized constructors, which must stay untouched.
  if (typeof globals._VERSION !== "string") return;
  const names: string[] = [];
  for (const name in globals) {
    const first = name.charCodeAt(0);
    if (first >= 65 && first <= 90 && typeof globals[name] === "function") names.push(name);
  }
  for (const name of names) {
    const native = globals[name] as (this: void, ...args: unknown[]) => unknown;
    globals[name] = (...args: unknown[]) => {
      state.calls++;
      return native(...args);
    };
  }
}

function createOverlay(): framehandle {
  const frame = BlzCreateFrameByType("TEXT", "WispFrameMeter", BlzGetOriginFrame(ORIGIN_FRAME_GAME_UI, 0), "", 0);
  BlzFrameSetAbsPoint(frame, FRAMEPOINT_TOPLEFT, f32(0.58), f32(0.56));
  BlzFrameSetSize(frame, f32(0.21), f32(0.08));
  BlzFrameSetFont(frame, "Fonts\\FRIZQT__.TTF", f32(0.009), 0);
  BlzFrameSetTextAlignment(frame, TEXT_JUSTIFY_TOP, TEXT_JUSTIFY_LEFT);
  BlzFrameSetVisible(frame, false);
  return frame;
}

/**
 * Makes the dispatch table's run measure every callback and registers the
 * overlay's toggle. Call in every install(), after installDispatch(): a
 * reloaded bundle installs its own run.
 */
export function installFrameMeter(): void {
  const globals = globalThis as Record<`${string}FrameMeter`, MeterState | undefined>;
  const state = globals[`${runtimeConfiguration().globalPrefix}FrameMeter`];
  if (state === undefined) return;
  const table = dispatchTable();
  if (table.run !== state.measured) state.plain = table.run;
  const measured: Run = (name) => measure(state, name);
  state.measured = measured;
  table.run = measured;
  on(TOGGLE, toggle);
}

/**
 * Starts measuring and creates the overlay, hidden. Call once at match start,
 * after the first install(), in every client.
 */
export function startFrameMeter(options: FrameMeterOptions): void {
  const configuration = runtimeConfiguration();
  const globals = globalThis as Record<`${string}FrameMeter`, MeterState | undefined>;
  const key = `${configuration.globalPrefix}FrameMeter` as const;
  if (globals[key] !== undefined) return;
  const { clock, step } = findClock();
  const read = options.simulationFrame;
  const state: MeterState = {
    options, clock, step, plain: undefined, measured: undefined, calls: 0, frameCalls: 0, lua: 0,
    simulation: read === undefined ? 0 : read(), recent: emptyWindow(), current: emptyWindow(), version: installedVersion(),
    before: undefined, overlay: createOverlay(), shown: false, frames: 0,
  };
  globals[key] = state;
  countCalls(state);
  installFrameMeter();
  const trigger = CreateTrigger();
  for (let slot = 0; slot < FILE_SLOTS; slot++) TriggerRegisterPlayerChatEvent(trigger, Player(slot), options.toggle, true);
  TriggerAddAction(trigger, trampoline(TOGGLE));
}
