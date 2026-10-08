// `wisp headless`: plays one of the game's journeys in simulated clients of
// its map, in this process, and prints a desync, error reports, a hot reload
// that didn't run and what a player would see wrong (wisp:docs/headless.md).
// With --cost it also plays the journey in 32-bit Lua and prints each
// client's predicted native cost per frame (wisp:docs/frame-cost.md#predicted-native-cost).
import { Cause, Console, Effect, Exit, Schema } from "effect";
import { type Command, UsageFailure, describeCause, flagValues } from "../command";
import { type HeadlessProject, installHeadless, loadMapEntry, playHeadless } from "../headless";
import { emitJson } from "../jsonResults";
import { predictionLines } from "../perf";
import { captureScene, loadEffectDeaths, renderScenes, type RenderScene } from "../headlessRender";
import { runJourney } from "../../../src/headless/journey";
import type { Journey } from "../../../src/headless/journey";
import { step } from "../timings";
import { type PerfProject, measureRun } from "./perf";

export class HeadlessFailure extends Schema.TaggedError<HeadlessFailure>()("HeadlessFailure", {
  journey: Schema.String,
  problems: Schema.Finite,
  cause: Schema.optional(Schema.Unknown),
}) {
  override get message(): string {
    return this.cause === undefined
      ? `${this.journey}: ${this.problems} problem${this.problems === 1 ? "" : "s"}`
      : `${this.journey} stopped: ${describeCause(this.cause)}`;
  }
}

/** The clients the reloader counts: Wisp's per-slot files cover four players. */
export const MAX_CLIENTS = 4;

const JourneyFile = Schema.Struct({
  frames: Schema.Finite,
  events: Schema.Array(Schema.Union([
    Schema.Struct({ frame: Schema.Finite, player: Schema.Finite, chat: Schema.String }),
    Schema.Struct({ frame: Schema.Finite, player: Schema.Finite, key: Schema.Finite, meta: Schema.Finite, down: Schema.optionalKey(Schema.Boolean) }),
    Schema.Struct({ frame: Schema.Finite, reload: Schema.Literal(true) }),
  ])),
});

export function headlessArguments(args: readonly string[]) {
  const named: string[] = [], frames: number[] = [];
  let render: string | undefined, journey: string | undefined, sounds: string | undefined;
  let runs = 1, stepFrames: number | undefined;
  for (let index = 0; index < args.length; index++) {
    const arg = args[index] ?? "";
    if (arg === "--frames") {
      while (index + 1 < args.length && /^\d+(,\d+)*$/.test(args[index + 1] ?? "")) frames.push(...(args[++index] ?? "").split(",").map(Number));
      if (frames.length === 0) throw new Error("--frames needs one or more frame numbers");
    } else if (["--render", "--journey", "--sound-cues", "--clients", "--runs", "--step"].includes(arg)) {
      const value = args[++index];
      if (value === undefined || value.startsWith("--")) throw new Error(`${arg} needs a value`);
      if (arg === "--render") render = value;
      if (arg === "--journey") journey = value;
      if (arg === "--sound-cues") sounds = value;
      if (arg === "--runs" || arg === "--step") {
        const number = Number(value);
        if (!Number.isSafeInteger(number) || number < 1) throw new Error(`${arg} needs a positive integer`);
        if (arg === "--runs") runs = number;
        else stepFrames = number;
      }
    } else if (arg.startsWith("--clients=") || arg === "--cost" || arg === "--json") continue;
    else if (arg.startsWith("--")) throw new Error(`unknown headless option: ${arg}`);
    else named.push(arg);
  }
  if ((render === undefined) !== (frames.length === 0)) throw new Error("--render DIR and --frames N... are used together");
  if (journey !== undefined && named.length > 0) throw new Error("--journey FILE takes the place of a named journey");
  if (runs > 1 && render !== undefined) throw new Error("--render captures one run; use --runs for checks without rendering");
  return { named, frames: [...new Set(frames)].sort((a, b) => a - b), render, journey, sounds, runs, stepFrames };
}

/**
 * `headless [JOURNEY] [--clients N] [--cost]`; loads the game's modules only
 * when it runs. `cost` is the game's perf program, whose run of the journey's
 * name --cost plays.
 */
export const makeHeadless = (load: () => Promise<HeadlessProject>, cost?: PerfProject): Command => (args) => Effect.suspend(() => {
  const json = args.includes("--json");
  const started = performance.now();
  let results = 0;
  let failures = 0;
  let reported = false;
  return Effect.gen(function*() {
    const [clientsText = "2"] = flagValues(args, "clients");
    const options = yield* Effect.try({ try: () => headlessArguments(args), catch: (cause) => new UsageFailure({ problem: describeCause(cause) }) });
    const { named } = options;
    const count = Number(clientsText);
    const predict = args.includes("--cost");
    if (named.length > 1 || !Number.isInteger(count) || count < 1 || count > MAX_CLIENTS || (predict && cost === undefined)) {
      return yield* new UsageFailure({ problem: `headless takes one journey, 1 to ${MAX_CLIENTS} clients${cost === undefined ? "" : " and --cost"}` });
    }
    const project = yield* Effect.tryPromise({ try: load, catch: (cause) => new HeadlessFailure({ journey: "loading the project", problems: 1, cause }) });
    const names = Object.keys(project.journeys);
    const name = options.journey ?? named[0] ?? names[0];
    const journey: Journey | undefined = options.journey === undefined ? (name === undefined ? undefined : project.journeys[name]) : yield* Effect.tryPromise({ try: () => Bun.file(options.journey ?? "").json(), catch: (cause) => new UsageFailure({ problem: describeCause(cause) }) }).pipe(Effect.flatMap(Schema.decodeUnknownEffect(JourneyFile)), Effect.mapError((cause) => new UsageFailure({ problem: describeCause(cause) })));
    if (name === undefined || journey === undefined) return yield* new UsageFailure({ problem: `journeys: ${names.join(", ")}` });
    if (options.frames.some((frame) => frame > journey.frames)) return yield* new UsageFailure({ problem: `capture frames must be within this journey's 0–${journey.frames} frames` });
    if (options.render !== undefined && project.render === undefined) return yield* new UsageFailure({ problem: "this map must provide render.readAsset before using --render" });
    const entry = yield* Effect.tryPromise({
      try: () => loadMapEntry(project.entry),
      catch: (cause) => new HeadlessFailure({ journey: "loading the map entry", problems: 1, cause }),
    }).pipe(step("load map"));
    let scenes: RenderScene[] = [];
    const players = Array.from({ length: count }, (_, slot) => slot);
    const destroyedModels = new Set<string>();
    const samples: ReturnType<typeof playHeadless>[] = [];
    const runStarted = performance.now();
    const cpuStarted = process.cpuUsage();
    const report = yield* Effect.try({
      try: () => {
        const runtime = installHeadless(project.map);
        try {
          let first: string | undefined;
          for (let run = 0; run < options.runs; run++) {
            const clients = runtime.clients(entry, players, { keepCalls: 64, effectDeaths: (model) => { destroyedModels.add(model); return undefined; } });
            let sample = playHeadless(clients, journey, project.map.filePrefix, project.scene, { ...(options.stepFrames === undefined ? {} : { stepFrames: options.stepFrames }), observationFrames: options.frames, observe: (running) => { for (const client of running.clients) scenes.push(captureScene(client)); } });
            const fingerprint = JSON.stringify(sample.clients.map(({ slot, calls, checksum }) => ({ slot, calls, checksum })));
            if (first !== undefined && first !== fingerprint) {
              const message = `run ${run + 1} differs from the first run's calls or checksum`;
              sample = { ...sample, problems: sample.problems + 1, lines: [...sample.lines, message], failures: [...sample.failures, { kind: "check-fail", frame: sample.frames, client: null, message }] };
            }
            first ??= fingerprint;
            samples.push(sample);
            if (sample.problems > 0) return sample;
          }
          const last = samples[samples.length - 1];
          if (last === undefined) throw new Error("no headless run");
          return last;
        } finally {
          runtime.restore();
        }
      },
      catch: (cause) => new HeadlessFailure({ journey: name, problems: 1, cause }),
    }).pipe(step(`${name} in ${count} clients`));
    const elapsedMs = performance.now() - runStarted;
    const cpu = process.cpuUsage(cpuStarted);
    const benchmark = { runs: samples.length, requestedRuns: options.runs, frames: samples.reduce((sum, sample) => sum + sample.frames, 0), failures: samples.filter((sample) => sample.problems > 0).length, elapsedMs, cpuMs: (cpu.user + cpu.system) / 1000 };
    const speedMultiple = benchmark.frames * (1000 / 60) / Math.max(elapsedMs, Number.EPSILON);
    const render = project.render;
    if (options.render !== undefined && render !== undefined && destroyedModels.size > 0) {
      // Death sequences come from model files read asynchronously, so the deterministic journey is played again to draw them during effect cleanup.
      const effectDeaths = yield* Effect.tryPromise({ try: () => loadEffectDeaths(render, destroyedModels), catch: (cause) => new HeadlessFailure({ journey: name, problems: 1, cause }) });
      scenes = yield* Effect.try({
        try: () => {
          const runtime = installHeadless(project.map);
          const drawn: RenderScene[] = [];
          try {
            runJourney(runtime.clients(entry, players, { keepCalls: 1, effectDeaths }), journey, { observationFrames: options.frames, observe: (running) => { for (const client of running.clients) drawn.push(captureScene(client)); } });
          } finally {
            runtime.restore();
          }
          return drawn;
        },
        catch: (cause) => new HeadlessFailure({ journey: name, problems: 1, cause }),
      }).pipe(step(`${name} again with death sequences`));
    }
    for (const sample of samples) if (json) {
      results++;
      yield* emitJson("headless", { type: "result", journey: name, ok: sample.problems === 0, frames: sample.frames, clients: sample.clients });
      for (const finding of sample.failures) {
        failures++;
        yield* emitJson("headless", { type: "failure", ...finding });
      }
    }
    if (!json) yield* Console.log(report.lines.join("\n"));
    if (options.runs > 1 || options.stepFrames !== undefined) {
      if (json) yield* emitJson("headless", { type: "benchmark", ...benchmark, speedMultiple });
      else yield* Console.log(`${benchmark.runs} starts, ${benchmark.failures} failed runs; ${speedMultiple.toFixed(1)}x real time, ${elapsedMs.toFixed(1)} ms wall, ${benchmark.cpuMs.toFixed(1)} ms CPU`);
    }
    for (const cue of report.sounds) if (cue.event === "start") {
      if (json) yield* emitJson("headless", { type: "sound", ...cue });
      else yield* Console.log(`p${cue.client} frame ${cue.frame}: sound ${cue.label ?? cue.source ?? "unknown"} volume ${cue.volume} pitch ${cue.pitch}`);
    }
    if (options.sounds !== undefined) yield* Effect.tryPromise({ try: () => Bun.write(options.sounds ?? "", JSON.stringify(report.sounds, null, 2) + "\n"), catch: (cause) => new HeadlessFailure({ journey: name, problems: 1, cause }) });
    if (options.render !== undefined && project.render !== undefined) {
      const rendered = yield* renderScenes(project.render, scenes, options.render).pipe(Effect.mapError((cause) => new HeadlessFailure({ journey: name, problems: 1, cause })));
      if (json) yield* emitJson("headless", { type: "render", directory: options.render, images: rendered });
      else yield* Console.log(`${rendered.length} frames rendered to ${options.render}`);
    }
    if (predict && cost !== undefined) {
      const { measured } = yield* measureRun(cost, name, journey.frames, false).pipe(
        Effect.mapError((failure) => new HeadlessFailure({ journey: name, problems: 1, cause: failure.message })),
      );
      if (json) yield* emitJson("headless", { type: "cost", journey: name, measured });
      else yield* Console.log(predictionLines(measured).join("\n"));
    }
    if (report.problems > 0) {
      reported = true;
      return yield* new HeadlessFailure({ journey: name, problems: report.problems });
    }
  }).pipe(Effect.onExit((exit) => Effect.gen(function*() {
    if (!json) return;
    if (Exit.isFailure(exit) && !reported) {
      failures++;
      yield* emitJson("headless", { type: "failure", kind: "error", frame: null, client: null, message: describeCause(Cause.squash(exit.cause)) });
    }
    yield* emitJson("headless", { type: "summary", ok: Exit.isSuccess(exit), counts: { results, failures }, elapsedMs: performance.now() - started });
  })));
});
