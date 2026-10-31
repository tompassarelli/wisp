import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { Console, Effect, Schema } from "effect";
import { type Command, UsageFailure, describeCause } from "../cli/command";
import { decodePressRun, latencyReport } from "../play/latencyComparison";
import { pressLatency, pressLatencyArguments } from "../play/pressLatency";

class LatencyFailure extends Schema.TaggedError<LatencyFailure, { readonly brand: unique symbol }>()("LatencyFailure", { problem: Schema.String }) {
  override get message() { return this.problem; }
}

const USAGE = "press --window native|chrome|warcraft|reference --display :N --wayland-runtime DIR --key KEYSYM --region X,Y,W,H --control X,Y,W,H --out DIR [--trials N] [--settle-ms MS] [--sample-log FILE] [--warcraft press-latency.json]   (wisp:docs/native-window-plan.md, box W2)";

const attempt = <A>(run: () => Promise<A>) => Effect.tryPromise({ try: run, catch: (cause) => new LatencyFailure({ problem: describeCause(cause) }) });

/** `latency press`: presses a key in a window already on a private desktop, times each press to the changed pixels, and writes `latency.json` with the window's share of the time and, from `--warcraft`, the native Warcraft run it is compared with. */
export const latency: Command = (args) => Effect.gen(function*() {
  const { values, positionals } = yield* Effect.try({
    try: () => parseArgs({ args: [...args], allowPositionals: true, strict: false, options: { warcraft: { type: "string" } } }),
    catch: (cause) => new UsageFailure({ problem: describeCause(cause) }),
  });
  const options = pressLatencyArguments(args);
  if (positionals[0] !== "press" || typeof options === "string") return yield* new UsageFailure({ problem: typeof options === "string" ? options : USAGE });
  if (options.window === "native" && options.sampleLog === undefined) return yield* new UsageFailure({ problem: "--window native needs --sample-log FILE, the WISP_WINDOW_SAMPLE_LOG the window was started with" });
  const comparison = typeof values.warcraft === "string" ? values.warcraft : undefined;
  const warcraft = comparison === undefined ? undefined : yield* attempt(async () => decodePressRun(JSON.parse(await readFile(resolve(comparison), "utf8"))));
  const run = yield* pressLatency({ ...options, out: resolve(options.out) }).pipe(Effect.mapError((cause) => new LatencyFailure({ problem: describeCause(cause) })));
  const { rows, ...summary } = run;
  const report = latencyReport(summary, warcraft);
  yield* attempt(async () => { await mkdir(resolve(options.out), { recursive: true }); await writeFile(join(resolve(options.out), "latency.json"), JSON.stringify(report, null, 2) + "\n"); });
  yield* Console.log(JSON.stringify(report));
}).pipe(Effect.mapError((cause) => cause._tag === "UsageFailure" ? cause : new LatencyFailure({ problem: cause.message })));
