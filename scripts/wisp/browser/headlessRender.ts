/// <reference lib="dom" />
import { ModelRenderer, decodeBLP, getBLPImageData, parseMDL, parseMDX, type model } from "../../../vendor/war3-model.mjs";
import { type AnimationSequence, animationSample, blendWeight, globalSequenceFrame, type SequenceSample } from "../../../src/headless/animation";
import type { DrawnPose as EffectPose, RenderScene } from "../headlessRender";
import { parsableModel } from "../models";
import { orderDrawnModels } from "../drawOrder";
import { advanceEmitters, type EmitterRenderer } from "./emitters";

type Matrix = Float32Array;
const identity = (): Matrix => new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
function multiply(a: Matrix, b: Matrix): Matrix {
  const out = new Float32Array(16);
  for (let column = 0; column < 4; column++) for (let row = 0; row < 4; row++) {
    for (let k = 0; k < 4; k++) out[column * 4 + row] = (out[column * 4 + row] ?? 0) + (a[k * 4 + row] ?? 0) * (b[column * 4 + k] ?? 0);
  }
  return out;
}
function transform(pose: EffectPose): Matrix {
  const matrix = identity();
  matrix[12] = pose.x; matrix[13] = pose.y; matrix[14] = pose.z;
  let out = matrix;
  for (const [axis, angle] of [[2, pose.yaw], [1, pose.pitch], [0, pose.roll]] as const) {
    const rotation = identity(), c = Math.cos(angle), s = Math.sin(angle);
    const a = (axis + 1) % 3, b = (axis + 2) % 3;
    rotation[a * 4 + a] = c; rotation[b * 4 + b] = c; rotation[a * 4 + b] = s; rotation[b * 4 + a] = -s;
    out = multiply(out, rotation);
  }
  for (let axis = 0; axis < 3; axis++) for (let row = 0; row < 4; row++) out[axis * 4 + row] = (out[axis * 4 + row] ?? 0) * pose.scale * (pose.matrixScale[axis] ?? 1);
  return out;
}
const normalize = (v: readonly number[]): number[] => { const length = Math.hypot(...v); return v.map((value) => value / length); };
const cross = (a: readonly number[], b: readonly number[]): number[] => [(a[1] ?? 0) * (b[2] ?? 0) - (a[2] ?? 0) * (b[1] ?? 0), (a[2] ?? 0) * (b[0] ?? 0) - (a[0] ?? 0) * (b[2] ?? 0), (a[0] ?? 0) * (b[1] ?? 0) - (a[1] ?? 0) * (b[0] ?? 0)];
function camera(scene: RenderScene, aspect: number) {
  const field = (name: string, fallback: number) => scene.camera.fields[`CAMERA_FIELD_${name}`] ?? fallback;
  const yaw = field("ROTATION", 90) * Math.PI / 180, pitch = field("ANGLE_OF_ATTACK", 350) * Math.PI / 180;
  const distance = field("TARGET_DISTANCE", 1650);
  const target = [scene.camera.x, scene.camera.y, field("ZOFFSET", 0)];
  const forward = [Math.cos(yaw) * Math.cos(pitch), Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch)];
  const eye = target.map((v, i) => v - (forward[i] ?? 0) * distance);
  const z = forward.map((v) => -v), x = normalize(cross([0, 0, 1], z)), y = cross(z, x);
  const view = identity();
  for (let axis = 0; axis < 3; axis++) {
    view[axis * 4] = x[axis] ?? 0; view[axis * 4 + 1] = y[axis] ?? 0; view[axis * 4 + 2] = z[axis] ?? 0;
    view[12] = (view[12] ?? 0) - (x[axis] ?? 0) * (eye[axis] ?? 0);
    view[13] = (view[13] ?? 0) - (y[axis] ?? 0) * (eye[axis] ?? 0);
    view[14] = (view[14] ?? 0) - (z[axis] ?? 0) * (eye[axis] ?? 0);
  }
  const tangent = Math.tan(field("FIELD_OF_VIEW", 70) * Math.PI / 360);
  const near = field("NEARZ", 10), far = field("FARZ", 10000);
  const perspective = (to: number) => {
    const out = new Float32Array(16);
    out[0] = 1 / tangent; out[5] = aspect / tangent;
    out[10] = (to + near) / (near - to); out[11] = -1; out[14] = 2 * to * near / (near - to);
    return out;
  };
  const projection = perspective(far);
  const rotation = yaw - Math.PI, elevation = -pitch;
  const halfYaw = rotation / 2, halfPitch = -elevation / 2;
  const quaternion: [number, number, number, number] = [-Math.sin(halfYaw) * Math.sin(halfPitch), Math.cos(halfYaw) * Math.sin(halfPitch), Math.sin(halfYaw) * Math.cos(halfPitch), Math.cos(halfYaw) * Math.cos(halfPitch)];
  // The sky surrounds the eye beyond the far plane, so it gets its own depth range.
  return { view, projection, skyProjection: perspective(SKY_FAR), eye, quaternion, near, far };
}
const SKY_FAR = 1_000_000;

/** A track's value at `frame`: its static value, or its keys stepped or interpolated linearly (curves are drawn as lines). */
function sample(track: model.AnimVector | ArrayLike<number> | number | undefined, frame: number, fallback: readonly number[]): number[] {
  if (track === undefined) return [...fallback];
  if (typeof track === "number") return [track];
  if (!("Keys" in track)) return Array.from(track);
  const keys = track.Keys;
  const first = keys[0];
  if (first === undefined) return [...fallback];
  if (frame <= first.Frame) return Array.from(first.Vector);
  for (let index = 1; index < keys.length; index++) {
    const before = keys[index - 1], after = keys[index];
    if (before === undefined || after === undefined || frame >= after.Frame) continue;
    if (track.LineType === 0) return Array.from(before.Vector);
    const t = (frame - before.Frame) / (after.Frame - before.Frame);
    return Array.from(before.Vector, (value, i) => value + ((after.Vector[i] ?? value) - value) * t);
  }
  return Array.from(keys[keys.length - 1]?.Vector ?? fallback);
}
function rotate(q: readonly number[], v: readonly number[]): number[] {
  const [x = 0, y = 0, z = 0, w = 1] = normalize(q), [vx = 0, vy = 0, vz = 0] = v;
  const tx = 2 * (y * vz - z * vy), ty = 2 * (z * vx - x * vz), tz = 2 * (x * vy - y * vx);
  return [vx + w * tx + (y * tz - z * ty), vy + w * ty + (z * tx - x * tz), vz + w * tz + (x * ty - y * tx)];
}
/** The world light a draw takes: toward the light, and the key and ambient colours, red first. */
interface WorldLight { readonly toward: readonly number[]; readonly key: readonly number[]; readonly ambient: readonly number[] }
const dayNightModels = new Map<string, Promise<model.Model | undefined>>();
/**
 * A day/night model's directional light at the time of day: its one sequence
 * spans the day from midnight. The model's light points down its local Z
 * axis; MDX stores colours blue first.
 */
async function dayNightLight(path: string, hours: number): Promise<WorldLight | undefined> {
  if (path === "") return undefined;
  let loading = dayNightModels.get(path);
  if (loading === undefined) {
    // Lights are read whole: the drawing parser drops them.
    loading = asset(path).then((bytes) => new TextDecoder().decode(bytes.slice(0, 4)) === "MDLX" ? parseMDX(bytes) : parseMDL(new TextDecoder().decode(bytes)));
    dayNightModels.set(path, loading);
  }
  const data = await loading;
  const light = data?.Lights.find((candidate) => candidate.LightType === 1) ?? data?.Lights[0];
  if (data === undefined || light === undefined) return undefined;
  const [start = 0, end = 0] = Array.from(data.Sequences[0]?.Interval ?? [0, 0]);
  const frame = start + (end - start) * (((hours % 24) + 24) % 24) / 24;
  if ((sample(light.Visibility, frame, [1])[0] ?? 1) <= 0) return undefined;
  const colour = (track: typeof light.Color, intensity: typeof light.Intensity) => {
    const [blue = 1, green = 1, red = 1] = sample(track, frame, [1, 1, 1]), scale = sample(intensity, frame, [1])[0] ?? 1;
    return [red * scale, green * scale, blue * scale];
  };
  const toward = light.LightType === 1 ? normalize(rotate(sample(light.Rotation, frame, [0, 0, 0, 1]), [0, 0, 1])) : [0, 0, 1];
  return { toward, key: light.LightType === 2 ? [0, 0, 0] : colour(light.Color, light.Intensity), ambient: colour(light.AmbColor, light.AmbIntensity) };
}
/** The direction toward the light in a draw's model space, where its normals are: the inverse of its world transform applied to the world direction. */
function modelDirection(matrix: Matrix, toward: readonly number[]): number[] {
  const m = (row: number, column: number) => matrix[column * 4 + row] ?? 0;
  const [x = 0, y = 0, z = 1] = toward;
  const a = [[m(0, 0), m(0, 1), m(0, 2)], [m(1, 0), m(1, 1), m(1, 2)], [m(2, 0), m(2, 1), m(2, 2)]] as const;
  const c = (r: number, k: number) => a[r]?.[k] ?? 0;
  const cofactor = (r: number, k: number) => c((r + 1) % 3, (k + 1) % 3) * c((r + 2) % 3, (k + 2) % 3) - c((r + 1) % 3, (k + 2) % 3) * c((r + 2) % 3, (k + 1) % 3);
  // The adjugate is the inverse up to scale, which normalizing removes.
  const out = [0, 1, 2].map((k) => cofactor(0, k) * x + cofactor(1, k) * y + cofactor(2, k) * z);
  return Math.hypot(...out) > 0 ? normalize(out) : [0, 0, 1];
}
/** Terrain fog as eye-depth linear fog: a height fog (style 3) draws its linear range, up to its maximum density. */
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
const models = new Map<string, Promise<model.Model>>();
const textures = new Map<string, Promise<HTMLCanvasElement>>();
const tinted = new Map<string, HTMLCanvasElement>();
interface ModelInstance { renderer: ModelRenderer; model: model.Model; path: string; sequences: AnimationSequence[]; sequence: number; clock: number }
const instances = new Map<number, ModelInstance>();
const preparedModels = new Map<string, ModelInstance>();
async function asset(path: string): Promise<ArrayBuffer> {
  const response = await fetch(`/asset?path=${encodeURIComponent(path)}`);
  if (!response.ok) throw new Error(`missing map asset: ${path}`);
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
function textureAt(path: string): Promise<HTMLCanvasElement> {
  let result = textures.get(path);
  if (result === undefined) {
    result = asset(path).then(async (bytes) => {
      const texture = document.createElement("canvas"), context = texture.getContext("2d");
      if (context === null) throw new Error("no 2D texture context");
      const magic = new Uint8Array(bytes, 0, Math.min(4, bytes.byteLength));
      if (magic[0] === 137 || magic[0] === 255) {
        const image = await createImageBitmap(new Blob([bytes])); texture.width = image.width; texture.height = image.height; context.drawImage(image, 0, 0); image.close();
      } else {
        const decoded = magic[0] === 66 && magic[1] === 76 ? getBLPImageData(decodeBLP(bytes), 0) : tga(bytes);
        texture.width = decoded.width; texture.height = decoded.height;
        context.putImageData(new ImageData(new Uint8ClampedArray(decoded.data), decoded.width, decoded.height), 0, 0);
      }
      return texture;
    }); textures.set(path, result);
  }
  return result;
}
const teams = [[255, 3, 3], [0, 66, 255], [28, 230, 185], [84, 0, 129], [255, 252, 1], [254, 138, 14], [32, 192, 0], [229, 91, 176], [149, 150, 151], [126, 191, 241], [16, 98, 70], [78, 42, 4]];
/** The parts of war3-model's renderer that sampling and blending reach into. */
interface Sampler {
  rendererData: { frame: number; animation: number; animationInfo: { Interval: ArrayLike<number> }; globalSequencesFrames: number[]; rootNode: unknown };
  interp: { vec3(out: Float32Array, vector: unknown): Float32Array | null; quat(out: Float32Array, vector: unknown): Float32Array | null };
  updateNode(node: { node: { Translation?: unknown; Rotation?: unknown; Scaling?: unknown } }): void;
}
// No interval holds any key, so every non-global track takes its default value.
const NO_SEQUENCE = { Interval: [0xffffffff, 0xffffffff] };
function show(sampler: Sampler, data: model.Model, sample: SequenceSample): void {
  sampler.rendererData.animation = sample.sequence;
  sampler.rendererData.animationInfo = data.Sequences[sample.sequence] ?? NO_SEQUENCE;
  sampler.rendererData.frame = sample.frame;
}
function slerp(a: Float32Array, b: Float32Array, t: number): Float32Array {
  let dot = (a[0] ?? 0) * (b[0] ?? 0) + (a[1] ?? 0) * (b[1] ?? 0) + (a[2] ?? 0) * (b[2] ?? 0) + (a[3] ?? 1) * (b[3] ?? 1), sign = 1;
  if (dot < 0) { dot = -dot; sign = -1; }
  let left = 1 - t, right = t;
  if (1 - dot > 0.000001) { const angle = Math.acos(dot), sine = Math.sin(angle); left = Math.sin((1 - t) * angle) / sine; right = Math.sin(t * angle) / sine; }
  return new Float32Array([0, 1, 2, 3].map((i) => left * (a[i] ?? 0) + right * sign * (b[i] ?? 0)));
}
/** Poses every node, mixing each local transform toward the saved pose by `weight`, as a blend between sequences does. */
function poseNodes(sampler: Sampler, data: model.Model, saved: SequenceSample | undefined, weight: number): void {
  if (saved === undefined || weight <= 0) { sampler.updateNode(sampler.rendererData.rootNode as Parameters<Sampler["updateNode"]>[0]); return; }
  const { interp } = sampler, vec3 = interp.vec3.bind(interp), quat = interp.quat.bind(interp), updateNode = sampler.updateNode.bind(sampler);
  const current = { animation: sampler.rendererData.animation, animationInfo: sampler.rendererData.animationInfo, frame: sampler.rendererData.frame };
  let node: Parameters<Sampler["updateNode"]>[0]["node"] | undefined;
  const savedValue = <T>(read: () => T): T => {
    show(sampler, data, saved);
    try { return read(); } finally { Object.assign(sampler.rendererData, current); }
  };
  interp.vec3 = (out, vector) => {
    const now = vec3(new Float32Array(3), vector);
    if (node === undefined || (vector !== node.Translation && vector !== node.Scaling)) return now === null ? null : new Float32Array(now);
    const before = savedValue(() => vec3(new Float32Array(3), vector));
    if (now === null && before === null) return null;
    const fallback = vector === node.Scaling ? 1 : 0;
    for (let i = 0; i < 3; i++) out[i] = (1 - weight) * (now?.[i] ?? fallback) + weight * (before?.[i] ?? fallback);
    return out;
  };
  interp.quat = (out, vector) => {
    const now = quat(new Float32Array(4), vector);
    if (node === undefined || vector !== node.Rotation) return now === null ? null : new Float32Array(now);
    const before = savedValue(() => quat(new Float32Array(4), vector));
    if (now === null && before === null) return null;
    const identity = new Float32Array([0, 0, 0, 1]);
    out.set(slerp(now === null ? identity : new Float32Array(now), before === null ? identity : new Float32Array(before), weight));
    return out;
  };
  sampler.updateNode = (next) => { node = next.node; updateNode(next); };
  try { updateNode(sampler.rendererData.rootNode as Parameters<Sampler["updateNode"]>[0]); }
  finally { interp.vec3 = vec3; interp.quat = quat; sampler.updateNode = updateNode; node = undefined; }
}
async function prepareInstance(pose: EffectPose) {
  let instance = instances.get(pose.handle.id);
  if (instance === undefined || instance.path !== pose.model) {
    instance?.renderer.destroy();
    instance = preparedModels.get(pose.model);
    if (instance === undefined) instance = await createInstance(pose.model);
    else preparedModels.delete(pose.model);
    instances.set(pose.handle.id, instance);
  }
  return instance;
}
async function createInstance(path: string): Promise<ModelInstance> {
  const data = await modelAt(path);
  const renderer = new ModelRenderer(data); renderer.initGL(gl);
  for (const texture of data.Textures) if (texture.Image !== "") {
    const bitmap = await textureAt(texture.Image), context = bitmap.getContext("2d");
    if (context !== null) renderer.setTextureImageData(texture.Image, [context.getImageData(0, 0, bitmap.width, bitmap.height)]);
  }
  const sequences = data.Sequences.map((sequence) => ({ name: sequence.Name, start: sequence.Interval[0] ?? 0, end: sequence.Interval[1] ?? 0, looping: !sequence.NonLooping, rarity: sequence.Rarity }));
  return { renderer, model: data, path, sequences, sequence: -2, clock: 0 };
}
async function drawEffect(pose: EffectPose, view: ReturnType<typeof camera>, light: WorldLight | undefined, fog: ReturnType<typeof sceneFog>) {
  const instance = await prepareInstance(pose);
  const { renderer, model: data } = instance;
  renderer.setInstanceAlpha(pose.alpha / 255);
  renderer.setCamera(new Float32Array(view.eye), view.quaternion);
  const kind = pose.unit === true ? "unit" : "effect";
  const sample = animationSample(instance.sequences, { animation: pose.animation, subAnimations: pose.subAnimations, elapsed: pose.animationElapsed }, kind);
  const sampler = renderer as unknown as Sampler, elapsed = pose.animationElapsed * 1000;
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
  renderer.setTeamColor(new Float32Array((teams[pose.teamColor] ?? [160, 160, 160]).map((v) => v / 255)));
  renderer.setLightPosition([1000, -1000, 3000]); renderer.setLightColor([1, 1, 1]);
  const placed = transform(pose);
  renderer.setWispEnvironment({ ...(light === undefined ? {} : { light: { direction: modelDirection(placed, light.toward), key: light.key, ambient: light.ambient } }), ...(fog === undefined ? {} : { fog }) });
  // An HD model's first initGL draws its BRDF table at that table's size and leaves the viewport there.
  gl.viewport(0, 0, canvas.width, canvas.height);
  renderer.render(multiply(view.view, placed), view.projection, {});
}
const skies = new Map<string, Promise<ModelInstance>>();
/** The sky model around the eye, behind everything else, unlit, fogged only when the fog draws over the sky. */
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
  renderer.setWispEnvironment(fog === undefined ? undefined : { fog });
  gl.viewport(0, 0, canvas.width, canvas.height);
  renderer.render(multiply(view.view, placed), view.skyProjection, {});
  // The sky's layers leave depth writes off, and a masked depth clear clears nothing.
  gl.depthMask(true); gl.clear(gl.DEPTH_BUFFER_BIT);
}
type FilterPose = NonNullable<RenderScene["filter"]>;
let filterQuad: { program: WebGLProgram; vao: WebGLVertexArrayObject; color: WebGLUniformLocation | null; uv: WebGLUniformLocation | null; textured: WebGLUniformLocation | null } | undefined;
const filterTextures = new Map<string, Promise<WebGLTexture>>();
function filterProgram() {
  if (filterQuad !== undefined) return filterQuad;
  const shader = (type: number, source: string) => {
    const made = gl.createShader(type); if (made === null) throw new Error("no filter shader");
    gl.shaderSource(made, source); gl.compileShader(made);
    if (!gl.getShaderParameter(made, gl.COMPILE_STATUS)) throw new Error(`filter shader: ${gl.getShaderInfoLog(made)}`);
    return made;
  };
  const program = gl.createProgram(), vao = gl.createVertexArray(), buffer = gl.createBuffer();
  gl.attachShader(program, shader(gl.VERTEX_SHADER, `#version 300 es
in vec2 position; uniform vec4 uvRect; out vec2 uv;
void main() { uv = mix(uvRect.xy, uvRect.zw, vec2(position.x * 0.5 + 0.5, 0.5 - position.y * 0.5)); gl_Position = vec4(position, 0.0, 1.0); }`));
  gl.attachShader(program, shader(gl.FRAGMENT_SHADER, `#version 300 es
precision mediump float; in vec2 uv; uniform sampler2D map; uniform vec4 color; uniform bool textured; out vec4 fragment;
void main() { fragment = (textured ? texture(map, uv) : vec4(1.0)) * color; }`));
  gl.bindAttribLocation(program, 0, "position"); gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(`filter program: ${gl.getProgramInfoLog(program)}`);
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
    filterTextures.set(key, result);
  }
  return result;
}
/** The cinematic filter over the drawn world: its texture times its colour, combined with the scene by its blend mode. */
async function drawFilter(filter: FilterPose): Promise<void> {
  const quad = filterProgram();
  const texture = filter.texture === "" ? undefined : await filterTexture(filter.texture, /WRAP/.test(String(filter.texMapFlags)));
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
    // Twice the product: the scene's colour times the filter's, plus the same again.
    case "BLEND_MODE_MODULATE_2X": gl.blendFunc(gl.DST_COLOR, gl.SRC_COLOR); break;
    default: gl.disable(gl.BLEND);
  }
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  gl.bindVertexArray(null); gl.disable(gl.BLEND); gl.enable(gl.DEPTH_TEST); gl.depthMask(true);
}
const fonts = new Map<string, Promise<string>>();
/** A CSS family for a map or stock font file, loaded through the asset server; sans-serif for a font name or a file that won't load. */
function fontFamily(file: string): Promise<string> {
  if (!/\.(ttf|otf)$/i.test(file)) return Promise.resolve("sans-serif");
  let family = fonts.get(file);
  if (family === undefined) {
    const name = `wisp-font-${fonts.size}`;
    family = asset(file).then(async (bytes) => { const face = new FontFace(name, bytes); await face.load(); document.fonts.add(face); return `"${name}", sans-serif`; }).catch(() => "sans-serif");
    fonts.set(file, family);
  }
  return family;
}
/** Warcraft text: colour codes stripped, |n and newlines broken into lines, the block placed by its anchor and justification. */
function drawText(context: CanvasRenderingContext2D, raw: string, family: string, size: number, color: string, outline: boolean, x: number, horizontal: "left" | "center" | "right", y: number, vertical: "top" | "middle" | "bottom") {
  const lines = raw.replace(/\|c[0-9a-f]{8}|\|r/gi, "").replaceAll("|n", "\n").split("\n"), leading = size * 1.2;
  const top = vertical === "top" ? y : vertical === "middle" ? y - lines.length * leading / 2 : y - lines.length * leading;
  context.font = `${size}px ${family}`; context.textAlign = horizontal; context.textBaseline = "top";
  // A colour code colours the whole text: Smashcraft's damage digits are one coloured run.
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
async function uiTexture(path: string, color: number): Promise<HTMLCanvasElement> {
  const original = await textureAt(path);
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

declare global {
  interface Window {
    prepareRenderer: (width: number, height: number) => string;
    prepareScene: (scene: RenderScene, models?: readonly string[], progress?: (completed: number, total: number) => void) => Promise<{ models: number; instances: number; textures: number }>;
    renderScene: (scene: RenderScene, options?: { capture?: boolean }) => Promise<{ png: string; models: number; textures: number }>;
  }
}
window.prepareRenderer = (width, height) => {
  canvas.width = output.width = overlay.width = width; canvas.height = output.height = overlay.height = height;
  const context = canvas.getContext("webgl2", { antialias: true, alpha: false });
  if (context === null) throw new Error("Chrome could not create a WebGL2 context");
  gl = context;
  gl.depthFunc(gl.LEQUAL);
  const debug = gl.getExtension("WEBGL_debug_renderer_info");
  return debug === null ? String(gl.getParameter(gl.RENDERER)) : String(gl.getParameter(debug.UNMASKED_RENDERER_WEBGL));
};
window.prepareScene = async (scene, extraModels = [], progress) => {
  const frames = scene.ui.filter(frame => frame.texture !== "");
  const total = scene.effects.length + extraModels.length + frames.length;
  let completed = 0;
  const advanced = () => progress?.(++completed, total);
  for (const pose of scene.effects) { await prepareInstance(pose); advanced(); }
  for (const path of extraModels) { preparedModels.set(path, await createInstance(path)); advanced(); }
  for (const frame of frames) { await uiTexture(frame.texture, frame.color); advanced(); }
  return { models: models.size, instances: instances.size + preparedModels.size, textures: textures.size };
};
window.renderScene = async (scene, options) => {
  gl.viewport(0, 0, canvas.width, canvas.height); gl.depthMask(true); gl.clearColor(0.04, 0.06, 0.09, 1); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT); gl.enable(gl.DEPTH_TEST);
  const view = camera(scene, canvas.width / canvas.height);
  // Warcraft skips a model whose origin lies beyond the far plane from the eye, even when part of it reaches nearer.
  const beyondFar = (effect: EffectPose) => Math.hypot(effect.x - (view.eye[0] ?? 0), effect.y - (view.eye[1] ?? 0), effect.z - (view.eye[2] ?? 0)) > view.far;
  const visible = scene.effects.filter((effect) => effect.alpha > 0 && effect.scale > 0 && !effect.flat && !beyondFar(effect));
  await Promise.all(visible.map(prepareInstance));
  await drawSky(scene, view);
  const light = scene.environment === undefined ? undefined : await dayNightLight(scene.environment.dayNight.unit, scene.environment.timeOfDay);
  const fog = sceneFog(scene, view, false);
  for (const pose of orderDrawnModels(visible, (pose) => instances.get(pose.handle.id)?.model.Materials ?? [])) await drawEffect(pose, view, light, fog);
  if (scene.filter !== undefined) await drawFilter(scene.filter);
  const live = options?.capture === false;
  const shown = live ? "block" : "none";
  if (canvas.style.display !== shown) { canvas.style.display = overlay.style.display = shown; output.style.display = live ? "none" : "block"; }
  const context = (live ? overlay : output).getContext("2d"); if (context === null) throw new Error("no output canvas");
  if (live) context.clearRect(0, 0, overlay.width, overlay.height);
  else context.drawImage(canvas, 0, 0);
  const clip = multiply(view.projection, view.view);
  for (const tag of scene.textTags ?? []) {
    const at = [0, 1, 2, 3].map((row) => (clip[row] ?? 0) * tag.x + (clip[4 + row] ?? 0) * tag.y + (clip[8 + row] ?? 0) * tag.z + (clip[12 + row] ?? 0));
    const w = at[3] ?? 0;
    if (w <= 0 || tag.color[3] <= 0) continue;
    const [red, green, blue, alpha] = tag.color;
    drawText(context, tag.text, "sans-serif", tag.height * output.height / 0.6, `rgba(${red},${green},${blue},${alpha / 255})`, true,
      ((at[0] ?? 0) / w + 1) / 2 * output.width, "left", (1 - (at[1] ?? 0) / w) / 2 * output.height, "bottom");
  }
  const scaleX = output.height / 0.6, scaleY = output.height / 0.6;
  for (const frame of [...scene.ui].sort((a, b) => a.level - b.level)) {
    if (!frame.visible || frame.alpha <= 0 || frame.rectangle === undefined) continue;
    const [left, top, right, bottom] = frame.rectangle, x = output.width / 2 + (left - 0.4) * scaleX, y = (0.6 - top) * scaleY, width = (right - left) * scaleX, height = (top - bottom) * scaleY;
    context.globalAlpha = frame.alpha / 255;
    if (frame.texture !== "" && width > 0 && height > 0) { context.globalAlpha *= (frame.color >>> 24) / 255; context.drawImage(await uiTexture(frame.texture, frame.color), x, y, width, height); context.globalAlpha = frame.alpha / 255; }
    if (frame.text !== "") {
      // A font height is in UI units, 0.6 to the screen's height; BlzFrameSetScale multiplies it.
      const size = (frame.font.height > 0 ? frame.font.height * scaleY : Math.max(10, Math.min(22, height || 15))) * frame.scale;
      const alignment = frame.alignment ?? { vertical: "top", horizontal: "left" };
      drawText(context, frame.text, await fontFamily(frame.font.file), size, cssColor(frame.textColor), (frame.font.flags & 1) !== 0,
        alignment.horizontal === "left" ? x : alignment.horizontal === "center" ? x + width / 2 : x + width, alignment.horizontal,
        alignment.vertical === "top" ? y : alignment.vertical === "middle" ? y + height / 2 : y + height, alignment.vertical);
    }
  }
  context.globalAlpha = 1;
  return { png: options?.capture === false ? "" : output.toDataURL("image/png"), models: visible.length, textures: textures.size };
};
