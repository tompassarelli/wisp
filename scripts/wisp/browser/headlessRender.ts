/// <reference lib="dom" />
import { ModelRenderer, decodeBLP, getBLPImageData, parseMDL, parseMDX, type model } from "../../../vendor/war3-model.mjs";
import type { EffectPose } from "../../../src/headless/client";
import type { RenderScene } from "../headlessRender";
import { parsableModel } from "../models";

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
  const near = field("NEARZ", 10), far = field("FARZ", 10000), projection = new Float32Array(16);
  projection[0] = 1 / tangent; projection[5] = aspect / tangent;
  projection[10] = (far + near) / (near - far); projection[11] = -1; projection[14] = 2 * far * near / (near - far);
  const rotation = yaw - Math.PI, elevation = -pitch;
  const halfYaw = rotation / 2, halfPitch = -elevation / 2;
  const quaternion: [number, number, number, number] = [-Math.sin(halfYaw) * Math.sin(halfPitch), Math.cos(halfYaw) * Math.sin(halfPitch), Math.sin(halfYaw) * Math.cos(halfPitch), Math.cos(halfYaw) * Math.cos(halfPitch)];
  return { view, projection, eye, quaternion };
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
interface ModelInstance { renderer: ModelRenderer; model: model.Model; path: string; clock: number; alpha: number; originalAlpha: (model.AnimVector | number)[] }
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
function sequenceIndex(data: model.Model, pose: EffectPose): number {
  if (typeof pose.animation === "number") return Math.max(0, Math.min(data.Sequences.length - 1, pose.animation));
  const main = typeof pose.animation === "string" ? pose.animation.replace(/^ANIM_TYPE_/, "").toLowerCase() : "stand";
  const wanted = [main, ...pose.subAnimations.map((part) => String(part).replace(/^SUBANIM_TYPE_/, "").toLowerCase())];
  const index = data.Sequences.findIndex((sequence) => wanted.every((part) => sequence.Name.toLowerCase().includes(part)));
  return Math.max(0, index);
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
  const original = await modelAt(path);
  // Geometry and animation tables are read-only; opacity entries must belong to each instance.
  const data = { ...original, GeosetAnims: original.GeosetAnims.map(animation => ({ ...animation })) };
  for (let index = 0; index < data.Geosets.length; index++) if (!data.GeosetAnims.some((animation) => animation.GeosetId === index)) data.GeosetAnims.push({ GeosetId: index, Alpha: 1, Color: new Float32Array([1, 1, 1]), Flags: 0 });
  const renderer = new ModelRenderer(data); renderer.initGL(gl);
  for (const texture of data.Textures) if (texture.Image !== "") {
    const bitmap = await textureAt(texture.Image), context = bitmap.getContext("2d");
    if (context !== null) renderer.setTextureImageData(texture.Image, [context.getImageData(0, 0, bitmap.width, bitmap.height)]);
  }
  return { renderer, model: data, path, clock: 0, alpha: 255, originalAlpha: data.GeosetAnims.map((animation) => animation.Alpha) };
}
async function drawEffect(pose: EffectPose, view: ReturnType<typeof camera>) {
  const instance = await prepareInstance(pose);
  const { renderer, model: data } = instance;
  if (instance.alpha !== pose.alpha) {
    for (let index = 0; index < data.GeosetAnims.length; index++) {
      const animation = data.GeosetAnims[index], original = instance.originalAlpha[index];
      if (animation === undefined || original === undefined) continue;
      animation.Alpha = typeof original === "number" ? original * pose.alpha / 255 : { ...original, Keys: original.Keys.map((key) => ({ ...key, Vector: new Float32Array(Array.from(key.Vector, (value) => value * pose.alpha / 255)) })) };
    }
    instance.alpha = pose.alpha;
  }
  renderer.setCamera(new Float32Array(view.eye), view.quaternion);
  const sequence = sequenceIndex(data, pose), info = data.Sequences[sequence];
  if (info === undefined) throw new Error(`model has no animation: ${pose.model}`);
  const start = info.Interval[0] ?? 0, end = info.Interval[1] ?? start, duration = Math.max(1, end - start);
  if (renderer.getSequence() !== sequence || pose.animationElapsed * 1000 < instance.clock) { renderer.setSequence(sequence); instance.clock = 0; }
  const elapsed = pose.animationElapsed * 1000;
  if (data.ParticleEmitters2.length > 0 || data.RibbonEmitters.length > 0) {
    while (instance.clock < elapsed) { const delta = Math.min(1000 / 60, elapsed - instance.clock); renderer.update(delta); instance.clock += delta; }
  }
  renderer.setFrame(start + (info.NonLooping ? Math.min(duration, elapsed) : elapsed % duration)); renderer.update(0);
  renderer.setTeamColor(new Float32Array((teams[pose.teamColor] ?? [160, 160, 160]).map((v) => v / 255)));
  renderer.setLightPosition([1000, -1000, 3000]); renderer.setLightColor([1, 1, 1]);
  renderer.render(multiply(view.view, transform(pose)), view.projection, {});
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
  const context = canvas.getContext("webgl2", { preserveDrawingBuffer: true, antialias: true, alpha: false });
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
  const visible = scene.effects.filter((effect) => effect.alpha > 0 && effect.scale > 0 && !effect.flat);
  for (const pose of visible) await drawEffect(pose, view);
  const live = options?.capture === false;
  canvas.style.display = overlay.style.display = live ? "block" : "none";
  output.style.display = live ? "none" : "block";
  const context = (live ? overlay : output).getContext("2d"); if (context === null) throw new Error("no output canvas");
  if (live) context.clearRect(0, 0, overlay.width, overlay.height);
  else context.drawImage(canvas, 0, 0);
  const scaleX = output.height / 0.6, scaleY = output.height / 0.6;
  for (const frame of [...scene.ui].sort((a, b) => a.level - b.level)) {
    if (!frame.visible || frame.alpha <= 0 || frame.rectangle === undefined) continue;
    const [left, top, right, bottom] = frame.rectangle, x = output.width / 2 + (left - 0.4) * scaleX, y = (0.6 - top) * scaleY, width = (right - left) * scaleX, height = (top - bottom) * scaleY;
    context.globalAlpha = frame.alpha / 255;
    if (frame.texture !== "" && width > 0 && height > 0) { context.globalAlpha *= (frame.color >>> 24) / 255; context.drawImage(await uiTexture(frame.texture, frame.color), x, y, width, height); context.globalAlpha = frame.alpha / 255; }
    if (frame.text !== "") {
      const text = frame.text.replace(/\|c[0-9a-f]{8}|\|r/gi, "").replaceAll("|n", "\n");
      context.fillStyle = cssColor(frame.textColor); context.font = `${Math.max(10, Math.min(22, height || 15))}px sans-serif`; context.textBaseline = "top";
      text.split("\n").forEach((line, index) => context.fillText(line, x, y + index * 16));
    }
  }
  context.globalAlpha = 1;
  return { png: options?.capture === false ? "" : output.toDataURL("image/png"), models: visible.length, textures: textures.size };
};
