






import { type FrameWork, type NativeCostModel, nativeFrameCost } from "../../src/headless/nativeCost";
import { type FrameCostCapture, parseFrameCostCapture } from "./frameCostCapture";


export const NATIVE_TOLERANCE = 0.2;


const WINDOW_FRAMES = 120;
const WINDOW_STRIDE = 30;


export const NATIVE_CLOCK_STEP_MS = 0.97656;


export interface OverlayWindow {
  readonly median: number;
  readonly p95?: number;
  readonly max: number;
}

export interface NativeReadings {
  readonly windows: readonly OverlayWindow[];

  readonly clockStepMs: number;
}


export interface WindowSummary {
  readonly median: number;
  readonly p95?: number;
  readonly max: number;
  readonly windows: number;
}

const record = (value: unknown): Record<string, unknown> => (typeof value === "object" && value !== null ? value as Record<string, unknown> : {});
const finite = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : undefined);






export function parseNativeReadings(text: string): NativeReadings {
  if (text.trimStart().startsWith("function PreloadFiles")) return frameCostCaptureReadings(parseFrameCostCapture(text));
  const root = record(JSON.parse(text));
  const overlay = root["frame_cost_overlay"] === undefined ? root : record(root["frame_cost_overlay"]);
  const listed = overlay["windows"];
  if (!Array.isArray(listed)) throw new Error("no overlay windows: expected windows[] or frame_cost_overlay.windows[]");
  const windows = listed.flatMap((entry): OverlayWindow[] => {
    const window = record(entry)["lua_ms"] === undefined ? record(entry) : record(record(entry)["lua_ms"]);
    const median = finite(window["median"]);
    const max = finite(window["max"]);
    const p95 = finite(window["p95"]);
    return median === undefined || max === undefined ? [] : [p95 === undefined ? { median, max } : { median, p95, max }];
  });
  if (windows.length === 0) throw new Error("no overlay window has a median and a maximum");
  return { windows, clockStepMs: finite(overlay["clockStepMs"]) ?? NATIVE_CLOCK_STEP_MS };
}

const SAMPLE = /^frame (\d+) p(\d+) instructions=(\d+) lua-us=\d+ natives=(\d+) alloc-bytes=(\d+) typed=(\d+)$/;


export function parsePerfSamples(text: string): Map<number, FrameWork[]> {
  const bySlot = new Map<number, FrameWork[]>();
  for (const line of text.split(/\r?\n/)) {
    const match = SAMPLE.exec(line);
    if (match === null) continue;
    const [, , slot, instructions, natives, bytes, typed] = match;
    const frames = bySlot.get(Number(slot)) ?? [];
    frames.push({ instructions: Number(instructions), natives: Number(natives), allocatedKb: Number(bytes) / 1024, typedCharacters: Number(typed) });
    bySlot.set(Number(slot), frames);
  }
  return bySlot;
}

const sorted = (values: readonly number[]) => [...values].sort((a, b) => a - b);

const median = (values: readonly number[]) => {
  const order = sorted(values);
  const middle = Math.floor(order.length / 2);
  return order.length % 2 === 1 ? order[middle]! : (order[middle - 1]! + order[middle]!) / 2;
};

const rank = (values: readonly number[], share: number) => {
  const order = sorted(values);
  return order[Math.max(0, Math.min(order.length - 1, Math.ceil(share * order.length) - 1))]!;
};


export function frameCostCaptureReadings(capture: FrameCostCapture): NativeReadings {
  const times = capture.samples.map(({ luaUs }) => luaUs / 1000);
  const windows: OverlayWindow[] = [];
  for (let end = WINDOW_FRAMES; end <= times.length; end += WINDOW_STRIDE) {
    const values = times.slice(end - WINDOW_FRAMES, end);
    windows.push({ median: median(values), p95: rank(values, 0.95), max: Math.max(...values) });
  }
  if (windows.length === 0) throw new Error("frame capture needs at least 120 samples for native calibration");
  return { windows, clockStepMs: capture.clockStepUs / 1000 };
}







export function overlayWindows(frameUs: readonly number[], clockStepMs: number): OverlayWindow[] {
  const step = clockStepMs * 1000;
  let seed = 12345;
  const next = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  const read = frameUs.map((us) => step * Math.floor(next() + us / step) / 1000);
  const windows: OverlayWindow[] = [];
  for (let end = WINDOW_FRAMES; end <= read.length; end += WINDOW_STRIDE) {
    const window = read.slice(end - WINDOW_FRAMES, end);
    windows.push({ median: median(window), p95: rank(window, 0.95), max: Math.max(...window) });
  }
  return windows;
}

export function summarizeWindows(windows: readonly OverlayWindow[]): WindowSummary {
  const p95s = windows.flatMap((window) => (window.p95 === undefined ? [] : [window.p95]));
  return {
    median: median(windows.map((window) => window.median)),
    ...(p95s.length === windows.length ? { p95: median(p95s) } : {}),
    max: median(windows.map((window) => window.max)),
    windows: windows.length,
  };
}


export const predictedOverlay = (model: NativeCostModel, frames: readonly FrameWork[], clockStepMs: number) =>
  summarizeWindows(overlayWindows(frames.map((work) => nativeFrameCost(model, work).callbacksUs), clockStepMs));

export interface NativeCase {
  readonly name: string;
  readonly frames: readonly FrameWork[];
  readonly readings: NativeReadings;
}

export interface NativeCheck {
  readonly name: string;
  readonly native: WindowSummary;
  readonly predicted: WindowSummary;

  readonly errors: { readonly median: number; readonly p95?: number; readonly max: number };

  readonly passed: boolean;
}

export function checkNative(model: NativeCostModel, item: NativeCase): NativeCheck {
  const native = summarizeWindows(item.readings.windows);
  const predicted = predictedOverlay(model, item.frames, item.readings.clockStepMs);
  const error = (a: number, b: number) => a / b - 1;
  const p95 = native.p95 === undefined || predicted.p95 === undefined ? undefined : error(predicted.p95, native.p95);
  const errors = { median: error(predicted.median, native.median), ...(p95 === undefined ? {} : { p95 }), max: error(predicted.max, native.max) };
  const passed = Math.abs(errors.median) <= NATIVE_TOLERANCE && p95 !== undefined && Math.abs(p95) <= NATIVE_TOLERANCE;
  return { name: item.name, native, predicted, errors, passed };
}

const percent = (share: number) => `${share >= 0 ? "+" : ""}${(share * 100).toFixed(0)}%`;
const ms = (value: number) => value.toFixed(2);


export function nativeCheckLines(check: NativeCheck): string[] {
  const { native, predicted, errors } = check;
  return [
    `${check.name}: ${native.windows} native windows, ${predicted.windows} predicted; ms per frame, median of windows, native -> predicted`,
    `  median ${ms(native.median)} -> ${ms(predicted.median)} (${percent(errors.median)})`,
    native.p95 === undefined ? "  p95 not in the readings: the overlay that took them showed none" : `  p95 ${ms(native.p95)} -> ${ms(predicted.p95 ?? 0)} (${percent(errors.p95 ?? 0)})`,
    `  max ${ms(native.max)} -> ${ms(predicted.max)} (${percent(errors.max)})`,
    `  ${check.passed ? "PASS" : "FAIL"}: median${native.p95 === undefined ? "" : " and p95"} within ${NATIVE_TOLERANCE * 100}%${native.p95 === undefined ? "; p95 unchecked" : ""}`,
  ];
}


const MAX_WEIGHT = 0.25;


function misfit(model: NativeCostModel, cases: readonly NativeCase[]): number {
  let total = 0;
  for (const item of cases) {
    const native = summarizeWindows(item.readings.windows);
    const predicted = predictedOverlay(model, item.frames, item.readings.clockStepMs);
    total += Math.log(predicted.median / native.median) ** 2;
    if (native.p95 !== undefined && predicted.p95 !== undefined) total += Math.log(predicted.p95 / native.p95) ** 2;
    total += MAX_WEIGHT * Math.log(predicted.max / native.max) ** 2;
  }
  return total;
}






export function fitNativeCost(base: NativeCostModel, cases: readonly NativeCase[]): NativeCostModel {
  let best = { model: base, misfit: Number.POSITIVE_INFINITY };
  const tryCosts = (call: number, collector: number) => {
    if (call < 0 || call > 6 || collector < 0 || collector > 12) return;
    const model = { ...base, nativeCallUs: call, collectorUsPerKb: collector };
    const value = misfit(model, cases);
    if (value < best.misfit) best = { model, misfit: value };
  };

  for (let call = 0; call <= 6; call++) for (let collector = 0; collector <= 12; collector++) tryCosts(call, collector);
  const { nativeCallUs, collectorUsPerKb } = best.model;
  for (let call = -4; call <= 4; call++) for (let collector = -4; collector <= 4; collector++) tryCosts(nativeCallUs + call / 4, collectorUsPerKb + collector / 4);
  return best.model;
}
