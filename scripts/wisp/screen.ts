import type { model } from "../../vendor/war3-model.mjs";
import type { SequenceSample } from "../../src/headless/animation";
import type { DrawnPose, RenderScene } from "./headlessRender";

export type Matrix = Float32Array;
export const identity = (): Matrix => new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
export function multiply(a: Matrix, b: Matrix): Matrix {
  const out = new Float32Array(16);
  for (let column = 0; column < 4; column++) for (let row = 0; row < 4; row++) {
    for (let k = 0; k < 4; k++) out[column * 4 + row] = (out[column * 4 + row] ?? 0) + (a[k * 4 + row] ?? 0) * (b[column * 4 + k] ?? 0);
  }
  return out;
}
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
export const normalize = (v: readonly number[]): number[] => { const length = Math.hypot(...v); return v.map((value) => value / length); };
const cross = (a: readonly number[], b: readonly number[]): number[] => [(a[1] ?? 0) * (b[2] ?? 0) - (a[2] ?? 0) * (b[1] ?? 0), (a[2] ?? 0) * (b[0] ?? 0) - (a[0] ?? 0) * (b[2] ?? 0), (a[0] ?? 0) * (b[1] ?? 0) - (a[1] ?? 0) * (b[0] ?? 0)];
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

  return { view, projection, skyProjection: perspective(SKY_FAR), eye, quaternion, near, far, shadow: { eye, right: x, up: y, back: z, tangent, aspect, near, reach: Math.min(far, distance * SHADOW_REACH) } };
}
export const SKY_FAR = 1_000_000;

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

export interface PixelRect { readonly x: number; readonly y: number; readonly width: number; readonly height: number }
/** UI units are 0.8 x 0.6 at 4:3, scaled by the screen height and centred horizontally. */
export function uiPixels(rect: readonly [left: number, top: number, right: number, bottom: number], width: number, height: number): PixelRect {
  const [left, top, right, bottom] = rect, scale = height / 0.6;
  return { x: width / 2 + (left - 0.4) * scale, y: (0.6 - top) * scale, width: (right - left) * scale, height: (top - bottom) * scale };
}
