import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as BunServices from "@effect/platform-bun/BunServices";
import { Deferred, Effect, FiberSet, Schema } from "effect";
import { ChildProcess } from "effect/process";
import type { HeadlessClient, SoundCue } from "../../src/headless/client";
import { spawnLogged } from "./hostProcess";
import { captureScene, sceneWithUnits, RenderFailure, type HeadlessRenderProject, type RenderScene } from "./headlessRender";
import { createSoundResolver } from "./standaloneSound";

export interface StandaloneInput {
  readonly buttons: readonly string[];
  readonly axisX: number;
  readonly axisY: number;
}

export interface StandaloneSession {
  readonly client: HeadlessClient;
  step(input: StandaloneInput): void;
  checksum(): string;
  frame?(): number;
  finished?(): boolean;
  close(): void;
}

export interface StandaloneGame {
  readonly title: string;
  readonly render: HeadlessRenderProject;
  create(options?: { readonly script?: string }): Promise<StandaloneSession>;
}

export interface StandaloneOptions {
  readonly script?: string;
  readonly frames?: number;
  readonly out?: string;
  readonly headless?: boolean;
  readonly captureFrames?: readonly number[];
  readonly recordChecksums?: boolean;
  readonly gamepadIndex?: number;
}

export interface StandaloneFrame {
  readonly scene: RenderScene;
  readonly sounds: readonly SoundCue[];
  readonly frame: number;
  readonly step: number;
  readonly checksum?: string;
  readonly capture: boolean;
  readonly done: boolean;

  readonly serverMs: number;
}







const framesAhead = (scripted: boolean) => (scripted ? 3 : 1);

const Input = Schema.Struct({ buttons: Schema.Array(Schema.String), axisX: Schema.Finite, axisY: Schema.Finite });
const Sound = Schema.Struct({
  event: Schema.Literals(["create", "start", "stop", "volume"]), frame: Schema.Finite,
  kind: Schema.Literals(["sound", "music"]), looping: Schema.Boolean, effectiveVolume: Schema.Finite,
  source: Schema.optional(Schema.String), label: Schema.optional(Schema.String),
  handle: Schema.Struct({ kind: Schema.String, id: Schema.Finite }),
  volume: Schema.Finite, pitch: Schema.Finite, x: Schema.Finite, y: Schema.Finite, z: Schema.Finite,
});

const Completion = Schema.fromJsonString(Schema.StructWithRest(Schema.Struct({ error: Schema.optional(Schema.String) }), [Schema.Record(Schema.String, Schema.Unknown)]));

const attempt = <A>(run: () => Promise<A>) => Effect.tryPromise({ try: run, catch: (cause) => new RenderFailure({ cause }) });
const failed = (problem: string) => new RenderFailure({ cause: new Error(problem) });

const problemOf = (failure: RenderFailure) => (failure.cause instanceof Error ? failure.cause.message : String(failure.cause));
const decode = <S extends Schema.Top & { readonly DecodingServices: never }>(schema: S, input: unknown) =>
  Schema.decodeUnknownEffect(schema)(input).pipe(Effect.mapError((cause) => failed(cause.message)));

const thrownAsFailure = Effect.catchDefect((cause) => Effect.fail(new RenderFailure({ cause })));





export const openStandalone = (game: StandaloneGame, options: StandaloneOptions = {}) => Effect.gen(function*() {
  const script = options.script === undefined ? undefined : yield* attempt(() => Bun.file(options.script!).text());
  const session = yield* Effect.acquireRelease(attempt(() => game.create(script === undefined ? undefined : { script })), (opened) => Effect.sync(() => opened.close()));
  let soundOffset = 0, steps = 0;
  const checksums: { step: number; frame: number; checksum: string; simulationMs: number }[] = [];
  const captures = new Set(options.captureFrames ?? []);
  const recordChecksums = options.recordChecksums ?? options.script !== undefined;
  const sounds = createSoundResolver(game.render.readAsset);
  const assets = new Map<string, Promise<Uint8Array | undefined>>();
  const completion = yield* Deferred.make<Readonly<Record<string, unknown>>, RenderFailure>();
  const bundle = yield* attempt(() => Bun.build({ entrypoints: [join(import.meta.dir, "browser/standalone.ts")], target: "browser", minify: true }));
  if (!bundle.success || bundle.outputs[0] === undefined) return yield* failed(bundle.logs.join("\n"));
  const javascript = yield* attempt(() => bundle.outputs[0]!.text());
  if (options.out !== undefined) yield* attempt(() => mkdir(options.out!, { recursive: true }));
  const step = (body: string) => Effect.gen(function*() {
    const input = yield* decode(Schema.fromJsonString(Input), body);
    const start = performance.now();
    session.step(input);
    const frame = session.frame?.() ?? session.client.frame;
    const checksum = recordChecksums ? session.checksum() : undefined;
    steps++;
    if (checksum !== undefined) checksums.push({ step: steps, frame, checksum, simulationMs: performance.now() - start });
    const capture = captures.delete(frame);
    const scene = sceneWithUnits(game.render, captureScene(session.client, { visibleOnly: !capture }));
    const cues = session.client.soundLog.slice(soundOffset);
    soundOffset = session.client.soundLog.length;
    if (capture && options.out !== undefined) yield* attempt(() => Bun.write(join(options.out!, `p${scene.client}-frame-${frame}.json`), JSON.stringify(scene)));
    return { scene: { ...scene, frame, units: [], effects: scene.effects.filter((effect) => effect.alpha > 0 && effect.scale > 0 && !effect.flat), ui: scene.ui.filter((element) => element.visible && element.alpha > 0) },
      sounds: cues, step: steps, frame, ...(checksum === undefined ? {} : { checksum }), capture, done: options.frames !== undefined && steps >= options.frames, serverMs: performance.now() - start } satisfies StandaloneFrame;
  });
  const handle = (request: Request, server: Bun.Server<undefined>) => Effect.gen(function*() {
    const url = new URL(request.url);
    if (url.pathname === "/") return new Response(`<!doctype html><html><head><title>${game.title.replaceAll("<", "&lt;")}</title><style>html,body{margin:0;width:100%;height:100%;background:#101522;overflow:hidden}body{display:flex;align-items:center;justify-content:center}canvas{max-width:100%;max-height:100%;object-fit:contain}#status{position:fixed;bottom:12px;left:16px;color:white;font:14px sans-serif;background:#101522bb;padding:6px 10px;border-radius:5px}</style></head><body><script type="module" src="/player.js"></script></body></html>`, { headers: {
      "content-type": "text/html",

      "cross-origin-opener-policy": "same-origin", "cross-origin-embedder-policy": "require-corp",
    } });
    if (url.pathname === "/player.js") return new Response(javascript, { headers: { "content-type": "text/javascript" } });
    if (url.pathname === "/config") return Response.json({ title: game.title, width: game.render.width ?? 1280, height: game.render.height ?? 720, scripted: options.script !== undefined, samples: options.out !== undefined, gamepadIndex: options.gamepadIndex, frames: options.frames, ahead: framesAhead(options.script !== undefined) });
    if (url.pathname === "/prepare") return Response.json({ scene: sceneWithUnits(game.render, captureScene(session.client)), models: game.render.preloadModels ?? [], step: steps });
    if (url.pathname === "/asset") {
      const path = url.searchParams.get("path") ?? "";
      let data = assets.get(path);
      if (data === undefined) assets.set(path, data = game.render.readAsset(path));
      const pending = data;
      const bytes = yield* attempt(() => pending);
      return bytes === undefined ? new Response(`missing map asset: ${path}`, { status: 404 }) : new Response(new Uint8Array(bytes));
    }
    if (url.pathname === "/sound" && request.method === "POST") {
      const cue = yield* decode(Sound, yield* attempt(() => request.json()));
      const resolved = yield* attempt(() => sounds({ ...cue, source: cue.source, label: cue.label }));
      return resolved === undefined ? new Response(`missing sound: ${cue.source ?? cue.label}`, { status: 404 }) : new Response(new Uint8Array(resolved.bytes), { headers: { "x-wisp-sound-path": resolved.path } });
    }
    if (url.pathname === "/frames") return server.upgrade(request) ? undefined : new Response("frames need a WebSocket", { status: 400 });
    if (url.pathname === "/capture" && request.method === "POST" && options.out !== undefined) {
      const frame = Number(url.searchParams.get("frame")), slot = session.client.slot;
      if (!Number.isSafeInteger(frame) || frame < 0) return yield* failed("invalid capture frame");
      const image = yield* attempt(() => request.arrayBuffer());
      yield* attempt(() => Bun.write(join(options.out!, `p${slot}-frame-${frame}.png`), image));
      return new Response("saved");
    }
    if (url.pathname === "/complete" && request.method === "POST") {
      const result = yield* decode(Completion, yield* attempt(() => request.text()));
      if (options.out !== undefined) {
        const out = options.out;
        if (recordChecksums) yield* attempt(() => Bun.write(join(out, "checksums.jsonl"), checksums.map((row) => JSON.stringify(row)).join("\n") + "\n"));
        yield* attempt(() => Bun.write(join(out, "standalone.json"), JSON.stringify({ ...result, steps, capturesMissing: [...captures] }, null, 2) + "\n"));
      }
      if (result.error !== undefined) yield* Deferred.fail(completion, failed(result.error));
      else if (captures.size > 0) yield* Deferred.fail(completion, failed(`capture frames not reached: ${[...captures].join(", ")}`));
      else yield* Deferred.succeed(completion, result);
      return new Response("saved");
    }
    return new Response("not found", { status: 404 });
  }).pipe(thrownAsFailure, Effect.catch((failure) => Effect.succeed(new Response(problemOf(failure), { status: 500 }))));
  const run = yield* FiberSet.makeRuntimePromise<never>();
  let steps$ = Promise.resolve();

  const server = yield* Effect.acquireRelease(Effect.sync(() => Bun.serve({ hostname: "127.0.0.1", port: 0, websocket: {
    message(socket, message) {

      steps$ = steps$.then(async () => {
        socket.send(JSON.stringify(await run(step(String(message)).pipe(thrownAsFailure, Effect.catch((failure) => Effect.succeed({ error: problemOf(failure) }))))));
      }).catch(() => undefined);
    },
  }, fetch: (request, server) => run(handle(request, server)) })), (open) => Effect.promise(() => open.stop(true)));
  return { url: `http://127.0.0.1:${server.port}/`, completed: Deferred.await(completion) };
});


export const runStandalone = (game: StandaloneGame, options: StandaloneOptions = {}) => Effect.scoped(Effect.gen(function*() {
  const player = yield* openStandalone(game, options);
  const directory = yield* Effect.acquireRelease(attempt(() => mkdtemp(join(tmpdir(), "wisp-player-"))), (path) => Effect.promise(() => rm(path, { recursive: true, force: true })));
  const browser = yield* spawnLogged(ChildProcess.make(game.render.chrome ?? process.env.CHROME ?? "google-chrome-stable", [
    "--no-first-run", "--no-default-browser-check", "--disable-background-networking", "--disable-sync", "--autoplay-policy=no-user-gesture-required",
    "--disable-renderer-backgrounding", "--disable-background-timer-throttling", `--user-data-dir=${directory}`, `--window-size=${game.render.width ?? 1280},${game.render.height ?? 720}`,
    ...(options.headless === true ? ["--headless=new", "--use-gl=angle", ...(process.env.CI === "true" ? ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] : ["--use-angle=gl"])] : []), `--app=${player.url}`,
  ]), { stdout: join(directory, "chrome.out"), stderr: join(directory, "chrome.log") }).pipe(Effect.mapError((cause) => new RenderFailure({ cause })));
  console.log(`${game.title}: standalone window opened. Connect a controller or use the keyboard.`);
  const closed = browser.handle.exitCode.pipe(
    Effect.mapError((cause) => new RenderFailure({ cause })),
    Effect.flatMap((code) => (code !== 0 ? Effect.fail(failed(`player window exited (${code})`)) : Effect.void)),
  );
  const result = yield* Effect.raceFirst(player.completed, closed);
  if (result !== undefined) {
    const { frameSamplesMs, intervalSamplesMs, requestSamplesMs, renderSamplesMs, frameTimings, ...summary } = result;
    console.log(JSON.stringify(summary));
  }
})).pipe(Effect.provide(BunServices.layer));
