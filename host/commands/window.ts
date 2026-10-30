import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { Effect, Schema } from "effect";
import { type Command, UsageFailure, describeCause } from "../cli/command";
import { windowLibraryBuild, windowLibraryPath } from "../window/binding";
import { type ProbeSamples, probeReport } from "../window/probe";
import { gcPauses } from "../window/stats";

class WindowFailure extends Schema.TaggedError<WindowFailure, { readonly brand: unique symbol }>()("WindowFailure", { problem: Schema.String }) {
  override get message() { return this.problem; }
}

const WARMUP_FRAMES = 30;
const USAGE = "probe [--frames N] [--out DIR]   (wisp:docs/native-window-plan.md, box W1)";
const FRAMES_BEGIN = "wisp-window-probe frames begin", FRAMES_END = "wisp-window-probe frames end";

const attempt = <A>(run: () => Promise<A>) => Effect.tryPromise({ try: run, catch: (cause) => new WindowFailure({ problem: describeCause(cause) }) });

const buildLibrary = () => Effect.gen(function*() {
  if (existsSync(windowLibraryPath())) return;
  console.log("building wisp-window (cargo build --release)");
  const build = yield* attempt(() => Bun.spawn(["cargo", "build", "--release", "--manifest-path", windowLibraryBuild.manifest], { stdout: "inherit", stderr: "inherit" }).exited);
  if (build !== 0) return yield* new WindowFailure({ problem: `cargo build for wisp-window exited ${build}` });
});

/** `window probe`: runs a game's scene through the native window for N frames and writes the wake, step, scene, collection, asset-read and present percentiles. */
export const makeWindow = (gameModule: string): Command => (args) => Effect.gen(function*() {
  const { values, positionals } = yield* Effect.try({
    try: () => parseArgs({ args: [...args], allowPositionals: true, options: { frames: { type: "string" }, out: { type: "string" } } }),
    catch: (cause) => new UsageFailure({ problem: describeCause(cause) }),
  });
  const frames = Number(values.frames ?? 600);
  if (positionals[0] !== "probe" || positionals.length !== 1 || !Number.isSafeInteger(frames) || frames < 1) return yield* new UsageFailure({ problem: USAGE });
  const out = resolve(values.out ?? "build/window-probe");
  yield* attempt(() => mkdir(out, { recursive: true }));
  yield* buildLibrary();
  const rawPath = join(out, "samples.json"), logPath = join(out, "gc.log");
  const child = yield* attempt(async () => {
    const run = Bun.spawn([process.execPath, join(import.meta.dir, "../window/probeChild.ts"), gameModule, String(frames), String(WARMUP_FRAMES), rawPath], {
      env: { ...process.env, BUN_JSC_logGC: "1" }, stdout: "inherit", stderr: Bun.file(logPath),
    });
    return run.exited;
  });
  const log = yield* attempt(() => readFile(logPath, "utf8"));
  if (child !== 0) return yield* new WindowFailure({ problem: `the probe window run exited ${child}\n${log.split("\n").filter((line) => !line.startsWith("[GC")).slice(-12).join("\n")}` });
  const measured = log.slice(log.indexOf(FRAMES_BEGIN), log.indexOf(FRAMES_END));
  const samples = JSON.parse(yield* attempt(() => readFile(rawPath, "utf8"))) as ProbeSamples;
  const report = probeReport(samples, gcPauses(measured));
  yield* attempt(() => writeFile(join(out, "probe.json"), JSON.stringify(report, null, 2) + "\n"));
  console.log(JSON.stringify(report));
}).pipe(Effect.mapError((cause) => cause._tag === "UsageFailure" ? cause : new WindowFailure({ problem: cause.message })));
