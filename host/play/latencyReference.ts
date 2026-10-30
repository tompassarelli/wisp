import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";
import * as BunRuntime from "@effect/platform-bun/BunRuntime";
import { Effect } from "effect";
import { decodePpm } from "../contract/services";
import { runTool } from "../os/warcraft/desktopClient";
import { DesktopFailure } from "../contract/client";
import { type PressLatencyOptions, pressLatency, type Rect } from "./pressLatency";

/** Frames the reference page waits between the key and the pixel it changes. */
const REFERENCE_DELAYS = [0, 4, 8] as const;

const REGION: Rect = { x: 60, y: 60, width: 300, height: 300 };
const CONTROL: Rect = { x: 600, y: 450, width: 150, height: 100 };

/** A dark grey page, distinguishable from the black desktop, whose box turns white the given number of animation frames after a `j` keydown, then back, and whose control corner never changes. */
const referencePage = (frames: number) => `<!doctype html><meta charset=utf-8>
<body style="margin:0;background:#181818"><div id=box style="position:absolute;left:100px;top:100px;width:200px;height:200px;background:#181818"></div>
<script>
let busy = false;
addEventListener("keydown", (event) => {
  if (busy || event.repeat || event.key !== "j") return;
  busy = true;
  let remaining = ${frames};
  const step = () => {
    if (remaining-- > 0) return requestAnimationFrame(step);
    box.style.background = "#fff";
    setTimeout(() => { box.style.background = "#181818"; busy = false; }, 400);
  };
  requestAnimationFrame(step);
});
</script>
`;

export interface ReferenceDelay {
  readonly frames: number;
  readonly periodMs: number;
  readonly upperP50Ms: number;
  readonly responded: number;
}

export interface ReferenceError {
  readonly frames: number;
  readonly knownMs: number;
  readonly measuredMs: number;
  readonly errorMs: number;
}

/**
 * Compares each delayed reference's median press-to-pixel against the undelayed one: the page adds exactly `frames` display frames,
 * so the medians must differ by `frames` periods. Whatever the browser adds to both cancels; what remains is the method's error.
 */
export function referenceErrors(delays: readonly ReferenceDelay[]): readonly ReferenceError[] {
  const base = delays.find((delay) => delay.frames === 0);
  if (base === undefined) return [];
  return delays.filter((delay) => delay.frames > 0).map((delay) => {
    const knownMs = delay.frames * ((delay.periodMs + base.periodMs) / 2);
    const measuredMs = delay.upperP50Ms - base.upperP50Ms;
    return { frames: delay.frames, knownMs, measuredMs, errorMs: measuredMs - knownMs };
  });
}

const chromeFor = (chrome: string, display: string, profile: string, page: string) => Effect.acquireRelease(
  Effect.sync(() => spawn(chrome, [
    "--no-first-run", "--no-default-browser-check", "--disable-background-networking", "--disable-sync", "--ozone-platform=x11",
    `--user-data-dir=${profile}`, "--window-position=0,0", "--window-size=800,600", `--app=file://${page}`,
  ], { stdio: "ignore", env: { ...process.env, DISPLAY: display } })),
  (child) => Effect.promise(() => new Promise<void>((resolve) => {
    if (child.exitCode !== null) return resolve();
    child.once("exit", () => resolve());
    child.kill("SIGTERM");
  })),
);

const shown = (options: PressLatencyOptions) => Effect.gen(function*() {
  const wayland = { XDG_RUNTIME_DIR: options.waylandRuntime, WAYLAND_DISPLAY: "wayland-0" };
  const { x, y, width, height } = options.control;
  for (let attempt = 0; attempt < 100; attempt++) {
    const frame = decodePpm(yield* runTool(options.window, "look for the reference page", [options.grim, "-g", `${x},${y} ${width}x${height}`, "-s", "1", "-t", "ppm", "-"], wayland));
    if (frame !== undefined && frame.rgb.every((channel) => channel >= 20 && channel <= 28)) return;
    yield* Effect.sleep(200);
  }
  return yield* new DesktopFailure({ operation: "look for the reference page", client: "reference", cause: "the reference page never appeared" });
});

const CHECK_USAGE = "--check --display :N --wayland-runtime DIR --out DIR [--trials N] [--settle-ms MS]";

/** Reads the check's flags, or returns the usage line when one is missing or malformed. */
export function checkArguments(args: readonly string[], env: Readonly<Record<string, string | undefined>> = process.env) {
  const { values } = parseArgs({ args: [...args], strict: false, options: {
    display: { type: "string" }, "wayland-runtime": { type: "string" }, out: { type: "string" }, trials: { type: "string" }, "settle-ms": { type: "string" },
  } });
  const text = (name: string) => { const value = values[name]; return typeof value === "string" ? value : undefined; };
  const display = text("display"), waylandRuntime = text("wayland-runtime"), out = text("out");
  const trials = Number(text("trials") ?? "30"), settleMs = Number(text("settle-ms") ?? "1500");
  if (display === undefined || waylandRuntime === undefined || out === undefined || !Number.isInteger(trials) || trials < 1 || !(settleMs >= 0)) return CHECK_USAGE;
  return { display, waylandRuntime, out, trials, settleMs, grim: env["GRIM"] ?? "grim" };
}

/**
 * Validates the press-latency method against a source of known delay: a Chrome page that changes a pixel `REFERENCE_DELAYS` frames after the key.
 * The method passes when every delayed run's median lands within one display frame of the delay the page was given.
 */
export const checkPressLatency = (options: Pick<PressLatencyOptions, "display" | "waylandRuntime" | "trials" | "out" | "grim" | "settleMs">, chrome = process.env["CHROME"] ?? "google-chrome-stable") =>
  Effect.gen(function*() {
    mkdirSync(options.out, { recursive: true });
    const delays: ReferenceDelay[] = [];
    for (const frames of REFERENCE_DELAYS) {
      const work = mkdtempSync(join(tmpdir(), "wisp-latency-reference-"));
      const page = join(work, "page.html");
      writeFileSync(page, referencePage(frames));
      const report = yield* Effect.scoped(Effect.gen(function*() {
        yield* chromeFor(chrome, options.display, join(work, "profile"), page);
        const measured = { ...options, window: "reference" as const, key: "j", region: REGION, control: CONTROL, out: join(options.out, `frames-${frames}`) };
        yield* shown(measured);
        yield* Effect.sleep(1500);
        return yield* pressLatency(measured);
      })).pipe(Effect.ensuring(Effect.sync(() => rmSync(work, { recursive: true, force: true }))));
      const { rows, ...summary } = report;
      yield* Effect.log(JSON.stringify({ frames, ...summary }));
      delays.push({ frames, periodMs: report.resolutionMs, upperP50Ms: report.upperMs.p50, responded: report.responded });
    }
    const errors = referenceErrors(delays);
    const resolutionMs = delays.reduce((total, delay) => total + delay.periodMs, 0) / delays.length;
    const result = {
      resolutionMs, delays, errors,
      passes: errors.length > 0 && errors.every((error) => Math.abs(error.errorMs) <= resolutionMs) && delays.every((delay) => delay.responded >= options.trials * 0.8),
    };
    writeFileSync(join(options.out, "reference.json"), JSON.stringify(result, null, 2) + "\n");
    return result;
  });

if (import.meta.main) {
  const options = checkArguments(Bun.argv.slice(2));
  if (typeof options === "string") {
    console.error(`usage: bun host/play/latencyReference.ts ${options}`);
    process.exit(2);
  }
  BunRuntime.runMain(checkPressLatency(options).pipe(Effect.flatMap((result) => Effect.log(JSON.stringify(result)))));
}
