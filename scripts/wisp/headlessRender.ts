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
import type { AssetLocation, RenderAssetResolution, ResolvedRenderAsset } from "./renderAssets";
import { decodeTerrain, shiftedBounds, worldBounds, type Terrain, type WorldBounds } from "./terrain";
import { decodeDoodadFile, type TerrainDoodad } from "./doodads";
import { freshAnimation } from "../../src/headless/animation";

import { GRAPHICS, type Graphics, type Lever, PROFILES, unsupportedLevers } from "./graphicsProfiles";
export type { Graphics } from "./graphicsProfiles";

export interface HeadlessRenderProject {




  readonly readAsset: (path: string, graphics?: Graphics) => Promise<Uint8Array | undefined>;

  readonly resolveAsset?: (path: string, graphics: Graphics, body?: AssetLocation) => Promise<ResolvedRenderAsset>;

  readonly unitModels?: Readonly<Record<number, string>>;
  readonly width?: number;
  readonly height?: number;
  readonly chrome?: string;
  readonly preloadModels?: readonly string[];





  readonly terrain?: { readonly w3e?: Uint8Array; readonly bounds?: WorldBounds; readonly origin?: readonly [number, number] };

  readonly doodads?: { readonly doo: Uint8Array; readonly models: Readonly<Record<string, string | readonly string[]>>; readonly skinIds?: boolean };
}

export interface RenderScene {
  readonly frame: number;
  readonly matchFrame?: number;
  readonly client: number;
  readonly effects: readonly DrawnPose[];
  readonly units: ReturnType<HeadlessClient["unitPoses"]>;
  readonly camera: ReturnType<HeadlessClient["cameraPose"]>;
  readonly ui: ReturnType<HeadlessClient["frames"]["snapshot"]>;
  readonly environment: SceneEnvironment;

  readonly filter?: ReturnType<HeadlessClient["cineFilterPose"]>;

  readonly textTags?: ReturnType<HeadlessClient["textTags"]["poses"]>;

  readonly world?: WorldBounds;
  readonly terrain?: Terrain;
  readonly terrainDoodads?: { readonly placements: readonly TerrainDoodad[]; readonly models: Readonly<Record<string, string | readonly string[]>> };
}


export interface SceneEnvironment extends Environment {

  readonly fog?: SceneFog;

  readonly shadowCastingPointLights?: number;
}

export interface SceneFog {

  readonly style: number;
  readonly zStart: number;
  readonly zEnd: number;
  readonly density: number;

  readonly color: readonly [number, number, number];

  readonly heightStart?: number | undefined;
  readonly heightEnd?: number | undefined;

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
    heightStart: number(fog.heightStart), heightEnd: number(fog.heightEnd), linearStart: number(fog.linearStart), linearEnd: number(fog.linearEnd), maxLinearDensity: number(fog.maxLinearDensity),
    drawOverSky: typeof fog.drawOverSky === "boolean" ? fog.drawOverSky : undefined,
  };
  return { ...environment, dayNight: { ...environment.dayNight }, ...(drawn === undefined ? {} : { fog: drawn }), shadowCastingPointLights: client.scenery.minShadowCastingPointLightCount };
}


export type DrawnPose = EffectPose & { readonly unit?: true };


export interface PopcornEmitterPose {
  readonly model: string;
  readonly handle: number;
  readonly emitter: string;
  readonly effect: string;
  readonly position: readonly [number, number, number];
  readonly scale: readonly [number, number, number];
}

export interface RenderedFrame {
  readonly png: string;
  readonly models: number;
  readonly textures: number;
  readonly notDrawn: string[];
  readonly pointLights: number;
  readonly absent: string[];
  readonly popcornEmitters: PopcornEmitterPose[];

  readonly shadows: { readonly sun: boolean; readonly pointCasters: number };

  readonly post: { readonly ambientOcclusion: boolean; readonly bloom: boolean };

  readonly water: boolean;
  readonly heightFog: boolean;
}

export const captureScene = (client: HeadlessClient, options: { readonly visibleOnly?: boolean; readonly matchFrame?: number } = {}): RenderScene => ({
  frame: client.frame, ...(options.matchFrame === undefined ? {} : { matchFrame: options.matchFrame }), client: client.slot, effects: client.effectPoses({ visibleOnly: options.visibleOnly ?? false }), units: client.unitPoses(), camera: client.cameraPose(), ui: client.frames.snapshot({ visibleOnly: options.visibleOnly ?? false }), filter: client.cineFilterPose(), textTags: client.textTags.poses(),
  environment: sceneEnvironment(client),
});


export async function loadEffectDeaths(project: HeadlessRenderProject, models: Iterable<string>, graphics: Graphics = "classic"): Promise<EffectDeaths> {
  const deaths = new Map<string, number | undefined>();
  for (const model of models) {
    const bytes = project.resolveAsset === undefined ? await project.readAsset(model, graphics) : (await project.resolveAsset(model, graphics)).bytes;
    deaths.set(model, bytes === undefined ? undefined : deathSeconds(bytes));
  }
  return (model) => deaths.get(model);
}

const terrainBounds = new WeakMap<Uint8Array, WorldBounds>();
const decodedTerrains = new WeakMap<Uint8Array, Terrain>();
const doodadPlacements = new WeakMap<Uint8Array, Map<boolean, ReturnType<typeof decodeDoodadFile>>>();
function projectPlacements(project: HeadlessRenderProject): ReturnType<typeof decodeDoodadFile> | undefined {
  const options = project.doodads;
  if (options === undefined) return undefined;
  const skinIds = options.skinIds ?? true;
  let formats = doodadPlacements.get(options.doo);
  if (formats === undefined) doodadPlacements.set(options.doo, formats = new Map());
  let placements = formats.get(skinIds);
  if (placements === undefined) formats.set(skinIds, placements = decodeDoodadFile(options.doo, skinIds));
  return placements;
}
function projectDoodads(project: HeadlessRenderProject, frame: number): DrawnPose[] {
  const options = project.doodads;
  if (options === undefined) return [];
  const placements = projectPlacements(project)?.placed ?? [];
  const [originX, originY] = project.terrain?.origin ?? [0, 0];
  return placements.flatMap((placed, index) => {
    if (!placed.visible) return [];
    const variants = options.models[placed.skin] ?? options.models[placed.type];
    const model = typeof variants === "string" ? variants : variants?.[placed.variation];
    if (model === undefined) throw new Error(`no render.doodads.models entry for ${placed.skin} variation ${placed.variation}`);
    return [{ ...freshAnimation(), animation: placed.life === 0 ? "death" : "stand", animationElapsed: frame / 60, animationClock: frame / 60,
      handle: { kind: "effect" as const, id: -1 - index }, model, created: 0, x: placed.x - originX, y: placed.y - originY, z: placed.z,
      alpha: 255, scale: 1, timeScale: 1, queuedAnimations: [], yaw: placed.angle, pitch: 0, roll: 0, color: [255, 255, 255] as [number, number, number],
      teamColor: 0, matrixScale: [...placed.scale] as [number, number, number], flat: placed.scale.some((value) => value === 0) }];
  });
}
function projectWorld(project: HeadlessRenderProject): WorldBounds | undefined {
  const terrain = project.terrain, w3e = terrain?.w3e;
  let bounds = terrain?.bounds ?? (w3e === undefined ? undefined : terrainBounds.get(w3e));
  if (bounds === undefined && w3e !== undefined) terrainBounds.set(w3e, bounds = worldBounds(decodeTerrain(w3e)));
  return bounds === undefined ? undefined : shiftedBounds(bounds, terrain?.origin);
}


export function sceneWithUnits(project: HeadlessRenderProject, scene: RenderScene): RenderScene {
  const world = projectWorld(project);
  const bytes = project.terrain?.w3e;
  let terrain = bytes === undefined ? scene.terrain : decodedTerrains.get(bytes);
  if (terrain === undefined && bytes !== undefined) {
    terrain = decodeTerrain(bytes);
    decodedTerrains.set(bytes, terrain);
  }
  if (bytes !== undefined && terrain !== undefined) {
    const [x, y] = project.terrain?.origin ?? [0, 0];
    terrain = { ...terrain, originX: terrain.originX - x, originY: terrain.originY - y };
  }
  const units: DrawnPose[] = scene.units.filter((unit) => unit.visible && unit.alpha > 0).map((unit) => {
    const model = project.unitModels?.[unit.typeId];
    if (model === undefined) throw new Error(`no render.unitModels entry for visible unit type ${unit.typeId}`);
    return { handle: unit.handle, model, created: 0, x: unit.x, y: unit.y, z: unit.z, alpha: unit.alpha, scale: 1, timeScale: unit.timeScale,
      animation: unit.animation, subAnimations: unit.subAnimations, animationElapsed: unit.animationElapsed,
      animationClock: unit.animationClock, animationBlendTime: unit.animationBlendTime, animationBlend: unit.animationBlend,
      unit: true, queuedAnimations: [], yaw: unit.facing * Math.PI / 180, pitch: 0, roll: 0, color: unit.color, teamColor: unit.teamColor, matrixScale: unit.scale, flat: unit.scale.some((value) => value === 0) };
  });
  const special = projectPlacements(project)?.terrain ?? [];
  if (special.length > 0 && terrain === undefined) throw new Error("terrain doodads require render.terrain.w3e");
  return { ...scene, effects: [...scene.effects, ...units, ...projectDoodads(project, scene.frame)], ...(world === undefined ? {} : { world }), ...(terrain === undefined ? {} : { terrain }),
    ...(special.length === 0 ? {} : { terrainDoodads: { placements: special, models: project.doodads?.models ?? {} } }) };
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


const openBrowser = (project: HeadlessRenderProject, bundle: string, fallback: boolean, graphics: Graphics) => Effect.gen(function*() {
  const directory = yield* Effect.acquireRelease(
    Effect.tryPromise({ try: () => mkdtemp(join(tmpdir(), "wisp-render-")), catch: renderFailure }),
    (path) => Effect.promise(() => rm(path, { recursive: true, force: true })),
  );
  const assets = new Map<string, Promise<Uint8Array | undefined>>();
  const resolutions = new Map<string, RenderAssetResolution>();
  const read = (path: string, mode: Graphics, body?: AssetLocation) => {
    const cacheKey = `${mode}:${body?.source ?? ""}:${body?.layer ?? ""}:${path}`;
    let pending = assets.get(cacheKey);
    if (pending === undefined) assets.set(cacheKey, pending = (async () => {
      if (project.resolveAsset !== undefined) {
        const { bytes, ...resolution } = await project.resolveAsset(path, mode, body);
        if (mode === graphics) resolutions.set(`${body?.layer ?? ""}:${path}`, resolution);
        return bytes;
      }
      const bytes = await project.readAsset(path, mode);
      const location = { source: "project", layer: "base", path } as const;
      if (mode === graphics) resolutions.set(path, { requested: path, graphics, attempts: [location], selected: bytes === undefined ? undefined : location });
      return bytes;
    })());
    return pending;
  };

  const server = yield* Effect.acquireRelease(Effect.sync(() => Bun.serve({ hostname: "127.0.0.1", port: 0, idleTimeout: 255, async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === "/") return new Response('<!doctype html><html><body style="margin:0;background:#101522"><script type="module" src="/renderer.js"></script></body></html>', { headers: { "content-type": "text/html" } });
    if (url.pathname === "/renderer.js") return new Response(bundle, { headers: { "content-type": "text/javascript" } });
    if (url.pathname !== "/asset") return new Response("not found", { status: 404 });
    const path = url.searchParams.get("path") ?? "";
    const bodyPath = url.searchParams.get("body");
    if (bodyPath !== null) await read(bodyPath, graphics);
    const body = bodyPath === null ? undefined : resolutions.get(`:${bodyPath}`)?.selected;
    const data = await read(path, graphics, body);
    if (data !== undefined) return new Response(new Uint8Array(data));

    for (const other of GRAPHICS) if (bodyPath === null && other !== graphics && (await read(path, other)) !== undefined) return new Response(`absent in ${graphics}: ${path}`, { status: 410 });
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


const openAnyBrowser = (project: HeadlessRenderProject, bundle: string, graphics: Graphics) => Effect.gen(function*() {
  const attempt = (fallback: boolean) => Effect.gen(function*() {
    const scope = yield* Scope.fork(yield* Effect.scope);
    return yield* openBrowser(project, bundle, fallback, graphics).pipe(Scope.provide(scope), Effect.onError((cause) => Scope.close(scope, Exit.failCause(cause))));
  });
  return yield* attempt(false).pipe(Effect.catch(() => attempt(true)));
});


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
    const images: { frame: number; matchFrame?: number; client: number; image: string; models: number; textures: number; notDrawn: string[]; pointLights: number; absent: readonly string[]; shadows: RenderedFrame["shadows"]; post: RenderedFrame["post"]; water: boolean; heightFog: boolean; milliseconds: number }[] = [];
    for (const scene of scenes) {
      const started = performance.now();
      const result = await browser.devtools.evaluate(`window.renderScene(${JSON.stringify(sceneWithUnits(project, scene))})`) as RenderedFrame;
      const name = scene.matchFrame === undefined ? `p${scene.client}-frame-${scene.frame}` : `p${scene.client}-match-${scene.matchFrame}`;
      for (const failure of result.notDrawn) console.error(`${name}: not drawn: ${failure}`);
      const image = `${name}.png`;
      await Bun.write(join(directory, image), Buffer.from(result.png.split(",")[1] ?? "", "base64"));
      await Bun.write(join(directory, `${name}.json`), JSON.stringify({ ...scene, popcornEmitters: result.popcornEmitters }));
      images.push({ frame: scene.frame, ...(scene.matchFrame === undefined ? {} : { matchFrame: scene.matchFrame }), client: scene.client, image, models: result.models, textures: result.textures, notDrawn: result.notDrawn, pointLights: result.pointLights, absent: result.absent, shadows: result.shadows, post: result.post, water: result.water, heightFog: result.heightFog, milliseconds: Math.round(performance.now() - started) });
    }
    await Bun.write(join(directory, "render.json"), JSON.stringify({ renderer: "war3-model 4.0.1 + HD sampling precision", graphics, levers: PROFILES[graphics], look, gpu: browser.gpu, assets: [...browser.resolutions.values()], images }, null, 2) + "\n");
    const failures = images.flatMap((image) => image.notDrawn.map((failure) => `p${image.client} ${image.matchFrame === undefined ? "frame" : "match frame"} ${image.matchFrame ?? image.frame}: ${failure}`));
    if (failures.length > 0) throw new Error(failures.join("\n"));
    return images;
  }, catch: (cause) => new RenderFailure({ cause }) });
})).pipe(Effect.provide(BunServices.layer), Effect.timeout("5 minutes"));
