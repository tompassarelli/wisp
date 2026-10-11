import { Cause, Console, Effect, Exit, Schema } from "effect";
import { type Command, UsageFailure, describeCause, flagValues, wholeFlag } from "../command";
import { type HeadlessProject, installHeadless, loadMapEntry, playHeadless } from "../headless";
import { emitJson } from "../jsonResults";
import { predictionLines } from "../perf";
import { type Graphics, type Lever, parseGraphics, parseLevers } from "../graphicsProfiles";
import { requireGpuLease } from "../gpuLease";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { parseMDL } from "../../../vendor/war3-model.mjs";
import { captureScene, type HeadlessRenderProject, loadEffectDeaths, renderScenes, type RenderScene, sceneWithUnits } from "../headlessRender";
import { parseModelMDX } from "../models";
import { type TextureIdentity, uiReport } from "../screen";
import { type BoundsModel, boundsModel, inFrame, sceneBounds } from "../screenBounds";
import { runJourney } from "../../../src/headless/journey";
import type { Lockstep } from "../../../src/headless/lockstep";
import { sceneMatchFrame } from "../../../src/runtime/scene";
import type { Journey } from "../../../src/headless/journey";
import { step } from "../timings";
import { type PerfProject, measureRun } from "./perf";
import { FRAME_MS } from "../../../src/headless/frameRate";

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

export const MAX_CLIENTS = 4;

const JourneyFile = Schema.Struct({
  frames: Schema.Finite,
  events: Schema.Array(Schema.Union([
    Schema.Struct({ frame: Schema.Finite, player: Schema.Finite, chat: Schema.String }),
    Schema.Struct({ frame: Schema.Finite, player: Schema.Finite, key: Schema.Finite, meta: Schema.Finite, down: Schema.optionalKey(Schema.Boolean) }),
    Schema.Struct({ frame: Schema.Finite, reload: Schema.Literal(true) }),
  ])),
});

const matchFrameOf = (globalPrefixes: readonly string[]) => (clients: Lockstep): number | undefined => {
  let frame: number | undefined;
  clients.clients[0]?.run(() => { frame = sceneMatchFrame(["__wisp", ...globalPrefixes]); });
  return frame;
};

/** Per scene: its frame rows (with the in-frame verdict of a frame showing a portrait) and its posed model rows at a `width` x `height` canvas, without Chrome. */
async function boundsImages(render: HeadlessRenderProject, scenes: readonly RenderScene[], width: number, height: number, graphics: Graphics) {
  const read = async (path: string) => {
    if (render.resolveAsset === undefined) {
      const bytes = await render.readAsset(path, graphics);
      return { bytes, layer: bytes === undefined ? undefined : "base" };
    }
    const { bytes, selected } = await render.resolveAsset(path, graphics);
    return { bytes, layer: selected?.layer };
  };
  const posed = scenes.map((scene) => sceneWithUnits(render, scene));
  const models = new Map<string, BoundsModel>();
  const portraits = Object.values(render.portraits ?? {});
  for (const path of new Set([...posed, ...portraits.map((portrait) => portrait.scene)].flatMap((scene) => scene.effects.map((pose) => pose.model)))) {
    const { bytes } = await read(path);
    if (bytes !== undefined) models.set(path, boundsModel(new TextDecoder().decode(bytes.subarray(0, 4)) === "MDLX" ? parseModelMDX(bytes.slice().buffer) : parseMDL(new TextDecoder().decode(bytes))));
  }
  const textures = new Map<string, TextureIdentity>();
  for (const path of new Set(scenes.flatMap((scene) => scene.ui.map((frame) => frame.texture)))) if (path !== "") {
    const { bytes, layer } = await read(path);
    if (bytes !== undefined && layer !== undefined) textures.set(path, { layer, sha256: new Bun.CryptoHasher("sha256").update(bytes).digest("hex") });
  }
  return posed.map((scene) => ({ frame: scene.frame, ...(scene.matchFrame === undefined ? {} : { matchFrame: scene.matchFrame }), client: scene.client,
    ui: uiReport(scene, width, height, (path) => textures.get(path)).map((row) => {
      const portrait = row.texture === null ? undefined : render.portraits?.[row.texture];
      return portrait === undefined ? row : { ...row, inFrame: inFrame(portrait, (path) => models.get(path), row.pixels) };
    }), models: sceneBounds(scene, (path) => models.get(path), width, height) }));
}

export function headlessArguments(args: readonly string[]) {
  const named: string[] = [], frames: number[] = [];
  let match = false;
  let render: string | undefined, bounds: string | undefined, journey: string | undefined, sounds: string | undefined;
  let screen: { width: number; height: number } | undefined;
  let runs = 1, stepFrames: number | undefined, musicVolume: number | undefined, graphics: Graphics = "classic", look: Lever[] = [];
  for (let index = 0; index < args.length; index++) {
    const arg = args[index] ?? "";
    if (arg === "--frames" || arg === "--match-frames") {
      if (frames.length > 0) throw new Error("--frames and --match-frames are given once, not together");
      match = arg === "--match-frames";
      while (index + 1 < args.length && /^\d+(,\d+)*$/.test(args[index + 1] ?? "")) frames.push(...(args[++index] ?? "").split(",").map(Number));
      if (frames.length === 0) throw new Error(`${arg} needs one or more frame numbers`);
    } else if (["--render", "--bounds", "--journey", "--sound-cues", "--music-volume", "--clients", "--runs", "--step", "--graphics", "--look", "--resolution"].includes(arg)) {
      const value = args[++index];
      if (value === undefined || value.startsWith("--")) throw new Error(`${arg} needs a value`);
      if (arg === "--render") render = value;
      if (arg === "--bounds") bounds = value;
      if (arg === "--journey") journey = value;
      if (arg === "--sound-cues") sounds = value;
      if (arg === "--music-volume") {
        musicVolume = Number(value);
        if (!(musicVolume >= 0 && musicVolume <= 1)) throw new Error("--music-volume needs a number from 0 to 1");
      }
      if (arg === "--graphics") graphics = parseGraphics(value);
      if (arg === "--look") look = parseLevers(value);
      if (arg === "--resolution") {
        const size = /^([1-9]\d*)x([1-9]\d*)$/.exec(value);
        if (size === null) throw new Error("--resolution takes WIDTHxHEIGHT in pixels, such as 800x600");
        screen = { width: Number(size[1]), height: Number(size[2]) };
      }
      if (arg === "--runs" || arg === "--step") {
        const number = wholeFlag([arg, value], arg.slice(2), { min: 1 });
        if (number instanceof UsageFailure || number === undefined) throw new Error(`${arg} takes a positive whole number`);
        if (arg === "--runs") runs = number;
        else stepFrames = number;
      }
    } else if (arg.startsWith("--clients=") || arg === "--cost" || arg === "--json") continue;
    else if (arg.startsWith("--")) throw new Error(`unknown headless option: ${arg}`);
    else named.push(arg);
  }
  if ((render === undefined && bounds === undefined) !== (frames.length === 0)) throw new Error("--render DIR or --bounds DIR and --frames N... (or --match-frames N...) are used together");
  if (journey !== undefined && named.length > 0) throw new Error("--journey FILE takes the place of a named journey");
  if (runs > 1 && (render !== undefined || bounds !== undefined)) throw new Error("--render and --bounds capture one run; use --runs for checks without them");
  if (graphics !== "classic" && render === undefined && bounds === undefined) throw new Error("--graphics chooses what --render draws and --bounds measures");
  if (look.length > 0 && render === undefined) throw new Error("--look chooses what --render draws");
  return { named, frames: [...new Set(frames)].sort((a, b) => a - b), match, render, bounds, journey, sounds, runs, stepFrames, musicVolume, graphics, look, screen };
}

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
    if (!options.match && options.frames.some((frame) => frame > journey.frames)) return yield* new UsageFailure({ problem: `capture frames must be within this journey's 0–${journey.frames} frames` });
    if ((options.render !== undefined || options.bounds !== undefined) && project.render === undefined) return yield* new UsageFailure({ problem: "this map must provide render.readAsset before using --render or --bounds" });
    if (options.render !== undefined) yield* requireGpuLease();
    const entry = yield* Effect.tryPromise({
      try: () => loadMapEntry(project.entry),
      catch: (cause) => new HeadlessFailure({ journey: "loading the map entry", problems: 1, cause }),
    }).pipe(step("load map"));
    let scenes: RenderScene[] = [];
    const observation = { observationFrames: options.frames, ...(options.match ? { observationClock: matchFrameOf(project.map.globalPrefixes) } : {}) };
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
            const clients = runtime.clients(entry, players, { keepCalls: 64, ...(options.screen === undefined ? {} : { screen: options.screen }), ...(options.musicVolume === undefined ? {} : { musicSlider: options.musicVolume }), effectDeaths: (model) => { destroyedModels.add(model); return undefined; } });
            let sample = playHeadless(clients, journey, project.map.filePrefix, project.scene, { ...(options.stepFrames === undefined ? {} : { stepFrames: options.stepFrames }), ...observation, observe: (running, frame) => { for (const client of running.clients) scenes.push(captureScene(client, options.match ? { matchFrame: frame } : {})); } });
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
    const speedMultiple = benchmark.frames * FRAME_MS / Math.max(elapsedMs, Number.EPSILON);
    const render = project.render;
    if ((options.render !== undefined || options.bounds !== undefined) && render !== undefined && destroyedModels.size > 0) {

      const effectDeaths = yield* Effect.tryPromise({ try: () => loadEffectDeaths(render, destroyedModels, options.graphics), catch: (cause) => new HeadlessFailure({ journey: name, problems: 1, cause }) });
      scenes = yield* Effect.try({
        try: () => {
          const runtime = installHeadless(project.map);
          const drawn: RenderScene[] = [];
          try {
            runJourney(runtime.clients(entry, players, { keepCalls: 1, effectDeaths, ...(options.screen === undefined ? {} : { screen: options.screen }) }), journey, { ...observation, observe: (running, frame) => { for (const client of running.clients) drawn.push(captureScene(client, options.match ? { matchFrame: frame } : {})); } });
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
    const unreached = options.match ? options.frames.filter((frame) => !scenes.some((scene) => scene.matchFrame === frame)) : [];
    if (unreached.length > 0) return yield* new HeadlessFailure({ journey: name, problems: unreached.length, cause: `the map's match frame never reached ${unreached.join(", ")} in ${journey.frames} frames (the scene report's frame; a longer journey reaches it)` });
    if (!json) yield* Console.log(report.lines.join("\n"));
    if (options.runs > 1 || options.stepFrames !== undefined) {
      if (json) yield* emitJson("headless", { type: "benchmark", ...benchmark, speedMultiple });
      else yield* Console.log(`${benchmark.runs} starts, ${benchmark.failures} failed runs; ${speedMultiple.toFixed(1)}x real time, ${elapsedMs.toFixed(1)} ms wall, ${benchmark.cpuMs.toFixed(1)} ms CPU`);
    }
    for (const cue of report.sounds) if (cue.event !== "create") {
      if (json) yield* emitJson("headless", { type: "sound", ...cue });
      else yield* Console.log(`p${cue.client} frame ${cue.frame}: ${cue.kind} ${cue.event} ${cue.label ?? cue.source ?? "unknown"} loop ${cue.looping} volume ${cue.volume} effective ${cue.effectiveVolume} pitch ${cue.pitch}`);
    }
    if (options.sounds !== undefined) yield* Effect.tryPromise({ try: () => Bun.write(options.sounds ?? "", JSON.stringify(report.sounds, null, 2) + "\n"), catch: (cause) => new HeadlessFailure({ journey: name, problems: 1, cause }) });
    const canvas = options.screen ?? { width: render?.width ?? 1280, height: render?.height ?? 720 };
    const bounds = (options.render !== undefined || options.bounds !== undefined) && render !== undefined
      ? yield* Effect.tryPromise({ try: () => boundsImages(render, scenes, canvas.width, canvas.height, options.graphics), catch: (cause) => new HeadlessFailure({ journey: name, problems: 1, cause }) }).pipe(step("screen bounds"))
      : [];
    if (options.bounds !== undefined) {
      const directory = options.bounds;
      yield* Effect.tryPromise({
        try: async () => {
          await mkdir(directory, { recursive: true });
          await Bun.write(join(directory, "bounds.json"), JSON.stringify({ graphics: options.graphics, ...canvas, images: bounds }, null, 2) + "\n");
        },
        catch: (cause) => new HeadlessFailure({ journey: name, problems: 1, cause }),
      });
      if (json) yield* emitJson("headless", { type: "bounds", directory, images: bounds.length });
      else yield* Console.log(`${bounds.length} frames measured to ${join(directory, "bounds.json")}`);
    }
    if (options.render !== undefined && project.render !== undefined) {
      const rendered = yield* renderScenes(options.screen === undefined ? project.render : { ...project.render, ...options.screen }, scenes, options.render, options.graphics, options.look, bounds.map((image) => image.models)).pipe(Effect.mapError((cause) => new HeadlessFailure({ journey: name, problems: 1, cause })));
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
