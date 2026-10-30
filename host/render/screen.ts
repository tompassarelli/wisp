import type { model } from "../../vendor/war3-model.mjs";
import type { SequenceSample } from "../../src/headless/animation";
import type { PixelRect, TextureIdentity } from "./boundsTypes";
import type { DrawnPose, RenderScene } from "./renderScene";
import { cross, type Matrix, multiply, normalize, perspective } from "../browser/matrix";

export const identity = (): Matrix => new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
export function transform(pose: DrawnPose): Matrix {
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
export function camera(scene: RenderScene, aspect: number) {
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
  const tangent = Math.tan(field("FIELD_OF_VIEW", 70) * Math.PI / 360) * NATIVE_SPREAD;
  const near = field("NEARZ", 10), far = field("FARZ", 10000);
  const projection = nativeProjection(tangent, near, far, aspect);
  const rotation = yaw - Math.PI, elevation = -pitch;
  const halfYaw = rotation / 2, halfPitch = -elevation / 2;
  const quaternion: [number, number, number, number] = [-Math.sin(halfYaw) * Math.sin(halfPitch), Math.cos(halfYaw) * Math.sin(halfPitch), Math.sin(halfYaw) * Math.cos(halfPitch), Math.cos(halfYaw) * Math.cos(halfPitch)];

  return { view, projection, skyProjection: nativeProjection(tangent, near, SKY_FAR, aspect), eye, quaternion, near, far, shadow: { eye, right: x, up: y, back: z, tangent, aspect, near, reach: Math.min(far, distance * SHADOW_REACH) } };
}
export const SKY_FAR = 1_000_000;

/** Build 3.0.0.24268 at 1920x1080 draws the world 1/1.0472 the size the FOV gives, about the screen centre, and 0.00633 of the half-height higher (wisp#125 box 3). */
export const NATIVE_SPREAD = 1.0472, NATIVE_RISE = 0.00633;
function nativeProjection(tangent: number, near: number, far: number, aspect: number): Matrix {
  const out = perspective(tangent, near, far, aspect);
  out[9] = -NATIVE_RISE;
  return out;
}

const SHADOW_REACH = 2.5;

export interface Sampler {
  rendererData: { frame: number; animation: number; animationInfo: { Interval: ArrayLike<number> }; globalSequencesFrames: number[]; rootNode: unknown; nodes: { matrix: Matrix }[] };
  interp: { vec3(out: Float32Array, vector: unknown): Float32Array | null; quat(out: Float32Array, vector: unknown): Float32Array | null; animVectorVal(vector: unknown, fallback: number): number };
  updateNode(node: { node: { Translation?: unknown; Rotation?: unknown; Scaling?: unknown } }): void;
}

const NO_SEQUENCE = { Interval: [0xffffffff, 0xffffffff] };
export function show(sampler: Sampler, data: model.Model, sample: SequenceSample): void {
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

export function poseNodes(sampler: Sampler, data: model.Model, saved: SequenceSample | undefined, weight: number): void {
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

/** UI units are 0.8 x 0.6 at 4:3, scaled by the screen height and centred horizontally. */
export function uiPixels(rect: readonly [left: number, top: number, right: number, bottom: number], width: number, height: number): PixelRect {
  const [left, top, right, bottom] = rect, scale = height / 0.6;
  return { x: width / 2 + (left - 0.4) * scale, y: (0.6 - top) * scale, width: (right - left) * scale, height: (top - bottom) * scale };
}

/** The base height in UI units Classic draws a plain `TEXT` frame's text at, whatever `BlzFrameSetFont` set: measured on build 24268 (about 8.5 px in a 724 px window), so a frame with a scale is sized by it. */
const PLAIN_TEXT_BASE = 0.0085;

/** A text frame's font size in pixels at a screen `height`: a scaled plain frame is its scale times Classic's fixed base, any other frame its font height (or a size from the screen and its own pixel height when it has none) times its scale. */
export function uiTextSize(frame: { readonly font: { readonly height: number }; readonly scale: number; readonly plain: boolean }, height: number, frameHeight: number): number {
  const screen = height / 0.6;
  if (frame.plain && frame.scale !== 1) return PLAIN_TEXT_BASE * screen * frame.scale;
  return (frame.font.height > 0 ? frame.font.height * screen : Math.max(10, Math.min(0.0122 * screen, frameHeight || 15))) * frame.scale;
}

export interface UiRow {
  readonly name: string;
  readonly type: string;
  readonly level: number;
  readonly texture: string | null;
  readonly layer: string | null;
  readonly sha256: string | null;
  /** UV [u0, v0, u1, v1]: a texture set with `BlzFrameSetTexture` is drawn whole. */
  readonly region: readonly [number, number, number, number] | null;
  /** [left, top, right, bottom] in UI units. */
  readonly ui: readonly [number, number, number, number];
  readonly pixels: PixelRect;
  /** Some edge lies outside the 0.8 x 0.6 area of the 4:3 screen. */
  readonly outside43: boolean;
}
/** One row per frame the renderer draws, in its drawing order, at a `width` x `height` canvas. */
export function uiReport(scene: Pick<RenderScene, "ui">, width: number, height: number, textures: (path: string) => TextureIdentity | undefined = () => undefined): UiRow[] {
  return [...scene.ui].sort((a, b) => a.level - b.level).flatMap((frame) => {
    if (!frame.visible || frame.alpha <= 0 || frame.rectangle === undefined) return [];
    const [left, top, right, bottom] = frame.rectangle, texture = frame.texture === "" ? undefined : frame.texture;
    const identity = texture === undefined ? undefined : textures(texture);
    return [{ name: frame.name, type: frame.type, level: frame.level, texture: texture ?? null, layer: identity?.layer ?? null, sha256: identity?.sha256 ?? null,
      region: texture === undefined ? null : [0, 0, 1, 1], ui: [left, top, right, bottom], pixels: uiPixels(frame.rectangle, width, height),
      outside43: left < 0 || right > 0.8 || bottom < 0 || top > 0.6 }];
  });
}
