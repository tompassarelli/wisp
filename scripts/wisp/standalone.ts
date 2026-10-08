import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect, Schema } from "effect";
import type { HeadlessClient, SoundCue } from "../../src/headless/client";
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
  /** The server's step and scene copy for this frame, in milliseconds. */
  readonly serverMs: number;
}

const Input = Schema.Struct({ buttons: Schema.Array(Schema.String), axisX: Schema.Finite, axisY: Schema.Finite });
const Sound = Schema.Struct({
  event: Schema.Literals(["create", "start"]), frame: Schema.Finite,
  source: Schema.optional(Schema.String), label: Schema.optional(Schema.String),
  handle: Schema.Struct({ kind: Schema.String, id: Schema.Finite }),
  volume: Schema.Finite, pitch: Schema.Finite, x: Schema.Finite, y: Schema.Finite, z: Schema.Finite,
});

/** One fixed simulation step per presented frame; wall-clock delays never change game arithmetic. */
export async function openStandalone(game: StandaloneGame, options: StandaloneOptions = {}) {
  const session = await game.create(options.script === undefined ? undefined : { script: await Bun.file(options.script).text() });
  let soundOffset = 0, steps = 0;
  const checksums: { step: number; frame: number; checksum: string; simulationMs: number }[] = [];
  const captures = new Set(options.captureFrames ?? []);
  const recordChecksums = options.recordChecksums ?? options.script !== undefined;
  const sounds = createSoundResolver(game.render.readAsset);
  const assets = new Map<string, Promise<Uint8Array | undefined>>();
  let finish!: (result: unknown) => void;
  let fail!: (error: Error) => void;
  const completed = new Promise<unknown>((resolve, reject) => { finish = resolve; fail = reject; });
  const bundle = await Bun.build({ entrypoints: [join(import.meta.dir, "browser/standalone.ts")], target: "browser", minify: true });
  if (!bundle.success || bundle.outputs[0] === undefined) { session.close(); throw new Error(bundle.logs.join("\n")); }
  const javascript = await bundle.outputs[0].text();
  if (options.out !== undefined) await mkdir(options.out, { recursive: true });
  const step = async (body: string): Promise<StandaloneFrame> => {
    const input = Schema.decodeUnknownSync(Schema.fromJsonString(Input))(body);
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
    if (capture && options.out !== undefined) await Bun.write(join(options.out, `p${scene.client}-frame-${frame}.json`), JSON.stringify(scene));
    return { scene: { ...scene, frame, units: [], effects: scene.effects.filter((effect) => effect.alpha > 0 && effect.scale > 0 && !effect.flat), ui: scene.ui.filter((element) => element.visible && element.alpha > 0) },
      sounds: cues, step: steps, frame, ...(checksum === undefined ? {} : { checksum }), capture, done: options.frames !== undefined && steps >= options.frames, serverMs: performance.now() - start };
  };
  // Frames travel over one WebSocket: a fetch per frame cost about 10 ms of browser request handling under load.
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, websocket: {
    async message(socket, message) {
      socket.send(JSON.stringify(await step(String(message)).catch((cause: unknown) => ({ error: cause instanceof Error ? cause.message : String(cause) }))));
    },
  }, async fetch(request, server) {
    const url = new URL(request.url);
    try {
      if (url.pathname === "/") return new Response(`<!doctype html><html><head><title>${game.title.replaceAll("<", "&lt;")}</title><style>html,body{margin:0;width:100%;height:100%;background:#101522;overflow:hidden}body{display:flex;align-items:center;justify-content:center}canvas{max-width:100%;max-height:100%;object-fit:contain}#status{position:fixed;bottom:12px;left:16px;color:white;font:14px sans-serif;background:#101522bb;padding:6px 10px;border-radius:5px}</style></head><body><script type="module" src="/player.js"></script></body></html>`, { headers: {
        "content-type": "text/html",
        // Cross-origin isolation gives the page 5 µs timers instead of 100 µs with random jitter, so frame timing reads on-time 60 Hz frames as 16.67 ms.
        "cross-origin-opener-policy": "same-origin", "cross-origin-embedder-policy": "require-corp",
      } });
      if (url.pathname === "/player.js") return new Response(javascript, { headers: { "content-type": "text/javascript" } });
      if (url.pathname === "/config") return Response.json({ title: game.title, width: game.render.width ?? 1280, height: game.render.height ?? 720, scripted: options.script !== undefined, samples: options.out !== undefined, gamepadIndex: options.gamepadIndex });
      if (url.pathname === "/prepare") return Response.json({ scene: sceneWithUnits(game.render, captureScene(session.client)), models: game.render.preloadModels ?? [], step: steps });
      if (url.pathname === "/asset") {
        const path = url.searchParams.get("path") ?? "";
        let data = assets.get(path);
        if (data === undefined) assets.set(path, data = game.render.readAsset(path));
        const bytes = await data;
        return bytes === undefined ? new Response(`missing map asset: ${path}`, { status: 404 }) : new Response(new Uint8Array(bytes));
      }
      if (url.pathname === "/sound" && request.method === "POST") {
        const cue = Schema.decodeUnknownSync(Sound)(await request.json());
        const resolved = await sounds({ ...cue, source: cue.source, label: cue.label });
        return resolved === undefined ? new Response(`missing sound: ${cue.source ?? cue.label}`, { status: 404 }) : new Response(new Uint8Array(resolved.bytes), { headers: { "x-wisp-sound-path": resolved.path } });
      }
      if (url.pathname === "/frames") return server.upgrade(request) ? undefined : new Response("frames need a WebSocket", { status: 400 });
      if (url.pathname === "/capture" && request.method === "POST" && options.out !== undefined) {
        const frame = Number(url.searchParams.get("frame")), slot = session.client.slot;
        if (!Number.isSafeInteger(frame) || frame < 0) throw new Error("invalid capture frame");
        await Bun.write(join(options.out, `p${slot}-frame-${frame}.png`), await request.arrayBuffer());
        return new Response("saved");
      }
      if (url.pathname === "/complete" && request.method === "POST") {
        const result = await request.json() as { error?: string };
        if (options.out !== undefined) {
          if (recordChecksums) await Bun.write(join(options.out, "checksums.jsonl"), checksums.map((row) => JSON.stringify(row)).join("\n") + "\n");
          await Bun.write(join(options.out, "standalone.json"), JSON.stringify({ ...result, steps, capturesMissing: [...captures] }, null, 2) + "\n");
        }
        if (result.error !== undefined) fail(new Error(result.error));
        else if (captures.size > 0) fail(new Error(`capture frames not reached: ${[...captures].join(", ")}`));
        else finish(result);
        return new Response("saved");
      }
      return new Response("not found", { status: 404 });
    } catch (cause) { return new Response(cause instanceof Error ? cause.message : String(cause), { status: 500 }); }
  }});
  return { url: `http://127.0.0.1:${server.port}/`, completed, close: async () => { await server.stop(true); session.close(); } };
}

/** Opens an owned browser window and keeps its map session alive until the window closes. */
export const runStandalone = (game: StandaloneGame, options: StandaloneOptions = {}) => Effect.scoped(Effect.gen(function*() {
  const attempt = <A>(run: () => Promise<A>) => Effect.tryPromise({ try: run, catch: (cause) => new RenderFailure({ cause }) });
  const player = yield* Effect.acquireRelease(attempt(() => openStandalone(game, options)), (opened) => Effect.promise(opened.close));
  const directory = yield* Effect.acquireRelease(attempt(() => mkdtemp(join(tmpdir(), "wisp-player-"))), (path) => Effect.promise(() => rm(path, { recursive: true, force: true })));
  const browser = yield* Effect.acquireRelease(attempt(async () => Bun.spawn([game.render.chrome ?? process.env.CHROME ?? "google-chrome-stable",
    "--no-first-run", "--no-default-browser-check", "--disable-background-networking", "--disable-sync", "--autoplay-policy=no-user-gesture-required",
    "--disable-renderer-backgrounding", "--disable-background-timer-throttling", `--user-data-dir=${directory}`, `--window-size=${game.render.width ?? 1280},${game.render.height ?? 720}`,
    ...(options.headless === true ? ["--headless=new", "--use-gl=angle", "--use-angle=gl"] : []), `--app=${player.url}`,
  ], { stdout: "ignore", stderr: Bun.file(join(directory, "chrome.log")) })), (process) => Effect.promise(async () => { if (process.exitCode === null) process.kill(); await process.exited; }));
  console.log(`${game.title}: standalone window opened. Connect a controller or use the keyboard.`);
  const result = yield* attempt(() => Promise.race([player.completed, browser.exited.then((code) => { if (code !== 0) throw new Error(`player window exited (${code})`); return undefined; })]));
  if (result !== undefined) {
    const { frameSamplesMs, intervalSamplesMs, requestSamplesMs, renderSamplesMs, frameTimings, ...summary } = result as Record<string, unknown>;
    console.log(JSON.stringify(summary));
  }
}));
