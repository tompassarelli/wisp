import { mkdtemp, mkdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as BunServices from "@effect/platform-bun/BunServices";
import { Effect, Exit, Schema, Scope } from "effect";
import { ChildProcess } from "effect/process";
import type { EffectDeaths, EffectPose, HeadlessClient } from "../../src/headless/client";
import type { Environment } from "../../src/headless/warcraft3Scenery";
import { pollFor, spawnLogged } from "./hostProcess";
import { deathSeconds } from "./models";
import type { RenderAssetResolution, ResolvedRenderAsset } from "./renderAssets";
import { decodeTerrain, shiftedBounds, worldBounds, type WorldBounds } from "./terrain";

import { GRAPHICS, type Graphics, type Lever, PROFILES, unsupportedLevers } from "./graphicsProfiles";
export type { Graphics } from "./graphicsProfiles";

export interface HeadlessRenderProject {
  /**
   * The map's imported assets and Warcraft assets, kept outside the repository.
   * Definitive accepts `_de.w3mod` and `_hd.w3mod` imports before base files.
   */
  readonly readAsset: (path: string, graphics?: Graphics) => Promise<Uint8Array | undefined>;
  /** Layer-aware reads record each attempted location and the selected import or stock file. */
  readonly resolveAsset?: (path: string, graphics: Graphics) => Promise<ResolvedRenderAsset>;
  /** Unit object type IDs to model paths; effect models already name their paths. */
  readonly unitModels?: Readonly<Record<number, string>>;
  readonly width?: number;
  readonly height?: number;
  readonly chrome?: string;
  readonly preloadModels?: readonly string[];
  /**
   * The map's terrain: its war3map.w3e, or only its world bounds, and the map
   * point the headless world's 0,0 stands on. No effect draws outside the
   * world bounds (wisp:docs/headless.md, "Lighting, fog and sky", world bounds).
   */
  readonly terrain?: { readonly w3e?: Uint8Array; readonly bounds?: WorldBounds; readonly origin?: readonly [number, number] };
}

export interface RenderScene {
  readonly frame: number;
  readonly client: number;
  readonly effects: readonly DrawnPose[];
  readonly units: ReturnType<HeadlessClient["unitPoses"]>;
  readonly camera: ReturnType<HeadlessClient["cameraPose"]>;
  readonly ui: ReturnType<HeadlessClient["frames"]["snapshot"]>;
  readonly environment: SceneEnvironment;
  /** The cinematic filter drawn over the world and under the UI. */
  readonly filter?: ReturnType<HeadlessClient["cineFilterPose"]>;
  /** Floating text tags, drawn over the world at their place and under the UI. */
  readonly textTags?: ReturnType<HeadlessClient["textTags"]["poses"]>;
  /** The world bounds in headless coordinates, when the project gives its terrain. */
  readonly world?: WorldBounds;
}

/** The sky, day/night light and terrain fog the map last set (wisp:docs/headless.md, "Lighting, fog and sky"). */
export interface SceneEnvironment extends Environment {
  /** SetTerrainFogEx/ExV's fields, absent after ResetTerrainFog or before any fog is set. */
  readonly fog?: SceneFog;
}

export interface SceneFog {
  /** 0 linear, 1 exponential, 2 exponential squared, 3 height (3.0). */
  readonly style: number;
  readonly zStart: number;
  readonly zEnd: number;
  readonly density: number;
  /** Red, green and blue, 0 to 1. */
  readonly color: readonly [number, number, number];
  /** The linear range a height fog keeps, which Classic draws. */
  readonly linearStart?: number | undefined;
  readonly linearEnd?: number | undefined;
  readonly maxLinearDensity?: number | undefined;
  readonly drawOverSky?: boolean | undefined;
}

function sceneEnvironment(client: HeadlessClient): SceneEnvironment {
  const { environment, fog } = client.scenery;
  const number = (value: unknown) => (typeof value === "number" ? value : undefined);
  const color = Array.isArray(fog.color) ? fog.color.map(Number) as [number, number, number] : undefined;
  const style = number(fog.style), zStart = number(fog.zStart), zEnd = number(fog.zEnd);
  const drawn = style === undefined || zStart === undefined || zEnd === undefined || color === undefined ? undefined : {
    style, zStart, zEnd, density: number(fog.density) ?? 0, color,
    linearStart: number(fog.linearStart), linearEnd: number(fog.linearEnd), maxLinearDensity: number(fog.maxLinearDensity),
    drawOverSky: typeof fog.drawOverSky === "boolean" ? fog.drawOverSky : undefined,
  };
  return { ...environment, dayNight: { ...environment.dayNight }, ...(drawn === undefined ? {} : { fog: drawn }) };
}

/** A pose the renderer draws: an effect, or a unit drawn like one, which starts on Stand rather than Birth. */
export type DrawnPose = EffectPose & { readonly unit?: true };

export const captureScene = (client: HeadlessClient, options: { readonly visibleOnly?: boolean } = {}): RenderScene => ({
  frame: client.frame, client: client.slot, effects: client.effectPoses({ visibleOnly: options.visibleOnly ?? false }), units: client.unitPoses(), camera: client.cameraPose(), ui: client.frames.snapshot({ visibleOnly: options.visibleOnly ?? false }), filter: client.cineFilterPose(), textTags: client.textTags.poses(),
  environment: sceneEnvironment(client),
});

/** The Death sequence lengths of `models`, read from the map's assets, for clients whose destroyed effects are drawn. */
export async function loadEffectDeaths(project: HeadlessRenderProject, models: Iterable<string>, graphics: Graphics = "classic"): Promise<EffectDeaths> {
  const deaths = new Map<string, number | undefined>();
  for (const model of models) {
    const bytes = project.resolveAsset === undefined ? await project.readAsset(model, graphics) : (await project.resolveAsset(model, graphics)).bytes;
    deaths.set(model, bytes === undefined ? undefined : deathSeconds(bytes));
  }
  return (model) => deaths.get(model);
}

const terrainBounds = new WeakMap<Uint8Array, WorldBounds>();
function projectWorld(project: HeadlessRenderProject): WorldBounds | undefined {
  const terrain = project.terrain, w3e = terrain?.w3e;
  let bounds = terrain?.bounds ?? (w3e === undefined ? undefined : terrainBounds.get(w3e));
  if (bounds === undefined && w3e !== undefined) terrainBounds.set(w3e, bounds = worldBounds(decodeTerrain(w3e)));
  return bounds === undefined ? undefined : shiftedBounds(bounds, terrain?.origin);
}

/** Both the still renderer and the player draw unit objects with the same model poses, in the project's world bounds. */
export function sceneWithUnits(project: HeadlessRenderProject, scene: RenderScene): RenderScene {
  const world = projectWorld(project);
  const units: DrawnPose[] = scene.units.filter((unit) => unit.visible && unit.alpha > 0).map((unit) => {
    const model = project.unitModels?.[unit.typeId];
    if (model === undefined) throw new Error(`no render.unitModels entry for visible unit type ${unit.typeId}`);
    return { handle: unit.handle, model, created: 0, x: unit.x, y: unit.y, z: unit.z, alpha: unit.alpha, scale: 1, timeScale: unit.timeScale,
      animation: unit.animation, subAnimations: unit.subAnimations, animationElapsed: unit.animationElapsed,
      animationClock: unit.animationClock, animationBlendTime: unit.animationBlendTime, animationBlend: unit.animationBlend,
      unit: true, queuedAnimations: [], yaw: unit.facing * Math.PI / 180, pitch: 0, roll: 0, color: unit.color, teamColor: unit.teamColor, matrixScale: unit.scale, flat: unit.scale.some((value) => value === 0) };
  });
  return { ...scene, effects: [...scene.effects, ...units], ...(world === undefined ? {} : { world }) };
}

export class RenderFailure extends Schema.TaggedError<RenderFailure>()("RenderFailure", {
  cause: Schema.Unknown,
}) {
  override get message(): string { return `headless render: ${String(this.cause)}`; }
}

class DevTools {
  private serial = 0;
  private readonly waiting = new Map<number, { resolve: (value: unknown) => void; reject: (cause: unknown) => void }>();
  constructor(readonly socket: WebSocket) {
    socket.addEventListener("message", (event) => {
      const reply = JSON.parse(String(event.data));
      const pending = this.waiting.get(reply.id);
      if (pending === undefined) return;
      this.waiting.delete(reply.id);
      if (reply.error !== undefined) pending.reject(new Error(JSON.stringify(reply.error)));
      else pending.resolve(reply.result);
    });
    socket.addEventListener("close", () => {
      for (const pending of this.waiting.values()) pending.reject(new Error("Chrome closed during rendering"));
      this.waiting.clear();
    });
  }
  call(method: string, params: object = {}): Promise<unknown> {
    const id = ++this.serial;
    return new Promise((resolve, reject) => {
      this.waiting.set(id, { resolve, reject });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }
  async evaluate(expression: string): Promise<unknown> {
    const reply = await this.call("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true }) as {
      result: { value?: unknown; description?: string }; exceptionDetails?: unknown;
    };
    if (reply.exceptionDetails !== undefined) throw new Error(reply.result.description ?? JSON.stringify(reply.exceptionDetails));
    return reply.result.value;
  }
}

const ChromePages = Schema.fromJsonString(Schema.Array(Schema.Struct({ type: Schema.String, webSocketDebuggerUrl: Schema.optional(Schema.String) })));

const renderFailure = (cause: unknown) => (cause instanceof RenderFailure ? cause : new RenderFailure({ cause }));

/** A headless Chrome with the renderer page loaded; Chrome, its server, socket and profile live until the scope closes. */
const openBrowser = (project: HeadlessRenderProject, bundle: string, fallback: boolean, graphics: Graphics) => Effect.gen(function*() {
  const directory = yield* Effect.acquireRelease(
    Effect.tryPromise({ try: () => mkdtemp(join(tmpdir(), "wisp-render-")), catch: renderFailure }),
    (path) => Effect.promise(() => rm(path, { recursive: true, force: true })),
  );
  const assets = new Map<string, Promise<Uint8Array | undefined>>();
  const resolutions = new Map<string, RenderAssetResolution>();
  const read = (path: string, mode: Graphics) => {
    let pending = assets.get(`${mode}:${path}`);
    if (pending === undefined) assets.set(`${mode}:${path}`, pending = (async () => {
      if (project.resolveAsset !== undefined) {
        const { bytes, ...resolution } = await project.resolveAsset(path, mode);
        if (mode === graphics) resolutions.set(path, resolution);
        return bytes;
      }
      const bytes = await project.readAsset(path, mode);
      const location = { source: "project", layer: "base", path } as const;
      if (mode === graphics) resolutions.set(path, { requested: path, graphics, attempts: [location], selected: bytes === undefined ? undefined : location });
      return bytes;
    })());
    return pending;
  };
  // A stock Definitive asset is extracted and converted on first read; the page asks for dozens at once and one can wait past Bun's 10 s default.
  const server = yield* Effect.acquireRelease(Effect.sync(() => Bun.serve({ hostname: "127.0.0.1", port: 0, idleTimeout: 255, async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === "/") return new Response('<!doctype html><html><body style="margin:0;background:#101522"><script type="module" src="/renderer.js"></script></body></html>', { headers: { "content-type": "text/html" } });
    if (url.pathname === "/renderer.js") return new Response(bundle, { headers: { "content-type": "text/javascript" } });
    if (url.pathname !== "/asset") return new Response("not found", { status: 404 });
    const path = url.searchParams.get("path") ?? "";
    const data = await read(path, graphics);
    if (data !== undefined) return new Response(new Uint8Array(data));
    // A file that only another mode has draws nothing in this one, as Warcraft draws nothing for it.
    for (const other of GRAPHICS) if (other !== graphics && (await read(path, other)) !== undefined) return new Response(`absent in ${graphics}: ${path}`, { status: 410 });
    return new Response(`missing map asset: ${path}`, { status: 404 });
  }})), (open) => Effect.promise(() => open.stop(true)));
  const chromeLog = join(directory, "chrome.log");
  const chrome = yield* spawnLogged(ChildProcess.make(project.chrome ?? process.env.CHROME ?? "google-chrome-stable", ["--headless=new", "--no-first-run", "--no-default-browser-check", "--disable-background-networking", "--disable-sync", "--remote-debugging-port=0", `--user-data-dir=${directory}`, "--use-gl=angle", `--use-angle=${fallback ? "swiftshader" : "gl"}`, ...(fallback ? ["--enable-unsafe-swiftshader"] : []), `http://127.0.0.1:${server.port}/`]), { stdout: join(directory, "chrome.out"), stderr: chromeLog }).pipe(Effect.mapError(renderFailure));
  const port = yield* pollFor(10, "50 millis", Effect.gen(function*() {
    const active = yield* Effect.promise(() => readFile(join(directory, "DevToolsActivePort"), "utf8").catch(() => ""));
    const port = active.split("\n")[0];
    if (port) return port;
    if (!(yield* chrome.handle.isRunning.pipe(Effect.mapError(renderFailure)))) {
      yield* chrome.written;
      return yield* new RenderFailure({ cause: `Chrome exited: ${yield* Effect.promise(() => readFile(chromeLog, "utf8").catch(() => ""))}` });
    }
    return undefined;
  }));
  if (port === undefined) {
    const log = yield* Effect.promise(() => readFile(chromeLog, "utf8").catch(() => ""));
    return yield* new RenderFailure({ cause: `Chrome did not open its DevTools port within 10 seconds: ${log}` });
  }
  const pages = yield* Effect.tryPromise({ try: () => fetch(`http://127.0.0.1:${port}/json/list`).then((response) => response.text()), catch: renderFailure }).pipe(
    Effect.flatMap(Schema.decodeUnknownEffect(ChromePages)),
    Effect.mapError(renderFailure),
  );
  const url = pages.find((candidate) => candidate.type === "page")?.webSocketDebuggerUrl;
  if (url === undefined) return yield* new RenderFailure({ cause: "Chrome has no render page" });
  const socket = yield* Effect.acquireRelease(Effect.callback<WebSocket, RenderFailure>((resume) => {
    const opening = new WebSocket(url);
    opening.addEventListener("open", () => resume(Effect.succeed(opening)), { once: true });
    opening.addEventListener("error", (cause) => resume(Effect.fail(new RenderFailure({ cause }))), { once: true });
  }), (open) => Effect.sync(() => open.close()));
  const devtools = new DevTools(socket);
  const evaluate = (expression: string) => Effect.tryPromise({ try: () => devtools.evaluate(expression), catch: renderFailure });
  const loaded = yield* pollFor(10, "50 millis", evaluate("typeof window.renderScene === 'function'").pipe(Effect.map((ready) => (ready ? true : undefined))));
  if (loaded === undefined) return yield* new RenderFailure({ cause: "The model renderer did not load within 10 seconds" });
  const gpu = yield* evaluate(`window.prepareRenderer(${project.width ?? 1280},${project.height ?? 720},${JSON.stringify(graphics)})`);
  return { devtools, gpu, resolutions };
});

/** Chrome on the GPU, or on SwiftShader once that fails; a failed attempt's resources are released before the next. */
const openAnyBrowser = (project: HeadlessRenderProject, bundle: string, graphics: Graphics) => Effect.gen(function*() {
  const attempt = (fallback: boolean) => Effect.gen(function*() {
    const scope = yield* Scope.fork(yield* Effect.scope);
    return yield* openBrowser(project, bundle, fallback, graphics).pipe(Scope.provide(scope), Effect.onError((cause) => Scope.close(scope, Exit.failCause(cause))));
  });
  return yield* attempt(false).pipe(Effect.catch(() => attempt(true)));
});

/** Draws captured scenes with the map's models, textures, camera and UI. */
export const renderScenes = (project: HeadlessRenderProject, scenes: readonly RenderScene[], directory: string, graphics: Graphics = "classic", look: readonly Lever[] = []) => Effect.scoped(Effect.gen(function*() {
  const unsupported = unsupportedLevers(graphics, look);
  if (unsupported.length > 0) return yield* new RenderFailure({ cause: `the look check asks for ${unsupported.join(", ")}, which Wisp does not draw in ${graphics} (wisp:docs/headless.md, "Graphics profiles")` });
  const bundle = yield* Effect.tryPromise({ try: async () => {
    const result = await Bun.build({ entrypoints: [join(import.meta.dir, "browser/headlessRender.ts")], target: "browser", minify: true });
    if (!result.success || result.outputs[0] === undefined) throw new Error(result.logs.join("\n"));
    return result.outputs[0].text();
  }, catch: (cause) => new RenderFailure({ cause }) });
  const browser = yield* openAnyBrowser(project, bundle, graphics);
  return yield* Effect.tryPromise({ try: async () => {
    await mkdir(directory, { recursive: true });
    const images: { frame: number; client: number; image: string; models: number; textures: number; notDrawn: string[]; pointLights: number; absent: readonly string[] }[] = [];
    for (const scene of scenes) {
      const result = await browser.devtools.evaluate(`window.renderScene(${JSON.stringify(sceneWithUnits(project, scene))})`) as { png: string; models: number; textures: number; notDrawn: string[]; pointLights: number; absent: string[] };
      for (const failure of result.notDrawn) console.error(`p${scene.client} frame ${scene.frame}: not drawn: ${failure}`);
      const image = `p${scene.client}-frame-${scene.frame}.png`;
      await Bun.write(join(directory, image), Buffer.from(result.png.split(",")[1] ?? "", "base64"));
      await Bun.write(join(directory, `p${scene.client}-frame-${scene.frame}.json`), JSON.stringify(scene));
      images.push({ frame: scene.frame, client: scene.client, image, models: result.models, textures: result.textures, notDrawn: result.notDrawn, pointLights: result.pointLights, absent: result.absent });
    }
    await Bun.write(join(directory, "render.json"), JSON.stringify({ renderer: "war3-model 4.0.1 + HD sampling precision", graphics, levers: PROFILES[graphics], look, gpu: browser.gpu, assets: [...browser.resolutions.values()], images }, null, 2) + "\n");
    return images;
  }, catch: (cause) => new RenderFailure({ cause }) });
})).pipe(Effect.provide(BunServices.layer), Effect.timeout("2 minutes"));
