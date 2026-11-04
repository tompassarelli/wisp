import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import * as BunRuntime from "@effect/platform-bun/BunRuntime";
import { Effect } from "effect";
import { decodePpm, encodePpm, type Frame } from "../contract/services";
import { runTool } from "../os/warcraft/desktopClient";
import { DesktopFailure } from "../contract/client";
import { monotonicNs } from "../os/platform/linux/monotonic";
import { type SampleEdge, parseSampleLog } from "../window/sampleLog";
import type { Keyboard } from "./keyboard";
import { PRESS_INPUTS, type PressInput, openPressKeyboard } from "./pressKeyboard";

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
  /** How the harness presses the key: through XTEST on `display` for an Xwayland window, or the compositor's virtual keyboard for a native Wayland one. */
  readonly input: PressInput;
  readonly display: string | undefined;
  readonly waylandRuntime: string;
  readonly waylandDisplay: string;
  readonly key: string;
  readonly region: Rect;
  readonly control: Rect | undefined;
  readonly trials: number;
  readonly out: string;
  readonly grim: string;
  readonly settleMs: number;
  /** The file a native window appends its button changes to (`WISP_WINDOW_SAMPLE_LOG`), from which the window's share of each press is read. */
  readonly sampleLog: string | undefined;
  readonly flash: boolean;
  readonly inputDelayFrames: number;
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
  /** How long the key request took to write: the uncertainty of the press time. */
  readonly pressWriteMs: number;
  /** The middle of the bracket: press to the changed pixels. */
  readonly pressMs: number | undefined;
  /** The sampled input to the changed pixels, on the library's clock; set only for a native window that logged the sample. */
  readonly windowShareMs: number | undefined;
  readonly pressToSampleMs: number | undefined;
  readonly baselineMs: number;
  readonly quietWaits: number;
  readonly watchMs: number;
  readonly settledMs: number;
  readonly trialMs: number;
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
const FLASH_BASELINE_MS = 100;
const FLASH_WATCH_MS = 400;
const FLASH_MIN_CHANGED = 100;
const FLASH_QUIET_CHANGED = 50;
const FLASH_QUIET_TRIES = 40;
const SIM_FRAME_MS = 1000 / 60;

const nowNs = monotonicNs;

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

/** The sample that carried the press is the first logged press (a new pad button or a key going down) at or after it; the window's share is from that sample to the middle of the bracket the change appeared in. */
export function windowShare(edges: readonly SampleEdge[], pressNs: number, changed: Pick<Response, "lowerMs" | "upperMs">): number | undefined {
  const sampled = edges.find((edge) => edge.sampleNs >= pressNs && edge.pressed);
  if (sampled === undefined) return undefined;
  return (pressNs - sampled.sampleNs) / 1e6 + (changed.lowerMs + changed.upperMs) / 2;
}

export function pressToSample(edges: readonly SampleEdge[], pressNs: number): number | undefined {
  const sampled = edges.find((edge) => edge.sampleNs >= pressNs && edge.pressed);
  return sampled === undefined ? undefined : (sampled.sampleNs - pressNs) / 1e6;
}

const loggedEdges = (log: string | undefined) => log === undefined ? undefined : parseSampleLog(readFileSync(log, "utf8"));

const percentile = (values: readonly number[], fraction: number) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(fraction * sorted.length) - 1))] ?? Number.NaN;
};

const bounds = (a: Rect, other: Rect | undefined): Rect => {
  if (other === undefined) return a;
  const b = other;
  const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y);
  return { x, y, width: Math.max(a.x + a.width, b.x + b.width) - x, height: Math.max(a.y + a.height, b.y + b.height) - y };
};

const relativeTo = (origin: Rect, rect: Rect): Rect => ({ ...rect, x: rect.x - origin.x, y: rect.y - origin.y });

/** The run's figures from its trials; `windowShareMs` is present only for a run that read a sample log. */
function pressReport(options: PressLatencyOptions, trials: readonly Trial[]) {
  const answered = trials.filter((trial) => trial.bracketMs !== undefined && (options.control === undefined || (trial.controlChanged !== undefined && trial.controlChanged <= CONTROL_CHANGED)));
  const seen = trials.filter((trial) => trial.upperMs !== undefined && trial.lowerMs !== undefined);
  const upper = seen.map((trial) => trial.upperMs!);
  const middle = seen.map((trial) => trial.pressMs!);
  const shares = seen.flatMap((trial) => trial.windowShareMs === undefined ? [] : [trial.windowShareMs]);
  const split = seen.filter((trial) => trial.windowShareMs !== undefined && trial.pressToSampleMs !== undefined);
  const inputDelayMs = options.inputDelayFrames * SIM_FRAME_MS;
  const spread = (values: readonly number[]) => ({ p50: percentile(values, 0.5), p95: percentile(values, 0.95), measured: values.length });
  return {
    window: options.window, input: options.input, key: options.key, region: options.region, control: options.control, flash: options.flash, trials: trials.length,
    responded: seen.length, missedFrames: answered.length - seen.length,
    resolutionMs: percentile(trials.map((trial) => trial.frameMs), 0.5),
    bracketMs: { p50: percentile(seen.map((trial) => trial.bracketMs!), 0.5), p95: percentile(seen.map((trial) => trial.bracketMs!), 0.95), max: Math.max(...seen.map((trial) => trial.bracketMs!)) },
    upperMs: { p50: percentile(upper, 0.5), p95: percentile(upper, 0.95) },
    pressMs: { p50: percentile(middle, 0.5), p95: percentile(middle, 0.95) },
    ...(options.sampleLog === undefined ? {} : {
      windowShareMs: spread(shares),
      split: {
        pressToSampleMs: spread(split.map((trial) => trial.pressToSampleMs!)),
        inputDelayMs,
        sampleToDisplayMs: spread(split.map((trial) => trial.windowShareMs! - inputDelayMs)),
      },
    }),
    trialMs: { ...spread(trials.map((trial) => trial.trialMs)), max: Math.max(...trials.map((trial) => trial.trialMs)) },
    trialPhasesMs: {
      baseline: percentile(trials.map((trial) => trial.baselineMs), 0.5),
      watch: percentile(trials.map((trial) => trial.watchMs), 0.5),
      settle: percentile(trials.map((trial) => trial.settledMs), 0.5),
      quietWaits: percentile(trials.map((trial) => trial.quietWaits), 0.5),
    },
    rows: trials,
  };
}

interface TrialContext {
  readonly options: PressLatencyOptions;
  readonly keyboard: Keyboard;
  readonly region: Rect;
  readonly control: Rect | undefined;
  readonly captureFor: (ms: number, done?: (samples: readonly Sample[]) => boolean) => Effect.Effect<Sample[], DesktopFailure, never>;
  readonly quiet: (samples: readonly Sample[]) => boolean;
}

type Pressed = { readonly beforeNs: number; readonly afterNs: number };

const drift = (samples: readonly Sample[], rect: Rect, from: Frame | undefined = undefined) => Math.max(...samples.map((sample) => changedPixels(from ?? samples[0]!.frame, sample.frame, rect)));

function grabber(options: PressLatencyOptions, area: Rect) {
  const wayland = { XDG_RUNTIME_DIR: options.waylandRuntime, WAYLAND_DISPLAY: options.waylandDisplay };
  const capture = Effect.gen(function*() {
    const beforeNs = nowNs();
    const bytes = yield* runTool(options.window, "grab the screen", [options.grim, "-g", `${area.x},${area.y} ${area.width}x${area.height}`, "-s", "1", "-t", "ppm", "-"], wayland);
    const afterNs = nowNs();
    const frame = decodePpm(bytes);
    if (frame === undefined) return yield* new DesktopFailure({ operation: "grab the screen", client: options.window, cause: "grim returned no PPM frame" });
    return { frame, beforeNs, afterNs } satisfies Sample;
  });
  return (ms: number, done?: (samples: readonly Sample[]) => boolean) => Effect.gen(function*() {
    const samples: Sample[] = [];
    const end = nowNs() + ms * 1e6;
    while (nowNs() < end) {
      samples.push(yield* capture);
      if (done?.(samples) === true) break;
    }
    return samples;
  });
}

function quietCheck(options: PressLatencyOptions, region: Rect, control: Rect | undefined) {
  let flashOff: Frame | undefined;
  return (samples: readonly Sample[]) => {
    if (!options.flash) return drift(samples, region) <= QUIET_CHANGED && drift(samples, control!) <= CONTROL_CHANGED;
    flashOff ??= samples[0]!.frame;
    return drift(samples, region, flashOff) <= FLASH_QUIET_CHANGED;
  };
}

const quietBaseline = (context: TrialContext) => Effect.gen(function*() {
  const { options, captureFor, quiet } = context;
  const baselineMs = options.flash ? FLASH_BASELINE_MS : BASELINE_MS;
  const quietTries = options.flash ? FLASH_QUIET_TRIES : QUIET_TRIES;
  let baseline = yield* captureFor(baselineMs);
  let quietWaits = 0;
  for (; quietWaits < quietTries && !quiet(baseline); quietWaits++) baseline = yield* captureFor(baselineMs);
  return { baseline, quietWaits };
});

const pressAndWatch = (context: TrialContext, threshold: number) => Effect.gen(function*() {
  const { options, keyboard, region, captureFor } = context;
  let pressed: Pressed | undefined;
  yield* Effect.forkScoped(Effect.gen(function*() {
    yield* Effect.sleep(LEAD_MS + Math.random() * 17);
    pressed = keyboard.send(true);
    yield* Effect.sleep(TAP_MS);
    keyboard.send(false);
  }));
  const answered = (samples: readonly Sample[]) => pressed !== undefined && response(samples, region, threshold, (pressed.beforeNs + pressed.afterNs) / 2) !== undefined;
  const watched = yield* captureFor(LEAD_MS + 17 + (options.flash ? FLASH_WATCH_MS : WATCH_MS), options.flash ? answered : undefined);
  const press = pressed ?? (yield* new DesktopFailure({ operation: "press the key", client: options.window, cause: "the press did not fire before the grabs ended" }));
  return { watched, press };
});

interface Timing {
  readonly startedNs: number;
  readonly baselineEndNs: number;
  readonly watchedEndNs: number;
  readonly quietWaits: number;
  readonly tail: number;
}

function trialRow(context: TrialContext, watched: readonly Sample[], press: Pressed, idleChanged: number, threshold: number, timing: Timing): { readonly row: Trial; readonly found: Response | undefined } {
  const { options, region, control } = context;
  const pressNs = (press.beforeNs + press.afterNs) / 2;
  const found = response(watched, region, threshold, pressNs);
  const frameMs = framePeriodMs(watched);
  const controlChanged = found === undefined || control === undefined ? undefined : changedPixels(watched[found.reference]!.frame, watched[found.index]!.frame, control);
  const moved = controlChanged !== undefined && controlChanged > CONTROL_CHANGED;
  const caught = found !== undefined && !moved && found.bracketMs < SKIPPED_FRAME * frameMs;
  const edges = caught ? loggedEdges(options.sampleLog) : undefined;
  const row: Trial = {
    idleChanged, threshold, changed: found?.changed, controlChanged, frameMs, pressWriteMs: (press.afterNs - press.beforeNs) / 1e6,
    pressMs: caught ? (found.lowerMs + found.upperMs) / 2 : undefined,
    windowShareMs: caught && edges !== undefined ? windowShare(edges, pressNs, found) : undefined,
    pressToSampleMs: caught && edges !== undefined ? pressToSample(edges, pressNs) : undefined,
    baselineMs: (timing.baselineEndNs - timing.startedNs) / 1e6, quietWaits: timing.quietWaits, watchMs: (timing.watchedEndNs - timing.baselineEndNs) / 1e6, settledMs: timing.tail, trialMs: 0,
    lowerMs: caught ? found.lowerMs : undefined, upperMs: caught ? found.upperMs : undefined,
    bracketMs: found?.bracketMs, skippedFrames: found === undefined ? undefined : Math.max(0, Math.round(found.bracketMs / frameMs) - 1),
  };
  return { row, found };
}

const runTrial = (context: TrialContext, index: number) => Effect.gen(function*() {
  const { options, region } = context;
  const startedNs = nowNs();
  const { baseline, quietWaits } = yield* quietBaseline(context);
  const idleChanged = drift(baseline, region);
  const threshold = Math.max(options.flash ? FLASH_MIN_CHANGED : MIN_CHANGED, idleChanged * 3);
  const baselineEndNs = nowNs();
  const { watched, press } = yield* pressAndWatch(context, threshold);
  const tail = options.flash ? 0 : options.settleMs;
  const { row, found } = trialRow(context, watched, press, idleChanged, threshold, { startedNs, baselineEndNs, watchedEndNs: nowNs(), quietWaits, tail });
  if (found !== undefined) {
    const prefix = join(options.out, `trial-${String(index).padStart(3, "0")}`);
    writeFileSync(`${prefix}-reference.ppm`, encodePpm(watched[found.reference]!.frame));
    writeFileSync(`${prefix}-response.ppm`, encodePpm(watched[found.index]!.frame));
  }
  yield* Effect.sleep(tail);
  const done = { ...row, trialMs: (nowNs() - startedNs) / 1e6 };
  yield* Effect.log(JSON.stringify({ trial: index, ...done }));
  return done;
});

/**
 * Taps `key` through XTEST on `display`, or the compositor's virtual keyboard with `--input wayland`, while grabbing the compositor output back to back, and times the first grab whose `region` changed.
 * grim returns once the compositor has drawn the next frame, so a loop of small-region grabs catches every frame and each grab's end is that frame's timestamp;
 * the press is an in-process request at a known instant, fired at a random phase of the frame.
 * A trial whose still `control` region also changed in the answering grab saw the camera move, not the press, and counts as unanswered.
 * See wisp:docs/online-plan.md, "Input-to-display latency".
 */
export const pressLatency = (options: PressLatencyOptions) => Effect.scoped(Effect.gen(function*() {
  const keyboard = yield* openPressKeyboard(options, options.key);
  const area = bounds(options.region, options.control);
  const region = relativeTo(area, options.region), control = options.control === undefined ? undefined : relativeTo(area, options.control);
  const context: TrialContext = { options, keyboard, region, control, captureFor: grabber(options, area), quiet: quietCheck(options, region, control) };
  mkdirSync(options.out, { recursive: true });
  const trials: Trial[] = [];
  for (let index = 0; index < options.trials; index++) trials.push(yield* runTrial(context, index));
  const report = pressReport(options, trials);
  writeFileSync(join(options.out, "press-latency.json"), JSON.stringify(report, null, 2) + "\n");
  return report;
}));

const PRESS_LATENCY_USAGE = `--window ${WINDOW_KINDS.join("|")} (--display :N | --input wayland) --wayland-runtime DIR [--wayland-display NAME] --key KEYSYM --region X,Y,W,H (--control X,Y,W,H | --flash) --out DIR [--trials N] [--settle-ms MS] [--sample-log FILE] [--input-delay-frames N]`;

/** Reads the harness's flags; `GRIM` names the tool when it is not on PATH. Returns the usage line when a flag is missing or malformed. */
export function pressLatencyArguments(args: readonly string[], env: Readonly<Record<string, string | undefined>> = process.env): PressLatencyOptions | string {
  const { values } = parseArgs({ args: [...args], strict: false, options: {
    window: { type: "string" }, display: { type: "string" }, "wayland-runtime": { type: "string" }, key: { type: "string" },
    region: { type: "string" }, control: { type: "string" }, out: { type: "string" }, trials: { type: "string" }, "settle-ms": { type: "string" }, "sample-log": { type: "string" },
    flash: { type: "boolean" }, "input-delay-frames": { type: "string" }, input: { type: "string" }, "wayland-display": { type: "string" },
  } });
  const text = (name: string) => { const value = values[name]; return typeof value === "string" ? value : undefined; };
  const window = WINDOW_KINDS.find((kind) => kind === text("window"));
  const flash = values["flash"] === true;
  const input = PRESS_INPUTS.find((kind) => kind === (text("input") ?? "xtest"));
  const region = parseRect(text("region") ?? ""), control = parseRect(text("control") ?? "");
  const display = text("display"), waylandRuntime = text("wayland-runtime"), key = text("key"), out = text("out");
  const trials = Number(text("trials") ?? "30"), settleMs = Number(text("settle-ms") ?? "1500"), inputDelayFrames = Number(text("input-delay-frames") ?? "2");
  if (window === undefined || region === undefined || (control === undefined && !flash) || input === undefined || (input === "xtest" && display === undefined) || waylandRuntime === undefined || key === undefined || out === undefined
    || !Number.isInteger(trials) || trials < 1 || !(settleMs >= 0) || !Number.isInteger(inputDelayFrames) || inputDelayFrames < 0) return PRESS_LATENCY_USAGE;
  return { window, input, display, waylandRuntime, waylandDisplay: text("wayland-display") ?? "wayland-0", key, region, control, out, trials, settleMs, sampleLog: text("sample-log"), flash, inputDelayFrames, grim: env["GRIM"] ?? "grim" };
}

if (import.meta.main) {
  const options = pressLatencyArguments(Bun.argv.slice(2));
  if (typeof options === "string") {
    console.error(`usage: bun host/play/pressLatency.ts ${options}`);
    process.exit(2);
  }
  BunRuntime.runMain(pressLatency(options).pipe(Effect.flatMap(({ rows, ...summary }) => Effect.log(JSON.stringify(summary)))));
}
