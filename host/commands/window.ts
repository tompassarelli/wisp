import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { Effect, Schema } from "effect";
import { type Command, UsageFailure, describeCause } from "../cli/command";
import { windowLibraryBuild, windowLibraryPath } from "../window/binding";
import { type ProbeSamples, measureBaseline, probeReport } from "../window/probe";
import { GC_LOG_BEGIN, GC_LOG_END, firstHeap, gcPausesByHeap } from "../window/stats";

class WindowFailure extends Schema.TaggedError<WindowFailure, { readonly brand: unique symbol }>()("WindowFailure", { problem: Schema.String }) {
  override get message() { return this.problem; }
}

const WARMUP_FRAMES = 120;
const USAGE = "probe [--baseline] [--frames N] [--out DIR]   (wisp:docs/native-window-plan.md, boxes W1 and W1b)";

const attempt = <A>(run: () => Promise<A>) => Effect.tryPromise({ try: run, catch: (cause) => new WindowFailure({ problem: describeCause(cause) }) });

const buildLibrary = () => Effect.gen(function*() {
  if (existsSync(windowLibraryPath())) return;
  console.log("building wisp-window (cargo build --release)");
  const build = yield* attempt(() => Bun.spawn(["cargo", "build", "--release", "--manifest-path", windowLibraryBuild.manifest], { stdout: "inherit", stderr: "inherit" }).exited);
  if (build !== 0) return yield* new WindowFailure({ problem: `cargo build for wisp-window exited ${build}` });
});

/** `window probe`: runs a game's scene through the native window for N frames and writes the gated present counts with the wake, step, scene, collection, asset-read and present percentiles beside them; `--baseline` runs the render loop with no game. */
export const makeWindow = (gameModule: string): Command => (args) => Effect.gen(function*() {
  const { values, positionals } = yield* Effect.try({
    try: () => parseArgs({ args: [...args], allowPositionals: true, options: { frames: { type: "string" }, out: { type: "string" }, baseline: { type: "boolean" } } }),
    catch: (cause) => new UsageFailure({ problem: describeCause(cause) }),
  });
  const frames = Number(values.frames ?? 600);
  if (positionals[0] !== "probe" || positionals.length !== 1 || !Number.isSafeInteger(frames) || frames < 1) return yield* new UsageFailure({ problem: USAGE });
  const out = resolve(values.out ?? "build/window-probe");
  yield* attempt(() => mkdir(out, { recursive: true }));
  yield* buildLibrary();
  if (values.baseline === true) {
    const baseline = yield* measureBaseline("Wisp Sample · window baseline", frames, WARMUP_FRAMES).pipe(Effect.mapError((cause) => new WindowFailure({ problem: describeCause(cause) })));
    yield* attempt(() => writeFile(join(out, "probe.json"), JSON.stringify(baseline, null, 2) + "\n"));
    console.log(JSON.stringify(baseline));
    return;
  }
  const rawPath = join(out, "samples.json"), logPath = join(out, "gc.log");
  const child = yield* attempt(async () => {
    const run = Bun.spawn([process.execPath, join(import.meta.dir, "../window/probeChild.ts"), gameModule, "sampleGame", "Wisp Sample · window probe", String(frames), String(WARMUP_FRAMES), rawPath], {
      env: { ...process.env, BUN_JSC_logGC: "1" }, stdout: "inherit", stderr: Bun.file(logPath),
    });
    return run.exited;
  });
  const log = yield* attempt(() => readFile(logPath, "utf8"));
  if (child !== 0) return yield* new WindowFailure({ problem: `the probe window run exited ${child}\n${log.split("\n").filter((line) => !line.startsWith("[GC")).slice(-12).join("\n")}` });
  const measured = log.slice(log.indexOf(GC_LOG_BEGIN), log.indexOf(GC_LOG_END));
  const samples = JSON.parse(yield* attempt(() => readFile(rawPath, "utf8"))) as ProbeSamples;
  const report = probeReport(samples, gcPausesByHeap(measured), firstHeap(log));
  yield* attempt(() => writeFile(join(out, "probe.json"), JSON.stringify(report, null, 2) + "\n"));
  console.log(JSON.stringify(report));
}).pipe(Effect.mapError((cause) => cause._tag === "UsageFailure" ? cause : new WindowFailure({ problem: cause.message })));
