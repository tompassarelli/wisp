import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import * as BunRuntime from "@effect/platform-bun/BunRuntime";
import { Effect } from "effect";
import { decodePpm, encodePpm, type Frame } from "../os/platform/services";
import { DesktopFailure, runTool } from "../os/warcraft/desktopClient";

export const WINDOW_KINDS = ["chrome", "warcraft", "native"] as const;
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
  readonly xdotool: string;
  readonly settleMs: number;
}

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
  readonly keyMs: number;
  readonly captureMs: number;
}

const BASELINE_MS = 300;
const WATCH_MS = 600;
const CHANNEL_STEP = 40;
const MIN_CHANGED = 300;
const TAP_MS = 50;
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

/** The first sample whose `region` passes `threshold` changed pixels, with the press-to-change bracket it allows: the change came after the last unchanged acquisition began and before the changed one ended. */
export function response(samples: readonly Sample[], reference: Frame, region: Rect, threshold: number, pressBeforeNs: number, pressAfterNs: number) {
  for (let index = 0; index < samples.length; index++) {
    const sample = samples[index]!;
    const changed = changedPixels(reference, sample.frame, region);
    if (changed <= threshold) continue;
    const lowerNs = samples[index - 1]?.beforeNs ?? pressAfterNs;
    return { index, changed, lowerMs: Math.max(0, lowerNs - pressAfterNs) / 1e6, upperMs: (sample.afterNs - pressBeforeNs) / 1e6 };
  }
  return undefined;
}

const percentile = (values: readonly number[], fraction: number) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(fraction * sorted.length) - 1))] ?? Number.NaN;
};

/**
 * Taps `key` through XTEST on `display` and grabs the whole compositor output until `region` changes.
 * A trial whose still `control` region also changed saw the camera move, not the press, and counts as unanswered.
 * See wisp:docs/online-plan.md, "Input-to-display latency".
 */
export const pressLatency = (options: PressLatencyOptions) => Effect.scoped(Effect.gen(function*() {
  const wayland = { XDG_RUNTIME_DIR: options.waylandRuntime, WAYLAND_DISPLAY: "wayland-0" };
  const x11 = { DISPLAY: options.display };
  const tool = (operation: string, command: readonly string[], env: Record<string, string>) => runTool(options.window, operation, command, env);
  const capture = Effect.gen(function*() {
    const beforeNs = nowNs();
    const bytes = yield* tool("grab the screen", [options.grim, "-t", "ppm", "-"], wayland);
    const afterNs = nowNs();
    const frame = decodePpm(bytes);
    if (frame === undefined) return yield* new DesktopFailure({ operation: "grab the screen", client: options.window, cause: "grim returned no PPM frame" });
    return { frame, beforeNs, afterNs } satisfies Sample;
  });
  const captureFor = (ms: number, releaseAtNs?: number) => Effect.gen(function*() {
    const samples: Sample[] = [];
    const end = nowNs() + ms * 1e6;
    let pending = releaseAtNs;
    while (nowNs() < end) {
      if (pending !== undefined && nowNs() >= pending) {
        yield* Effect.forkScoped(tool("release the key", [options.xdotool, "keyup", options.key], x11));
        pending = undefined;
      }
      samples.push(yield* capture);
    }
    return samples;
  });
  const drift = (samples: readonly Sample[], rect: Rect) => Math.max(...samples.map((sample) => changedPixels(samples[0]!.frame, sample.frame, rect)));
  const quiet = (samples: readonly Sample[]) => drift(samples, options.region) <= QUIET_CHANGED && drift(samples, options.control) <= CONTROL_CHANGED;
  mkdirSync(options.out, { recursive: true });
  const trials: Trial[] = [];
  for (let trial = 0; trial < options.trials; trial++) {
    let baseline = yield* captureFor(BASELINE_MS);
    for (let wait = 0; wait < QUIET_TRIES && !quiet(baseline); wait++) baseline = yield* captureFor(BASELINE_MS);
    const reference = baseline.at(-1)!.frame;
    const idleChanged = drift(baseline, options.region);
    const threshold = Math.max(MIN_CHANGED, idleChanged * 3);
    yield* Effect.sleep(Math.random() * 17);
    const pressBeforeNs = nowNs();
    yield* tool("press the key", [options.xdotool, "keydown", options.key], x11);
    const pressAfterNs = nowNs();
    const watched = yield* captureFor(WATCH_MS, pressAfterNs + TAP_MS * 1e6);
    const found = response(watched, reference, options.region, threshold, pressBeforeNs, pressAfterNs);
    const controlChanged = found === undefined ? undefined : changedPixels(reference, watched[found.index]!.frame, options.control);
    const moved = controlChanged !== undefined && controlChanged > CONTROL_CHANGED;
    const spans = [...baseline, ...watched].map((sample) => (sample.afterNs - sample.beforeNs) / 1e6);
    trials.push({
      idleChanged, threshold, changed: found?.changed, controlChanged,
      lowerMs: moved ? undefined : found?.lowerMs, upperMs: moved ? undefined : found?.upperMs,
      keyMs: (pressAfterNs - pressBeforeNs) / 1e6, captureMs: percentile(spans, 0.5),
    });
    const prefix = join(options.out, `trial-${String(trial).padStart(3, "0")}`);
    writeFileSync(`${prefix}-reference.ppm`, encodePpm(reference));
    if (found !== undefined) writeFileSync(`${prefix}-response.ppm`, encodePpm(watched[found.index]!.frame));
    yield* Effect.log(JSON.stringify({ trial, ...trials.at(-1) }));
    yield* Effect.sleep(options.settleMs);
  }
  const seen = trials.filter((trial) => trial.upperMs !== undefined && trial.lowerMs !== undefined);
  const upper = seen.map((trial) => trial.upperMs!);
  const middle = seen.map((trial) => (trial.upperMs! + trial.lowerMs!) / 2);
  const report = {
    window: options.window, key: options.key, region: options.region, control: options.control, trials: trials.length, responded: seen.length,
    upperMs: { p50: percentile(upper, 0.5), p95: percentile(upper, 0.95) },
    middleMs: { p50: percentile(middle, 0.5), p95: percentile(middle, 0.95) },
    captureMs: percentile(trials.map((trial) => trial.captureMs), 0.5),
    rows: trials,
  };
  writeFileSync(join(options.out, "press-latency.json"), JSON.stringify(report, null, 2) + "\n");
  return report;
}));

const PRESS_LATENCY_USAGE = `--window ${WINDOW_KINDS.join("|")} --display :N --wayland-runtime DIR --key KEYSYM --region X,Y,W,H --control X,Y,W,H --out DIR [--trials N] [--settle-ms MS]`;

/** Reads the harness's flags; `GRIM` and `XDOTOOL` name the tools when they are not on PATH. Returns the usage line when a flag is missing or malformed. */
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
  return { window, display, waylandRuntime, key, region, control, out, trials, settleMs, grim: env["GRIM"] ?? "grim", xdotool: env["XDOTOOL"] ?? "xdotool" };
}

if (import.meta.main) {
  const options = pressLatencyArguments(Bun.argv.slice(2));
  if (typeof options === "string") {
    console.error(`usage: bun host/play/pressLatency.ts ${options}`);
    process.exit(2);
  }
  BunRuntime.runMain(pressLatency(options).pipe(Effect.flatMap(({ rows, ...summary }) => Effect.log(JSON.stringify(summary)))));
}
