import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import * as BunRuntime from "@effect/platform-bun/BunRuntime";
import { Effect } from "effect";
import { decodePpm, encodePpm, type Frame } from "../contract/services";
import { runTool } from "../os/warcraft/desktopClient";
import { DesktopFailure } from "../contract/client";
import { openKeyboard } from "./xtest";

export const WINDOW_KINDS = ["chrome", "warcraft", "native", "reference"] as const;
export type WindowKind = (typeof WINDOW_KINDS)[number];

export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface PressLatencyOptions {
  readonly window: WindowKind;
  readonly display: string;
  readonly waylandRuntime: string;
  readonly key: string;
  readonly region: Rect;
  readonly control: Rect;
  readonly trials: number;
  readonly out: string;
  readonly grim: string;
  readonly settleMs: number;
}

/** One screen grab. The compositor answers a grab with the next frame it draws, so `afterNs` stamps that frame to within the time grim takes to hand it over. */
export interface Sample {
  readonly frame: Frame;
  readonly beforeNs: number;
  readonly afterNs: number;
}

export interface Trial {
  readonly idleChanged: number;
  readonly threshold: number;
  readonly changed: number | undefined;
  readonly controlChanged: number | undefined;
  readonly lowerMs: number | undefined;
  readonly upperMs: number | undefined;
  readonly bracketMs: number | undefined;
  readonly skippedFrames: number | undefined;
  readonly frameMs: number;
  readonly pressMs: number;
}

const BASELINE_MS = 300;
const WATCH_MS = 600;
const CHANNEL_STEP = 40;
const MIN_CHANGED = 300;
const TAP_MS = 50;
const LEAD_MS = 100;
const SKIPPED_FRAME = 1.5;
const QUIET_CHANGED = 1000;
const QUIET_TRIES = 30;
const CONTROL_CHANGED = 100;

const nowNs = () => Number(process.hrtime.bigint());

function parseRect(text: string): Rect | undefined {
  const numbers = text.split(",").map(Number);
  const [x, y, width, height] = numbers;
  if (numbers.length !== 4 || x === undefined || y === undefined || width === undefined || height === undefined) return undefined;
  if (!numbers.every(Number.isInteger) || x < 0 || y < 0 || width < 1 || height < 1) return undefined;
  return { x, y, width, height };
}

/** Pixels in `rect` whose largest channel step between the two frames exceeds `CHANNEL_STEP`. */
export function changedPixels(reference: Frame, frame: Frame, rect: Rect): number {
  let count = 0;
  for (let row = rect.y; row < Math.min(rect.y + rect.height, reference.height); row++) {
    for (let column = rect.x; column < Math.min(rect.x + rect.width, reference.width); column++) {
      const index = (row * reference.width + column) * 3;
      const step = Math.max(
        Math.abs(reference.rgb[index]! - frame.rgb[index]!),
        Math.abs(reference.rgb[index + 1]! - frame.rgb[index + 1]!),
        Math.abs(reference.rgb[index + 2]! - frame.rgb[index + 2]!),
      );
      if (step > CHANNEL_STEP) count++;
    }
  }
  return count;
}

export interface Response {
  readonly reference: number;
  readonly index: number;
  readonly changed: number;
  readonly lowerMs: number;
  readonly upperMs: number;
  readonly bracketMs: number;
}

/**
 * The first grab after the press whose `region` passes `threshold` changed pixels, against the last grab drawn before the press.
 * The change appeared in a frame after the previous grab's and no later than this grab's, so it lies between their stamps:
 * a bracket one display frame wide when the grabs caught consecutive frames, wider when the harness missed some.
 */
export function response(samples: readonly Sample[], region: Rect, threshold: number, pressNs: number): Response | undefined {
  const reference = samples.findLastIndex((sample) => sample.afterNs <= pressNs);
  if (reference < 0) return undefined;
  for (let index = reference + 1; index < samples.length; index++) {
    const sample = samples[index]!;
    const changed = changedPixels(samples[reference]!.frame, sample.frame, region);
    if (changed <= threshold) continue;
    const previous = samples[index - 1]!;
    return {
      reference, index, changed,
      lowerMs: Math.max(0, previous.afterNs - pressNs) / 1e6,
      upperMs: (sample.afterNs - pressNs) / 1e6,
      bracketMs: (sample.afterNs - previous.afterNs) / 1e6,
    };
  }
  return undefined;
}

/** The display frame period the grabs saw: the median gap between consecutive grab stamps. */
export function framePeriodMs(samples: readonly Sample[]): number {
  return percentile(samples.slice(1).map((sample, index) => (sample.afterNs - samples[index]!.afterNs) / 1e6), 0.5);
}

const percentile = (values: readonly number[], fraction: number) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(fraction * sorted.length) - 1))] ?? Number.NaN;
};

const bounds = (a: Rect, b: Rect): Rect => {
  const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y);
  return { x, y, width: Math.max(a.x + a.width, b.x + b.width) - x, height: Math.max(a.y + a.height, b.y + b.height) - y };
};

const relativeTo = (origin: Rect, rect: Rect): Rect => ({ ...rect, x: rect.x - origin.x, y: rect.y - origin.y });

/**
 * Taps `key` through XTEST on `display` while grabbing the compositor output back to back, and times the first grab whose `region` changed.
 * grim returns once the compositor has drawn the next frame, so a loop of small-region grabs catches every frame and each grab's end is that frame's timestamp;
 * the press is an in-process XTEST request at a known instant, fired at a random phase of the frame.
 * A trial whose still `control` region also changed in the answering grab saw the camera move, not the press, and counts as unanswered.
 * See wisp:docs/online-plan.md, "Input-to-display latency".
 */
export const pressLatency = (options: PressLatencyOptions) => Effect.scoped(Effect.gen(function*() {
  const wayland = { XDG_RUNTIME_DIR: options.waylandRuntime, WAYLAND_DISPLAY: "wayland-0" };
  const keyboard = yield* openKeyboard(options.display, options.key);
  const area = bounds(options.region, options.control);
  const region = relativeTo(area, options.region), control = relativeTo(area, options.control);
  const capture = Effect.gen(function*() {
    const beforeNs = nowNs();
    const bytes = yield* runTool(options.window, "grab the screen", [options.grim, "-g", `${area.x},${area.y} ${area.width}x${area.height}`, "-s", "1", "-t", "ppm", "-"], wayland);
    const afterNs = nowNs();
    const frame = decodePpm(bytes);
    if (frame === undefined) return yield* new DesktopFailure({ operation: "grab the screen", client: options.window, cause: "grim returned no PPM frame" });
    return { frame, beforeNs, afterNs } satisfies Sample;
  });
  const captureFor = (ms: number) => Effect.gen(function*() {
    const samples: Sample[] = [];
    const end = nowNs() + ms * 1e6;
    while (nowNs() < end) samples.push(yield* capture);
    return samples;
  });
  const drift = (samples: readonly Sample[], rect: Rect) => Math.max(...samples.map((sample) => changedPixels(samples[0]!.frame, sample.frame, rect)));
  const quiet = (samples: readonly Sample[]) => drift(samples, region) <= QUIET_CHANGED && drift(samples, control) <= CONTROL_CHANGED;
  mkdirSync(options.out, { recursive: true });
  const trials: Trial[] = [];
  for (let trial = 0; trial < options.trials; trial++) {
    let baseline = yield* captureFor(BASELINE_MS);
    for (let wait = 0; wait < QUIET_TRIES && !quiet(baseline); wait++) baseline = yield* captureFor(BASELINE_MS);
    const idleChanged = drift(baseline, region);
    const threshold = Math.max(MIN_CHANGED, idleChanged * 3);
    let pressed: { readonly beforeNs: number; readonly afterNs: number } | undefined;
    yield* Effect.forkScoped(Effect.gen(function*() {
      yield* Effect.sleep(LEAD_MS + Math.random() * 17);
      pressed = keyboard.send(true);
      yield* Effect.sleep(TAP_MS);
      keyboard.send(false);
    }));
    const watched = yield* captureFor(LEAD_MS + 17 + WATCH_MS);
    const press = pressed ?? (yield* new DesktopFailure({ operation: "press the key", client: options.window, cause: "the press did not fire before the grabs ended" }));
    const pressNs = (press.beforeNs + press.afterNs) / 2;
    const found = response(watched, region, threshold, pressNs);
    const frameMs = framePeriodMs(watched);
    const controlChanged = found === undefined ? undefined : changedPixels(watched[found.reference]!.frame, watched[found.index]!.frame, control);
    const moved = controlChanged !== undefined && controlChanged > CONTROL_CHANGED;
    const caught = found !== undefined && !moved && found.bracketMs < SKIPPED_FRAME * frameMs;
    trials.push({
      idleChanged, threshold, changed: found?.changed, controlChanged, frameMs, pressMs: (press.afterNs - press.beforeNs) / 1e6,
      lowerMs: caught ? found.lowerMs : undefined, upperMs: caught ? found.upperMs : undefined,
      bracketMs: found?.bracketMs, skippedFrames: found === undefined ? undefined : Math.max(0, Math.round(found.bracketMs / frameMs) - 1),
    });
    const prefix = join(options.out, `trial-${String(trial).padStart(3, "0")}`);
    if (found !== undefined) {
      writeFileSync(`${prefix}-reference.ppm`, encodePpm(watched[found.reference]!.frame));
      writeFileSync(`${prefix}-response.ppm`, encodePpm(watched[found.index]!.frame));
    }
    yield* Effect.log(JSON.stringify({ trial, ...trials.at(-1) }));
    yield* Effect.sleep(options.settleMs);
  }
  const answered = trials.filter((trial) => trial.bracketMs !== undefined && trial.controlChanged !== undefined && trial.controlChanged <= CONTROL_CHANGED);
  const seen = trials.filter((trial) => trial.upperMs !== undefined && trial.lowerMs !== undefined);
  const upper = seen.map((trial) => trial.upperMs!);
  const middle = seen.map((trial) => (trial.upperMs! + trial.lowerMs!) / 2);
  const report = {
    window: options.window, key: options.key, region: options.region, control: options.control, trials: trials.length,
    responded: seen.length, missedFrames: answered.length - seen.length,
    resolutionMs: percentile(trials.map((trial) => trial.frameMs), 0.5),
    bracketMs: { p50: percentile(seen.map((trial) => trial.bracketMs!), 0.5), p95: percentile(seen.map((trial) => trial.bracketMs!), 0.95), max: Math.max(...seen.map((trial) => trial.bracketMs!)) },
    upperMs: { p50: percentile(upper, 0.5), p95: percentile(upper, 0.95) },
    middleMs: { p50: percentile(middle, 0.5), p95: percentile(middle, 0.95) },
    rows: trials,
  };
  writeFileSync(join(options.out, "press-latency.json"), JSON.stringify(report, null, 2) + "\n");
  return report;
}));

const PRESS_LATENCY_USAGE = `--window ${WINDOW_KINDS.join("|")} --display :N --wayland-runtime DIR --key KEYSYM --region X,Y,W,H --control X,Y,W,H --out DIR [--trials N] [--settle-ms MS]`;

/** Reads the harness's flags; `GRIM` names the tool when it is not on PATH. Returns the usage line when a flag is missing or malformed. */
export function pressLatencyArguments(args: readonly string[], env: Readonly<Record<string, string | undefined>> = process.env): PressLatencyOptions | string {
  const { values } = parseArgs({ args: [...args], strict: false, options: {
    window: { type: "string" }, display: { type: "string" }, "wayland-runtime": { type: "string" }, key: { type: "string" },
    region: { type: "string" }, control: { type: "string" }, out: { type: "string" }, trials: { type: "string" }, "settle-ms": { type: "string" },
  } });
  const text = (name: string) => { const value = values[name]; return typeof value === "string" ? value : undefined; };
  const window = WINDOW_KINDS.find((kind) => kind === text("window"));
  const region = parseRect(text("region") ?? ""), control = parseRect(text("control") ?? "");
  const display = text("display"), waylandRuntime = text("wayland-runtime"), key = text("key"), out = text("out");
  const trials = Number(text("trials") ?? "30"), settleMs = Number(text("settle-ms") ?? "1500");
  if (window === undefined || region === undefined || control === undefined || display === undefined || waylandRuntime === undefined || key === undefined || out === undefined
    || !Number.isInteger(trials) || trials < 1 || !(settleMs >= 0)) return PRESS_LATENCY_USAGE;
  return { window, display, waylandRuntime, key, region, control, out, trials, settleMs, grim: env["GRIM"] ?? "grim" };
}

if (import.meta.main) {
  const options = pressLatencyArguments(Bun.argv.slice(2));
  if (typeof options === "string") {
    console.error(`usage: bun host/play/pressLatency.ts ${options}`);
    process.exit(2);
  }
  BunRuntime.runMain(pressLatency(options).pipe(Effect.flatMap(({ rows, ...summary }) => Effect.log(JSON.stringify(summary)))));
}
