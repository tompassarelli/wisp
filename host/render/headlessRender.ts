import { mkdtemp, mkdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as BunServices from "@effect/platform-bun/BunServices";
import { Effect, Exit, Schema, Scope } from "effect";
import { ChildProcess } from "effect/process";
import type { EffectDeaths, HeadlessClient } from "../../src/headless/client";
import { pollFor, spawnLogged } from "../process/hostProcess";
import { deathSeconds } from "../models/models";
import { browserBundle } from "./browserBundle";
import type { RenderAssetResolution, ResolvedRenderAsset } from "./renderAssets";
import { decodeTerrain, shiftedBounds, worldBounds, type Terrain, type WorldBounds } from "../terrain/terrain";
import { decodeDoodadFile } from "../terrain/doodads";
import { freshAnimation } from "../../src/headless/animation";
import { uiReport } from "./screen";
import type { ModelBounds, Portrait, TextureIdentity } from "./boundsTypes";
import type { DrawnPose, RenderScene, SceneEnvironment } from "./renderScene";

import { type Graphics, type Lever, PROFILES, unsupportedLevers } from "./graphicsProfiles";
export type { Graphics } from "./graphicsProfiles";
export type { UiRow } from "./screen";
export type { DrawnPose, RenderScene, SceneEnvironment } from "./renderScene";

export const CHROME_ANGLES = ["gl", "gl-egl", "vulkan", "swiftshader"] as const;
export type ChromeAngle = (typeof CHROME_ANGLES)[number];

export interface HeadlessRenderProject {

  readonly readAsset: (path: string, graphics?: Graphics) => Promise<Uint8Array | undefined>;

  readonly resolveAsset?: (path: string, graphics: Graphics) => Promise<ResolvedRenderAsset>;

  readonly unitModels?: Readonly<Record<number, string>>;
  readonly width?: number;
  readonly height?: number;
  readonly chrome?: string;
  /** Chrome's ANGLE backend, with no fallback to another; absent, `gl` then SwiftShader. */
  readonly angle?: ChromeAngle;
  /** Extra environment for Chrome, such as the EGL vendor that picks its GPU. */
  readonly chromeEnv?: Readonly<Record<string, string>>;
  /** Models the game can draw beyond its first scene; the native window reads them in after it starts, so their textures are remastered while the player is in the menus. */
  readonly preloadModels?: readonly string[];
  /** Texture files the game can show beyond its first scene and outside any model, such as interface images; the native window reads them in after it starts with the models, for the same reason. */
  readonly preloadTextures?: readonly string[];

  readonly terrain?: { readonly w3e?: Uint8Array; readonly bounds?: WorldBounds; readonly origin?: readonly [number, number] };

  readonly doodads?: { readonly doo: Uint8Array; readonly models: Readonly<Record<string, string | readonly string[]>>; readonly skinIds?: boolean };

  /** Portrait receipts by UI texture path; `--bounds` gives each drawn frame showing one an `inFrame` verdict. */
  readonly portraits?: Readonly<Record<string, Portrait>>;
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

export interface PopcornEmitterPose {
  readonly model: string;
  readonly handle: number;
  readonly emitter: string;
  readonly effect: string;
  readonly position: readonly [number, number, number];
  readonly scale: readonly [number, number, number];
}

export interface UnsupportedEmitterPose extends PopcornEmitterPose {
  readonly kind: "popcorn" | "model particle";
  readonly objectId: number;
  readonly visible: boolean;
  readonly supported: boolean;
}

export interface RenderedFrame {
  readonly png: string;
  readonly models: number;
  readonly textures: number;
  readonly notDrawn: string[];
  readonly popcornEmitters: PopcornEmitterPose[];
  readonly unsupportedEmitters: UnsupportedEmitterPose[];

  readonly shadows: { readonly sun: boolean };

  readonly water: boolean;
}

export const captureScene = (client: HeadlessClient, options: { readonly visibleOnly?: boolean; readonly matchFrame?: number } = {}): RenderScene => ({
  frame: client.frame, ...(options.matchFrame === undefined ? {} : { matchFrame: options.matchFrame }), playing: client.playing.on, client: client.slot, effects: client.effectPoses({ visibleOnly: options.visibleOnly ?? false }), units: client.unitPoses(), camera: client.cameraPose(), ui: client.frames.snapshot({ visibleOnly: options.visibleOnly ?? false }), filter: client.cineFilterPose(), textTags: client.textTags.poses(), lightnings: client.lightnings.poses(), weathers: client.weathers.poses(),
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

export class RenderFailure extends Schema.TaggedError<RenderFailure, { readonly brand: unique symbol }>()("RenderFailure", {
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
  call(method: string, params: object = {}): Effect.Effect<unknown, RenderFailure> {
    return Effect.callback<unknown, RenderFailure>((resume) => {
      const id = ++this.serial;
      this.waiting.set(id, { resolve: (value) => resume(Effect.succeed(value)), reject: (cause) => resume(Effect.fail(renderFailure(cause))) });
      this.socket.send(JSON.stringify({ id, method, params }));
      return Effect.sync(() => this.waiting.delete(id));
    });
  }
  evaluate(expression: string): Effect.Effect<unknown, RenderFailure> {
    return this.call("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true }).pipe(Effect.flatMap((value) => {
      const reply = value as { result: { value?: unknown; description?: string }; exceptionDetails?: unknown };
      return reply.exceptionDetails !== undefined
        ? Effect.fail(renderFailure(new Error(reply.result.description ?? JSON.stringify(reply.exceptionDetails))))
        : Effect.succeed(reply.result.value);
    }));
  }
}

const ChromePages = Schema.fromJsonString(Schema.Array(Schema.Struct({ type: Schema.String, webSocketDebuggerUrl: Schema.optional(Schema.String) })));

const renderFailure = (cause: unknown) => (cause instanceof RenderFailure ? cause : new RenderFailure({ cause }));

const openBrowser = (project: HeadlessRenderProject, bundle: string, angle: ChromeAngle, graphics: Graphics) => Effect.gen(function*() {
  const directory = yield* Effect.acquireRelease(
    Effect.tryPromise({ try: () => mkdtemp(join(tmpdir(), "wisp-render-")), catch: renderFailure }),
    (path) => Effect.promise(() => rm(path, { recursive: true, force: true })),
  );
  const assets = new Map<string, Promise<Uint8Array | undefined>>();
  const resolutions = new Map<string, RenderAssetResolution>();
  const identities = new Map<string, TextureIdentity>();
  const identify = (path: string, layer: string | undefined, bytes: Uint8Array | undefined) => {
    if (layer !== undefined && bytes !== undefined) identities.set(path, { layer, sha256: new Bun.CryptoHasher("sha256").update(bytes).digest("hex") });
  };
  const read = (path: string) => {
    let pending = assets.get(path);
    if (pending === undefined) assets.set(path, pending = (async () => {
      if (project.resolveAsset !== undefined) {
        const { bytes, ...resolution } = await project.resolveAsset(path, graphics);
        resolutions.set(path, resolution);
        identify(path, resolution.selected?.layer, bytes);
        return bytes;
      }
      const bytes = await project.readAsset(path, graphics);
      const location = { source: "project", layer: "base", path } as const;
      resolutions.set(path, { requested: path, graphics, attempts: [location], selected: bytes === undefined ? undefined : location });
      identify(path, location.layer, bytes);
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
    const data = await read(path);
    if (data !== undefined) return new Response(new Uint8Array(data));
    return new Response(`missing map asset: ${path}`, { status: 404 });
  }})), (open) => Effect.promise(() => open.stop(true)));
  const chromeLog = join(directory, "chrome.log");
  const chromeStarted = performance.now();
  console.error(`headless render: Chrome ANGLE ${angle} starting at ${new Date().toISOString()}`);
  const chrome = yield* spawnLogged(ChildProcess.make(project.chrome ?? process.env.CHROME ?? "google-chrome-stable", ["--headless=new", "--no-first-run", "--no-default-browser-check", "--disable-background-networking", "--disable-sync", "--remote-debugging-port=0", `--user-data-dir=${directory}`, "--use-gl=angle", `--use-angle=${angle}`, ...(angle === "swiftshader" ? ["--enable-unsafe-swiftshader"] : []), ...(angle === "gl-egl" ? ["--ozone-platform=headless"] : []), `http://127.0.0.1:${server.port}/`], { env: project.chromeEnv, extendEnv: true }), { stdout: join(directory, "chrome.out"), stderr: chromeLog }).pipe(Effect.mapError(renderFailure));
  console.error(`headless render: Chrome ANGLE ${angle} spawned after ${Math.round(performance.now() - chromeStarted)} ms`);
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
  console.error(`headless render: Chrome ANGLE ${angle} opened DevTools after ${Math.round(performance.now() - chromeStarted)} ms`);
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
  const evaluate = (expression: string) => devtools.evaluate(expression);
  const loaded = yield* pollFor(10, "50 millis", evaluate("typeof window.renderScene === 'function'").pipe(Effect.map((ready) => (ready ? true : undefined))));
  if (loaded === undefined) return yield* new RenderFailure({ cause: "The model renderer did not load within 10 seconds" });
  const gpu = yield* evaluate(`window.prepareRenderer(${project.width ?? 1280},${project.height ?? 720})`);
  console.error(`headless render: Chrome ANGLE ${angle} prepared the renderer after ${Math.round(performance.now() - chromeStarted)} ms`);
  return { devtools, gpu, resolutions, identities };
});

const openAnyBrowser = (project: HeadlessRenderProject, bundle: string, graphics: Graphics) => Effect.gen(function*() {
  const attempt = (angle: ChromeAngle) => Effect.gen(function*() {
    const started = performance.now();
    const scope = yield* Scope.fork(yield* Effect.scope);
    return yield* openBrowser(project, bundle, angle, graphics).pipe(
      Scope.provide(scope),
      Effect.tapError((cause) => Effect.sync(() => console.error(`headless render: Chrome ANGLE ${angle} failed after ${Math.round(performance.now() - started)} ms at ${new Date().toISOString()}: ${String(cause)}`))),
      Effect.onError((cause) => Scope.close(scope, Exit.failCause(cause))),
    );
  });
  return project.angle === undefined ? yield* attempt("gl").pipe(Effect.catch(() => attempt("swiftshader"))) : yield* attempt(project.angle);
});


export const renderScenes = (project: HeadlessRenderProject, scenes: readonly RenderScene[], directory: string, graphics: Graphics = "classic", look: readonly Lever[] = [], bounds: readonly (readonly ModelBounds[])[] = []) => Effect.scoped(Effect.gen(function*() {
  const unsupported = unsupportedLevers(graphics, look);
  if (unsupported.length > 0) return yield* new RenderFailure({ cause: `the look check asks for ${unsupported.join(", ")}, which Wisp does not draw in ${graphics} (wisp:docs/headless.md, "Graphics profiles")` });
  const bundle = yield* Effect.tryPromise({ try: () => browserBundle(join(import.meta.dir, "../browser/headlessRender.ts")), catch: (cause) => new RenderFailure({ cause }) });
  const browser = yield* openAnyBrowser(project, bundle, graphics);
  const write = (run: () => Promise<unknown>) => Effect.tryPromise({ try: run, catch: (cause) => new RenderFailure({ cause }) });
  yield* write(() => mkdir(directory, { recursive: true }));
  const images: { frame: number; matchFrame?: number; client: number; image: string; models: number; textures: number; notDrawn: string[]; popcornEmitters: PopcornEmitterPose[]; unsupportedEmitters: UnsupportedEmitterPose[]; shadows: RenderedFrame["shadows"]; water: boolean; milliseconds: number; ui: ReturnType<typeof uiReport>; bounds?: readonly ModelBounds[] }[] = [];
  const width = project.width ?? 1280, height = project.height ?? 720;
  for (const [index, scene] of scenes.entries()) {
    const started = performance.now();
    const posed = bounds[index];
    const result = (yield* browser.devtools.evaluate(`window.renderScene(${JSON.stringify(sceneWithUnits(project, scene))})`)) as RenderedFrame;
    const name = scene.matchFrame === undefined ? `p${scene.client}-frame-${scene.frame}` : `p${scene.client}-match-${scene.matchFrame}`;
    for (const failure of result.notDrawn) console.error(`${name}: not drawn: ${failure}`);
    const image = `${name}.png`;
    yield* write(() => Bun.write(join(directory, image), Buffer.from(result.png.split(",")[1] ?? "", "base64")));
    yield* write(() => Bun.write(join(directory, `${name}.json`), JSON.stringify({ ...scene, popcornEmitters: result.popcornEmitters, unsupportedEmitters: result.unsupportedEmitters })));
    images.push({ frame: scene.frame, ...(scene.matchFrame === undefined ? {} : { matchFrame: scene.matchFrame }), client: scene.client, image, models: result.models, textures: result.textures, notDrawn: result.notDrawn, popcornEmitters: result.popcornEmitters, unsupportedEmitters: result.unsupportedEmitters, shadows: result.shadows, water: result.water, milliseconds: Math.round(performance.now() - started), ui: uiReport(scene, width, height, (path) => browser.identities.get(path)), ...(posed === undefined ? {} : { bounds: posed }) });
  }
  yield* write(() => Bun.write(join(directory, "render.json"), JSON.stringify({ renderer: "war3-model 4.0.1 + HD sampling precision", graphics, levers: PROFILES[graphics], look, gpu: browser.gpu, assets: [...browser.resolutions.values()], images }, null, 2) + "\n"));
  const failures = images.flatMap((image) => image.notDrawn.map((failure) => `p${image.client} ${image.matchFrame === undefined ? "frame" : "match frame"} ${image.matchFrame ?? image.frame}: ${failure}`));
  if (failures.length > 0) return yield* new RenderFailure({ cause: new Error(failures.join("\n")) });
  return images;
})).pipe(Effect.provide(BunServices.layer), Effect.timeout("5 minutes"));
