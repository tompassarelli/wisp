import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { Effect, Schema } from "effect";
import { type Command, UsageFailure, describeCause } from "../cli/command";
import { prepareWindowLibrary } from "../window/binding";
import { type ProbeSamples, measureBaseline, probeReport } from "../window/probe";
import { GC_LOG_BEGIN, GC_LOG_END, RUN_COMPLETED_LOG, firstHeap, gcPausesByHeap } from "../window/stats";

class WindowFailure extends Schema.TaggedError<WindowFailure, { readonly brand: unique symbol }>()("WindowFailure", { problem: Schema.String }) {
  override get message() { return this.problem; }
}

const WARMUP_FRAMES = 120;
const CLOSE_BOUND = "30 seconds";
const LOG_POLL = "500 millis";
const USAGE = "probe [--baseline] [--frames N] [--out DIR]   (wisp:docs/native-window-plan.md, boxes W1 to W1c)";

const attempt = <A>(run: () => Promise<A>) => Effect.tryPromise({ try: run, catch: (cause) => new WindowFailure({ problem: describeCause(cause) }) });

const readLog = (path: string) => Effect.promise(() => readFile(path, "utf8").catch(() => ""));
const untilRunCompleted = (path: string) => Effect.gen(function*() {
  while (!(yield* readLog(path)).includes(RUN_COMPLETED_LOG)) yield* Effect.sleep(LOG_POLL);
});
const lastLines = (log: string) => log.split("\n").filter((line) => !line.startsWith("[GC") && line !== "GC END!").slice(-12).join("\n");

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
  yield* prepareWindowLibrary.pipe(Effect.mapError((cause) => new WindowFailure({ problem: cause.message })));
  if (values.baseline === true) {
    const baseline = yield* measureBaseline("Wisp Sample · window baseline", frames, WARMUP_FRAMES).pipe(Effect.mapError((cause) => new WindowFailure({ problem: describeCause(cause) })));
    yield* attempt(() => writeFile(join(out, "probe.json"), JSON.stringify(baseline, null, 2) + "\n"));
    console.log(JSON.stringify(baseline));
    return;
  }
  const rawPath = join(out, "samples.json"), logPath = join(out, "gc.log");
  const run = yield* attempt(async () => Bun.spawn([process.execPath, join(import.meta.dir, "../window/probeChild.ts"), gameModule, "sampleGame", "Wisp Sample · window probe", String(frames), String(WARMUP_FRAMES), rawPath], {
    env: { ...process.env, BUN_JSC_logGC: "1" }, stdout: "inherit", stderr: Bun.file(logPath),
  }));
  const hung = untilRunCompleted(logPath).pipe(Effect.andThen(Effect.sleep(CLOSE_BOUND)), Effect.andThen(Effect.sync(() => { run.kill(); return "hung" as const; })));
  const child = yield* Effect.raceFirst(Effect.promise(() => run.exited), hung);
  const log = yield* readLog(logPath);
  if (child === "hung") return yield* new WindowFailure({ problem: `the probe finished its frames but its window did not close within ${CLOSE_BOUND}, so the child was ended; the log's last lines name the thread stop was waiting for\n${lastLines(log)}` });
  if (child !== 0) {
    const failure = yield* attempt(async () => (JSON.parse(await readFile(rawPath, "utf8")) as { failure?: string }).failure).pipe(Effect.orElseSucceed(() => undefined));
    return yield* new WindowFailure({ problem: `the probe window run exited ${child}${failure === undefined ? "" : `: ${failure}`}\n${lastLines(log)}` });
  }
  const measured = log.slice(log.indexOf(GC_LOG_BEGIN), log.indexOf(GC_LOG_END));
  const samples = JSON.parse(yield* attempt(() => readFile(rawPath, "utf8"))) as ProbeSamples;
  const report = probeReport(samples, gcPausesByHeap(measured), firstHeap(log));
  yield* attempt(() => writeFile(join(out, "probe.json"), JSON.stringify(report, null, 2) + "\n"));
  console.log(JSON.stringify(report));
}).pipe(Effect.mapError((cause) => cause._tag === "UsageFailure" ? cause : new WindowFailure({ problem: cause.message })));
