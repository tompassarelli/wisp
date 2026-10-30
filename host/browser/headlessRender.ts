import { ModelRenderer, decodeBLP, getBLPImageData, parseMDL, parseMDX, type model } from "../../vendor/war3-model.mjs";
import { type AnimationSequence, animationSample, blendWeight, globalSequenceFrame, type SequenceSample } from "../../src/headless/animation";
import type { DrawnPose as EffectPose, PopcornEmitterPose, UnsupportedEmitterPose, RenderedFrame, RenderScene } from "../render/headlessRender";
import { parsableModel } from "../models/models";
import { drawnPoses } from "../render/culling";
import { lightAtHour } from "../render/dayNightLight";
import { emitterInventory, undrawnEmitters } from "../render/emitterInventory";
import { advanceEmitters, type EmitterRenderer } from "./emitters";
import { drawTerrain } from "./terrain";
import { drawWater } from "./water";
import { linkProgram } from "./gl";
import { depthTarget, type DepthTarget, postProcessor, resolve, sceneTarget, type SceneTarget, SUN_MAP, sunView } from "./passes";
import { terrainRows } from "../terrain/terrainMesh";
import { doodadSkinRows, terrainDoodadPoses } from "../terrain/terrainDoodads";
import { ddsTexture } from "./ddsTexture";
import { cliffOverrideTextures, cliffTexturePath } from "../terrain/terrainCliffs";
import { type Matrix, multiply, normalize } from "./matrix";
import { camera, identity, poseNodes, type Sampler, show, SKY_FAR, transform, uiPixels, uiTextSize } from "../render/screen";

interface Material { readonly Layers: readonly { readonly FilterMode?: number }[] }

function orderDrawnModels<T>(poses: readonly T[], materials: (pose: T) => readonly Material[]): T[] {
  const transparent = (pose: T) => materials(pose).some((material) => material.Layers.some((layer) => (layer.FilterMode ?? 0) < 2)) ? 0 : 1;
  return [...poses].sort((a, b) => transparent(a) - transparent(b));
}

let cliffOverrides: ReadonlyMap<string, string> = new Map();
const cliffOverridesByTerrain = new Map<string, Promise<ReadonlyMap<string, string>>>();
async function bindCliffTextures(scene: RenderScene): Promise<void> {
  const tiles = scene.terrain?.cliffTiles ?? [];
  if (tiles.length === 0) { cliffOverrides = new Map(); return; }
  const key = tiles.join(",");
  let loading = cliffOverridesByTerrain.get(key);
  if (loading === undefined) cliffOverridesByTerrain.set(key, loading = asset("TerrainArt\\CliffTypes.slk").then((bytes) => cliffOverrideTextures(tiles, terrainRows(new Uint8Array(bytes)))));
  cliffOverrides = await loading;
}

let installedDoodads: Promise<ReadonlyMap<string, Readonly<Record<string, string>>>> | undefined;
async function scenePoses(scene: RenderScene): Promise<readonly EffectPose[]> {
  if (scene.terrainDoodads === undefined || scene.terrain === undefined) return scene.effects;
  installedDoodads ??= (async () => {
    const rows = new Map(terrainRows(new Uint8Array(await asset("Doodads\\Doodads.slk"))));
    try {
      for (const [id, skin] of doodadSkinRows(new Uint8Array(await asset("Doodads\\DoodadSkins.txt")))) rows.set(id, { ...rows.get(id), ...skin });
    } catch (cause) { if (!(cause instanceof MissingAsset)) throw cause; }
    return rows;
  })();
  const special = terrainDoodadPoses(scene.terrainDoodads.placements, scene.terrain, await installedDoodads, scene.frame, scene.terrainDoodads.models);
  return [...scene.effects, ...special];
}


interface WorldLight { readonly toward: readonly number[]; readonly key: readonly number[]; readonly ambient: readonly number[]; readonly linear: boolean }
let environmentLight: Promise<number[]> | undefined;

function environmentAmbient(): Promise<number[]> {
  environmentLight ??= textureAt("ReplaceableTextures\\EnvironmentMap.blp").then(({ data, width, height }) => {
    const sum = [0, 0, 0];
    const linear = (value: number) => { const c = value / 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
    let weights = 0;
    for (let row = 0; row < height; row++) {
      const weight = Math.cos(((row + 0.5) / height - 0.5) * Math.PI);
      for (let column = 0; column < width; column++) for (let channel = 0; channel < 3; channel++) sum[channel]! += weight * linear(data[(row * width + column) * 4 + channel] ?? 0);
      weights += weight * width;
    }
    return sum.map((value) => value / weights);
  });
  return environmentLight;
}
const dayNightModels = new Map<string, Promise<model.Model | undefined>>();

async function dayNightLight(path: string, hours: number): Promise<WorldLight | undefined> {
  if (path === "") return undefined;
  let loading = dayNightModels.get(path);
  if (loading === undefined) {

    loading = asset(path).then((bytes) => new TextDecoder().decode(bytes.slice(0, 4)) === "MDLX" ? parseMDX(bytes) : parseMDL(new TextDecoder().decode(bytes)));
    dayNightModels.set(path, loading);
  }
  const data = await loading;
  if (data === undefined) return undefined;
  const light = lightAtHour(data, hours);
  if (light === undefined) return undefined;
  if (light.ambient === "environment") return { toward: light.toward, key: light.key, ambient: await environmentAmbient(), linear: true };
  return { toward: light.toward, key: light.key, ambient: light.ambient, linear: false };
}

function modelDirection(matrix: Matrix, toward: readonly number[]): number[] {
  const m = (row: number, column: number) => matrix[column * 4 + row] ?? 0;
  const [x = 0, y = 0, z = 1] = toward;
  const a = [[m(0, 0), m(0, 1), m(0, 2)], [m(1, 0), m(1, 1), m(1, 2)], [m(2, 0), m(2, 1), m(2, 2)]] as const;
  const c = (r: number, k: number) => a[r]?.[k] ?? 0;
  const cofactor = (r: number, k: number) => c((r + 1) % 3, (k + 1) % 3) * c((r + 2) % 3, (k + 2) % 3) - c((r + 1) % 3, (k + 2) % 3) * c((r + 2) % 3, (k + 1) % 3);

  const out = [0, 1, 2].map((k) => cofactor(0, k) * x + cofactor(1, k) * y + cofactor(2, k) * z);
  return Math.hypot(...out) > 0 ? normalize(out) : [0, 0, 1];
}

function sceneFog(scene: RenderScene, view: ReturnType<typeof camera>, sky: boolean) {
  const fog = scene.environment?.fog;
  if (fog === undefined || (sky && fog.drawOverSky !== true)) return undefined;
  const height = fog.style === 3;
  const start = height ? fog.linearStart ?? fog.zStart : fog.zStart, end = height ? fog.linearEnd ?? fog.zEnd : fog.zEnd;
  return { color: fog.color, start, end, near: view.near, far: sky ? SKY_FAR : view.far, max: fog.maxLinearDensity ?? 1 };
}

const canvas = document.createElement("canvas");
const output = document.createElement("canvas");
const overlay = document.createElement("canvas");
const display = document.createElement("div");
display.style.cssText = "display:grid;max-width:100%;max-height:100%";
for (const layer of [canvas, overlay, output]) {
  layer.style.gridArea = "1 / 1";
  display.append(layer);
}
canvas.style.display = overlay.style.display = "none";
document.body.append(display);
let gl: WebGL2RenderingContext;
let sceneBuffer: SceneTarget;
let compose: ReturnType<typeof postProcessor>;
let sunMap: DepthTarget | undefined;
const models = new Map<string, Promise<model.Model>>();
const textures = new Map<string, Promise<ImageData>>();
const pictures = new Map<string, HTMLCanvasElement>();
const tinted = new Map<string, HTMLCanvasElement>();

interface ModelInstance { renderer: ModelRenderer; model: model.Model; path: string; sequences: AnimationSequence[]; sequence: number; clock: number; posed: number }
let sceneDraw = 0;
const instances = new Map<number, ModelInstance>();
const preparedModels = new Map<string, ModelInstance>();

class MissingAsset extends Error {}
async function asset(path: string): Promise<ArrayBuffer> {
  const response = await fetch(`/asset?path=${encodeURIComponent(path)}`);
  if (!response.ok) throw new MissingAsset(`missing map asset: ${path}`);
  return response.arrayBuffer();
}
async function modelAt(path: string): Promise<model.Model> {
  let result = models.get(path);
  if (result === undefined) {
    result = asset(path).then((bytes) => new TextDecoder().decode(bytes.slice(0, 4)) === "MDLX" ? parseMDX(parsableModel(new Uint8Array(bytes)).bytes.slice().buffer) : parseMDL(new TextDecoder().decode(bytes)));
    models.set(path, result);
  }
  return result;
}
function tga(bytes: ArrayBuffer): ImageData {
  const data = new Uint8Array(bytes), header = new DataView(bytes), type = data[2] ?? 0;
  if (data[1] !== 0 || ![2, 3, 10, 11].includes(type)) throw new Error("texture is neither PNG/JPEG, BLP1 nor supported TGA; supply decoded PNG bytes");
  const width = header.getUint16(12, true), height = header.getUint16(14, true), stride = (data[16] ?? 0) / 8;
  if (![1, 3, 4].includes(stride)) throw new Error("unsupported TGA pixel size");
  const out = new ImageData(width, height), top = ((data[17] ?? 0) & 32) !== 0;
  let offset = 18 + (data[0] ?? 0), pixel = 0;
  while (pixel < width * height) {
    const packet = type >= 10 ? data[offset++] ?? 0 : 0, repeat = (packet & 128) !== 0, count = (packet & 127) + 1;
    for (let i = 0; i < count; i++) {
      const row = Math.floor(pixel / width), index = ((top ? row : height - 1 - row) * width + pixel % width) * 4;
      out.data[index] = data[offset + (stride === 1 ? 0 : 2)] ?? 0; out.data[index + 1] = data[offset + (stride === 1 ? 0 : 1)] ?? 0; out.data[index + 2] = data[offset] ?? 0; out.data[index + 3] = stride === 4 ? data[offset + 3] ?? 255 : 255;
      pixel++; if (!repeat || i === count - 1) offset += stride;
    }
  }
  return out;
}
/** A texture's pixels with straight alpha: a 2D canvas premultiplies, which blackens the colour under alpha 0 that an opaque layer still draws, as Warcraft does. */
function textureAt(path: string): Promise<ImageData> {
  let result = textures.get(path);
  if (result === undefined) {
    result = asset(path).then(async (bytes) => {
      const magic = new Uint8Array(bytes, 0, Math.min(4, bytes.byteLength));
      if (magic[0] === 137 || magic[0] === 255) return straightPixels(await createImageBitmap(new Blob([bytes]), { premultiplyAlpha: "none", colorSpaceConversion: "none" }));
      const decoded = magic[0] === 66 && magic[1] === 76 ? getBLPImageData(decodeBLP(bytes), 0)
        : magic[0] === 68 && magic[1] === 68 && magic[2] === 83 && magic[3] === 32 ? ddsTexture(bytes) : tga(bytes);
      return new ImageData(new Uint8ClampedArray(decoded.data), decoded.width, decoded.height);
    }); textures.set(path, result);
  }
  return result;
}
/** Reads a decoded image back through an unpremultiplied WebGL upload, the one browser path that keeps its colour where alpha is 0. */
function straightPixels(image: ImageBitmap): ImageData {
  const framebuffer = gl.getParameter(gl.FRAMEBUFFER_BINDING) as WebGLFramebuffer | null, bound = gl.getParameter(gl.TEXTURE_BINDING_2D) as WebGLTexture | null;
  const texture = gl.createTexture(), target = gl.createFramebuffer();
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false); gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
  gl.bindFramebuffer(gl.FRAMEBUFFER, target); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
  const data = new Uint8ClampedArray(image.width * image.height * 4);
  gl.readPixels(0, 0, image.width, image.height, gl.RGBA, gl.UNSIGNED_BYTE, data);
  gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer); gl.bindTexture(gl.TEXTURE_2D, bound);
  gl.deleteFramebuffer(target); gl.deleteTexture(texture);
  const pixels = new ImageData(data, image.width, image.height); image.close();
  return pixels;
}
const teams = [[255, 3, 3], [0, 66, 255], [28, 230, 185], [84, 0, 129], [255, 252, 1], [254, 138, 14], [32, 192, 0], [229, 91, 176], [149, 150, 151], [126, 191, 241], [16, 98, 70], [78, 42, 4]];


const spare = new Map<string, ModelInstance[]>();
const stateless = (instance: ModelInstance) => instance.model.ParticleEmitters2.length === 0 && instance.model.RibbonEmitters.length === 0;
function release(instance: ModelInstance): void {
  if (!stateless(instance)) { instance.renderer.destroy(); return; }
  instance.sequence = -2; instance.clock = 0; instance.posed = -1;
  let free = spare.get(instance.path);
  if (free === undefined) spare.set(instance.path, free = []);
  free.push(instance);
}

function releaseAbsent(effects: readonly { readonly handle: { readonly id: number } }[]): void {
  const present = new Set(effects.map((effect) => effect.handle.id));
  for (const [handle, instance] of instances) {
    if (present.has(handle) || !stateless(instance)) continue;
    instances.delete(handle); release(instance);
  }
}
async function prepareInstance(pose: EffectPose) {
  let instance = instances.get(pose.handle.id);
  if (instance === undefined || instance.path !== pose.model) {
    if (instance !== undefined) { instances.delete(pose.handle.id); release(instance); }
    instance = spare.get(pose.model)?.pop() ?? preparedModels.get(pose.model);
    if (instance === undefined) instance = await createInstance(pose.model);
    else preparedModels.delete(pose.model);
    instances.set(pose.handle.id, instance);
  }
  return instance;
}
const pixels = new Map<string, Promise<ImageData | undefined>>();

function texturePixels(path: string): Promise<ImageData | undefined> {
  let result = pixels.get(path);
  if (result === undefined) {
    result = textureAt(path);
    pixels.set(path, result);
  }
  return result;
}

const loading = new Map<number, { readonly path: string; failure?: unknown }>();
function liveInstance(pose: EffectPose): ModelInstance | undefined {
  const ready = instances.get(pose.handle.id);
  if (ready !== undefined && ready.path === pose.model) return ready;
  const pending = loading.get(pose.handle.id);
  if (pending?.path === pose.model) {
    if (pending.failure !== undefined) throw pending.failure;
    return undefined;
  }
  const entry: { readonly path: string; failure?: unknown } = { path: pose.model };
  loading.set(pose.handle.id, entry);
  prepareInstance(pose).then(() => { if (loading.get(pose.handle.id) === entry) loading.delete(pose.handle.id); }, (cause: unknown) => { entry.failure = cause; });

  const taken = instances.get(pose.handle.id);
  return taken?.path === pose.model ? taken : undefined;
}
async function createInstance(path: string): Promise<ModelInstance> {
  const data = await modelAt(path);

  const images = await Promise.all(data.Textures.map((texture) => texture.Image === "" ? undefined : texturePixels(cliffTexturePath(texture.Image, cliffOverrides))));
  const renderer = new ModelRenderer(data); renderer.initGL(gl);
  data.Textures.forEach((texture, index) => {
    const image = images[index];
    if (image !== undefined) renderer.setTextureImageData(texture.Image, [image]);
  });
  const sequences = data.Sequences.map((sequence) => ({ name: sequence.Name, start: sequence.Interval[0] ?? 0, end: sequence.Interval[1] ?? 0, looping: !sequence.NonLooping, rarity: sequence.Rarity }));
  return { renderer, model: data, path, sequences, sequence: -2, clock: 0, posed: -1 };
}

interface DepthPass { readonly view: Matrix; readonly projection: Matrix }

interface Shadows { readonly sun?: { readonly map: WebGLTexture; readonly viewProjection: Matrix; readonly bias: number; readonly texel: number } }
async function drawEffect(pose: EffectPose, view: ReturnType<typeof camera>, light: WorldLight | undefined, fog: ReturnType<typeof sceneFog>, popcornEmitters: PopcornEmitterPose[], shadows: Shadows = {}, depthPass?: DepthPass, unsupportedEmitters: UnsupportedEmitterPose[] = []) {
  const instance = await prepareInstance(pose);
  const { renderer, model: data } = instance;
  renderer.setInstanceAlpha(pose.alpha / 255);
  renderer.setInstanceColor(new Float32Array(pose.color.map((value) => value / 255)));
  renderer.setCamera(new Float32Array(view.eye), view.quaternion);
  const sampler = renderer as unknown as Sampler;

  if (instance.posed !== sceneDraw) {
    instance.posed = sceneDraw;
    const kind = pose.unit === true ? "unit" : "effect";
    const sample = animationSample(instance.sequences, { animation: pose.animation, subAnimations: pose.subAnimations, elapsed: pose.animationElapsed }, kind);
    const elapsed = pose.animationElapsed * 1000;
    if (instance.sequence !== sample.sequence || elapsed < instance.clock) {
      if (sample.sequence >= 0) renderer.setSequence(sample.sequence);
      instance.sequence = sample.sequence; instance.clock = 0;
    }
    if (sample.sequence >= 0 && (data.ParticleEmitters2.length > 0 || data.RibbonEmitters.length > 0)) {
      instance.clock = advanceEmitters(renderer as unknown as EmitterRenderer, data.Sequences, instance.sequences, { animation: pose.animation, subAnimations: pose.subAnimations, elapsed: pose.animationElapsed }, kind, instance.clock, elapsed);
    }
    show(sampler, data, sample);
    data.GlobalSequences.forEach((length, index) => { sampler.rendererData.globalSequencesFrames[index] = globalSequenceFrame(pose.animationClock, length); });
    const blend = pose.animationBlend, weight = blendWeight(pose);
    const saved = blend === undefined ? undefined : animationSample(instance.sequences, blend.from, kind);
    renderer.update(0);
    if (saved !== undefined && weight > 0) poseNodes(sampler, data, saved, weight);
  }
  renderer.setTeamColor(new Float32Array((teams[pose.teamColor] ?? [160, 160, 160]).map((v) => v / 255)));
  renderer.setLightPosition([1000, -1000, 3000]); renderer.setLightColor([1, 1, 1]);
  const placed = transform(pose);
  if (depthPass !== undefined) {
    renderer.setWispEnvironment(undefined);
    renderer.render(multiply(depthPass.view, placed), depthPass.projection, {});
    return;
  }
  emitterInventory(pose, data, sampler, placed, popcornEmitters, unsupportedEmitters);
  const sun = shadows.sun;
  renderer.setWispEnvironment({
    ...(light === undefined ? {} : { light: { direction: modelDirection(placed, light.toward), key: light.key, ambient: light.ambient, linear: light.linear, overbright: false } }), ...(fog === undefined ? {} : { fog }),
    ...(sun === undefined ? {} : { shadow: { map: sun.map, matrix: multiply(sun.viewProjection, placed), bias: sun.bias, texel: sun.texel } }),
  });

  bindScene();
  renderer.render(multiply(view.view, placed), view.projection, {});
}

const skies = new Map<string, Promise<ModelInstance>>();

async function drawSky(scene: RenderScene, view: ReturnType<typeof camera>) {
  const environment = scene.environment;
  if (environment === undefined || environment.sky === "" || !environment.skyVisible) return;
  let loading = skies.get(environment.sky);
  if (loading === undefined) skies.set(environment.sky, loading = createInstance(environment.sky));
  const { renderer, model: data } = await loading;
  const placed = identity();
  placed[12] = view.eye[0] ?? 0; placed[13] = view.eye[1] ?? 0; placed[14] = view.eye[2] ?? 0;
  renderer.setCamera(new Float32Array(view.eye), view.quaternion);
  if (data.Sequences.length > 0) { renderer.setSequence(0); show(renderer as unknown as Sampler, data, { sequence: 0, frame: data.Sequences[0]?.Interval[0] ?? 0 }); }
  renderer.update(0);
  const fog = sceneFog(scene, view, true);
  renderer.setWispEnvironment(fog === undefined ? {} : { fog });
  bindScene();
  renderer.render(multiply(view.view, placed), view.skyProjection, {});

  gl.depthMask(true); gl.clear(gl.DEPTH_BUFFER_BIT);
}
type FilterPose = NonNullable<RenderScene["filter"]>;
let filterQuad: { program: WebGLProgram; vao: WebGLVertexArrayObject; color: WebGLUniformLocation | null; uv: WebGLUniformLocation | null; textured: WebGLUniformLocation | null } | undefined;
const filterTextures = new Map<string, Promise<WebGLTexture>>();
function filterProgram() {
  if (filterQuad !== undefined) return filterQuad;
  const program = linkProgram(gl, "filter", `#version 300 es
in vec2 position; uniform vec4 uvRect; out vec2 uv;
void main() { uv = mix(uvRect.xy, uvRect.zw, vec2(position.x * 0.5 + 0.5, 0.5 - position.y * 0.5)); gl_Position = vec4(position, 0.0, 1.0); }`, `#version 300 es
precision mediump float; in vec2 uv; uniform sampler2D map; uniform vec4 color; uniform bool textured; out vec4 fragment;
void main() { fragment = (textured ? texture(map, uv) : vec4(1.0)) * color; }`, ["position"]);
  const vao = gl.createVertexArray(), buffer = gl.createBuffer();
  gl.bindVertexArray(vao); gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  gl.bindVertexArray(null);
  filterQuad = { program, vao, color: gl.getUniformLocation(program, "color"), uv: gl.getUniformLocation(program, "uvRect"), textured: gl.getUniformLocation(program, "textured") };
  return filterQuad;
}
function filterTexture(path: string, wrap: boolean): Promise<WebGLTexture> {
  const key = `${path}:${wrap}`;
  let result = filterTextures.get(key);
  if (result === undefined) {
    result = textureAt(path).then((image) => {
      const texture = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      for (const axis of [gl.TEXTURE_WRAP_S, gl.TEXTURE_WRAP_T]) gl.texParameteri(gl.TEXTURE_2D, axis, wrap ? gl.REPEAT : gl.CLAMP_TO_EDGE);
      return texture;
    });
    filterTextures.set(key, result = tracked(result));
  }
  return result;
}

async function drawFilter(filter: FilterPose, live: boolean): Promise<void> {
  const quad = filterProgram();
  const load = filter.texture === "" ? undefined : filterTexture(filter.texture, /WRAP/.test(String(filter.texMapFlags)));

  const texture = load === undefined ? undefined : live ? loaded(load) : await load;
  if (load !== undefined && texture === undefined) return;
  gl.disable(gl.DEPTH_TEST); gl.depthMask(false); gl.disable(gl.CULL_FACE);
  gl.useProgram(quad.program); gl.bindVertexArray(quad.vao);
  gl.uniform4f(quad.color, ...filter.color.map((value) => Math.max(0, Math.min(255, value)) / 255) as [number, number, number, number]);
  gl.uniform4f(quad.uv, ...filter.uv);
  gl.uniform1i(quad.textured, texture === undefined ? 0 : 1);
  gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, texture ?? null);
  gl.enable(gl.BLEND); gl.blendEquation(gl.FUNC_ADD);
  switch (filter.blendMode) {
    case "BLEND_MODE_BLEND": case "BLEND_MODE_KEYALPHA": gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA); break;
    case "BLEND_MODE_ADDITIVE": gl.blendFunc(gl.SRC_ALPHA, gl.ONE); break;
    case "BLEND_MODE_MODULATE": gl.blendFunc(gl.DST_COLOR, gl.ZERO); break;

    case "BLEND_MODE_MODULATE_2X": gl.blendFunc(gl.DST_COLOR, gl.SRC_COLOR); break;
    default: gl.disable(gl.BLEND);
  }
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  gl.bindVertexArray(null); gl.disable(gl.BLEND); gl.enable(gl.DEPTH_TEST); gl.depthMask(true);
}
const fonts = new Map<string, Promise<string>>();

function fontFamily(file: string): Promise<string> {
  if (!/\.(ttf|otf)$/i.test(file)) return Promise.resolve("sans-serif");
  let family = fonts.get(file);
  if (family === undefined) {
    const name = `wisp-font-${fonts.size}`;
    family = tracked(asset(file).then(async (bytes) => { const face = new FontFace(name, bytes); await face.load(); document.fonts.add(face); return `"${name}", sans-serif`; }).catch(() => "sans-serif"));
    fonts.set(file, family);
  }
  return family;
}

function wrapped(context: CanvasRenderingContext2D, line: string, limit: number): string[] {
  if (limit <= 0 || context.measureText(line).width <= limit) return [line];
  const rows: string[] = [];
  let row = "";
  for (const word of line.split(" ")) {
    const next = row === "" ? word : `${row} ${word}`;
    if (row !== "" && context.measureText(next).width > limit) { rows.push(row); row = word; } else row = next;
  }
  rows.push(row);
  return rows;
}
function drawText(context: CanvasRenderingContext2D, raw: string, family: string, size: number, color: string, outline: boolean, x: number, horizontal: "left" | "center" | "right", y: number, vertical: "top" | "middle" | "bottom", limit = 0) {
  context.font = `${size}px ${family}`;
  const lines = raw.replace(/\|c[0-9a-f]{8}|\|r/gi, "").replaceAll("|n", "\n").split("\n").flatMap((line) => wrapped(context, line, limit)), leading = size * 1.2;
  const top = vertical === "top" ? y : vertical === "middle" ? y - lines.length * leading / 2 : y - lines.length * leading;
  context.font = `${size}px ${family}`; context.textAlign = horizontal; context.textBaseline = "top";

  const coded = /\|c([0-9a-f]{2})([0-9a-f]{6})/i.exec(raw);
  context.lineWidth = Math.max(1, size / 12); context.strokeStyle = "rgba(0,0,0,0.9)"; context.lineJoin = "round";
  context.fillStyle = coded === null ? color : `#${coded[2]}${coded[1]}`;
  lines.forEach((line, index) => {
    if (outline) context.strokeText(line, x, top + index * leading);
    context.fillText(line, x, top + index * leading);
  });
  context.textAlign = "left";
}
function cssColor(color: number, alpha = 255): string { return `rgba(${(color >>> 16) & 255},${(color >>> 8) & 255},${color & 255},${((color >>> 24) / 255) * alpha / 255})`; }
const settled = new WeakMap<Promise<unknown>, { value?: unknown; failure?: unknown }>();

function tracked<T>(load: Promise<T>): Promise<T> {
  if (settled.has(load)) return load;
  const entry: { value?: unknown; failure?: unknown } = {};
  settled.set(load, entry);
  load.then((value) => { entry.value = value; }, (cause: unknown) => { entry.failure = cause ?? new Error("load failed"); });
  return load;
}

function loaded<T>(load: Promise<T>): T | undefined {
  const state = settled.get(tracked(load));
  if (state?.failure !== undefined) throw state.failure;
  return state?.value as T | undefined;
}
const uiLoads = new Map<string, Promise<HTMLCanvasElement>>();
function uiTextureLoad(path: string, color: number): Promise<HTMLCanvasElement> {
  const key = `${path}:${color}`;
  let load = uiLoads.get(key);
  if (load === undefined) uiLoads.set(key, load = tracked(uiTexture(path, color)));
  return load;
}
async function uiTexture(path: string, color: number): Promise<HTMLCanvasElement> {
  let original = pictures.get(path);
  if (original === undefined) {
    const pixels = await textureAt(path);
    original = document.createElement("canvas"); original.width = pixels.width; original.height = pixels.height;
    const context = original.getContext("2d"); if (context === null) throw new Error("no 2D texture context");
    context.putImageData(pixels, 0, 0); pictures.set(path, original);
  }
  if ((color & 0xffffff) === 0xffffff) return original;
  const key = `${path}:${color}`;
  let result = tinted.get(key);
  if (result === undefined) {
    result = document.createElement("canvas"); result.width = original.width; result.height = original.height;
    const context = result.getContext("2d"); if (context === null) throw new Error("no tint canvas");
    context.drawImage(original, 0, 0); context.globalCompositeOperation = "multiply"; context.fillStyle = cssColor(color | 0xff000000); context.fillRect(0, 0, result.width, result.height);
    context.globalCompositeOperation = "destination-in"; context.drawImage(original, 0, 0); tinted.set(key, result);
  }
  return result;
}

function bindScene(): void { gl.bindFramebuffer(gl.FRAMEBUFFER, sceneBuffer.framebuffer); gl.viewport(0, 0, canvas.width, canvas.height); }

interface DepthView extends DepthPass { readonly viewport: readonly [number, number, number, number] }

async function depthPass(target: DepthTarget, poses: readonly EffectPose[], view: ReturnType<typeof camera>, views: readonly DepthView[]): Promise<void> {
  gl.bindFramebuffer(gl.FRAMEBUFFER, target.framebuffer); gl.viewport(0, 0, target.width, target.height);
  gl.depthMask(true); gl.clear(gl.DEPTH_BUFFER_BIT); gl.enable(gl.DEPTH_TEST);
  for (const unit of [7, 8]) { gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, null); }
  gl.activeTexture(gl.TEXTURE0);
  for (const depth of views) for (const pose of poses) {

    gl.bindFramebuffer(gl.FRAMEBUFFER, target.framebuffer); gl.viewport(...depth.viewport);
    try { await drawEffect(pose, view, undefined, undefined, [], {}, depth); } catch {                              }
  }
}


declare global {
  interface Window {
    prepareRenderer: (width: number, height: number) => string;
    prepareScene: (scene: RenderScene, models?: readonly string[], progress?: (completed: number, total: number) => void) => Promise<{ models: number; instances: number; textures: number }>;
    renderScene: (scene: RenderScene, options?: { capture?: boolean }) => Promise<RenderedFrame>;
  }
}
window.prepareRenderer = (width, height) => {
  canvas.width = output.width = overlay.width = width; canvas.height = output.height = overlay.height = height;

  const context = canvas.getContext("webgl2", { antialias: false, alpha: false });
  if (context === null) throw new Error("Chrome could not create a WebGL2 context");
  gl = context;
  gl.depthFunc(gl.LEQUAL);
  sceneBuffer = sceneTarget(gl, width, height);
  compose = postProcessor(gl, sceneBuffer);
  const debug = gl.getExtension("WEBGL_debug_renderer_info");
  return debug === null ? String(gl.getParameter(gl.RENDERER)) : String(gl.getParameter(debug.UNMASKED_RENDERER_WEBGL));
};
window.prepareScene = async (scene, extraModels = [], progress) => {
  await bindCliffTextures(scene);
  const view = camera(scene, canvas.width / canvas.height);
  const poses = drawnPoses(await scenePoses(scene), view.eye, view.far, scene.world);
  const frames = scene.ui.filter(frame => frame.visible && frame.alpha > 0 && frame.texture !== "");
  const total = poses.length + extraModels.length + frames.length;
  let completed = 0;
  const advanced = () => progress?.(++completed, total);
  for (const pose of poses) { await prepareInstance(pose); advanced(); }
  for (const path of extraModels) { preparedModels.set(path, await createInstance(path)); advanced(); }
  for (const frame of frames) { await uiTextureLoad(frame.texture, frame.color); advanced(); }
  for (const file of new Set(scene.ui.filter((frame) => frame.visible && frame.text !== "").map((frame) => frame.font.file))) await fontFamily(file);
  return { models: models.size, instances: instances.size + preparedModels.size, textures: textures.size };
};
window.renderScene = async (scene, options) => {
  bindScene(); gl.depthMask(true); gl.clearColor(0.04, 0.06, 0.09, 1); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT); gl.enable(gl.DEPTH_TEST);
  const view = camera(scene, canvas.width / canvas.height);
  const visible: EffectPose[] = [], notDrawn: string[] = [], popcornEmitters: PopcornEmitterPose[] = [], unsupportedEmitters: UnsupportedEmitterPose[] = [];
  let poses: readonly EffectPose[] = scene.effects;
  try { await bindCliffTextures(scene); poses = await scenePoses(scene); } catch (cause) { notDrawn.push(`terrain doodads: ${String(cause)}`); }
  releaseAbsent(poses);
  sceneDraw++;
  for (const pose of drawnPoses(poses, view.eye, view.far, scene.world)) {

    try {
      if (options?.capture !== false) await prepareInstance(pose);
      else if (liveInstance(pose) === undefined) continue;
      visible.push(pose);
    } catch (cause) {
      notDrawn.push(`${pose.model}: ${String(cause)}`);
    }
  }
  await drawSky(scene, view);
  if (scene.environment.terrainVisible && scene.terrain !== undefined) {
    try { bindScene(); await drawTerrain(gl, scene.terrain, view.view, view.projection, textureAt, asset); }
    catch (cause) { notDrawn.push(`terrain: ${String(cause)}`); }
  }
  const light = scene.environment === undefined ? undefined : await dayNightLight(scene.environment.dayNight.unit, scene.environment.timeOfDay);
  const fog = sceneFog(scene, view, false);

  const ordered = orderDrawnModels(visible, (pose) => instances.get(pose.handle.id)?.model.Materials ?? []);
  const shadows: { sun?: NonNullable<Shadows["sun"]> } = {};

  if (light !== undefined && light.key.some((value) => value > 0)) {
    const sun = sunView(view.shadow, light.toward);
    sunMap ??= depthTarget(gl, SUN_MAP, SUN_MAP);
    await depthPass(sunMap, ordered, view, [{ view: sun.view, projection: sun.projection, viewport: [0, 0, SUN_MAP, SUN_MAP] }]);
    shadows.sun = { map: sunMap.texture, viewProjection: sun.viewProjection, bias: sun.bias, texel: sun.texel };
  }

  for (const pose of ordered) {
    try { await drawEffect(pose, view, light, fog, popcornEmitters, shadows, undefined, unsupportedEmitters); } catch (cause) { notDrawn.push(`${pose.model}: ${String(cause)}`); }
  }

  let water = false;
  if (scene.environment.terrainVisible && scene.terrain !== undefined) {
    try { bindScene(); water = await drawWater(gl, scene.terrain, scene.frame, view.view, view.projection, fog, textureAt, asset); }
    catch (cause) { notDrawn.push(`water: ${String(cause)}`); }
  }
  notDrawn.push(...undrawnEmitters(unsupportedEmitters));
  resolve(gl, sceneBuffer);
  compose();
  gl.viewport(0, 0, canvas.width, canvas.height);
  if (scene.filter !== undefined) await drawFilter(scene.filter, options?.capture === false);
  const live = options?.capture === false;
  const shown = live ? "block" : "none";
  if (canvas.style.display !== shown) { canvas.style.display = overlay.style.display = shown; output.style.display = live ? "none" : "block"; }
  // Determinism: captures raster on the CPU; Chrome's GPU 2D canvas reorders abutting UI draws depending on earlier frames.
  const context = live ? overlay.getContext("2d") : output.getContext("2d", { willReadFrequently: true }); if (context === null) throw new Error("no output canvas");
  if (live) context.clearRect(0, 0, overlay.width, overlay.height);
  else context.drawImage(canvas, 0, 0);
  const clip = multiply(view.projection, view.view);
  const onScreen = (x: number, y: number, z: number): [number, number] | undefined => {
    const at = [0, 1, 3].map((row) => (clip[row] ?? 0) * x + (clip[4 + row] ?? 0) * y + (clip[8 + row] ?? 0) * z + (clip[12 + row] ?? 0));
    const w = at[2] ?? 0;
    return w <= 0 ? undefined : [((at[0] ?? 0) / w + 1) / 2 * output.width, (1 - (at[1] ?? 0) / w) / 2 * output.height];
  };
  for (const bolt of scene.lightnings ?? []) {
    const from = onScreen(...bolt.from), to = onScreen(...bolt.to);
    if (from === undefined || to === undefined || bolt.color[3] <= 0) continue;
    const [red, green, blue, alpha] = bolt.color.map((channel) => Math.max(0, Math.min(1, channel)));
    context.strokeStyle = `rgba(${Math.round((red ?? 1) * 255)},${Math.round((green ?? 1) * 255)},${Math.round((blue ?? 1) * 255)},${alpha})`;
    context.lineWidth = 3;
    context.beginPath(); context.moveTo(...from); context.lineTo(...to); context.stroke();
  }
  for (const tag of scene.textTags ?? []) {
    const at = [0, 1, 2, 3].map((row) => (clip[row] ?? 0) * tag.x + (clip[4 + row] ?? 0) * tag.y + (clip[8 + row] ?? 0) * tag.z + (clip[12 + row] ?? 0));
    const w = at[3] ?? 0;
    if (w <= 0 || tag.color[3] <= 0) continue;
    const [red, green, blue, alpha] = tag.color;
    drawText(context, tag.text, "sans-serif", tag.height * output.height / 0.6, `rgba(${red},${green},${blue},${alpha / 255})`, true,
      ((at[0] ?? 0) / w + 1) / 2 * output.width, "left", (1 - (at[1] ?? 0) / w) / 2 * output.height, "bottom");
  }
  for (const frame of [...scene.ui].sort((a, b) => a.level - b.level)) {
    if (!frame.visible || frame.alpha <= 0 || frame.rectangle === undefined) continue;
    const { x, y, width, height } = uiPixels(frame.rectangle, output.width, output.height);
    context.globalAlpha = frame.alpha / 255;
    if (frame.texture !== "" && width > 0 && height > 0) {

      const image = live ? loaded(uiTextureLoad(frame.texture, frame.color)) : await uiTextureLoad(frame.texture, frame.color);
      context.globalAlpha *= (frame.color >>> 24) / 255; if (image !== undefined) context.drawImage(image, x, y, width, height); context.globalAlpha = frame.alpha / 255;
    }
    if (frame.text !== "") {

      const size = uiTextSize(frame, output.height, height);
      const alignment = frame.alignment ?? { vertical: "top", horizontal: "left" };
      drawText(context, frame.text, live ? loaded(fontFamily(frame.font.file)) ?? "sans-serif" : await fontFamily(frame.font.file), size, cssColor(frame.textColor), (frame.font.flags & 1) !== 0,
        alignment.horizontal === "left" ? x : alignment.horizontal === "center" ? x + width / 2 : x + width, alignment.horizontal,
        alignment.vertical === "top" ? y : alignment.vertical === "middle" ? y + height / 2 : y + height, alignment.vertical, width);
    }
  }
  context.globalAlpha = 1;
  return { png: options?.capture === false ? "" : output.toDataURL("image/png"), models: visible.length, textures: textures.size, notDrawn: [...new Set(notDrawn)], popcornEmitters, unsupportedEmitters, shadows: { sun: shadows.sun !== undefined }, water };
};
