import { drawnPoses } from "./culling";
import type { DrawnPose, RenderScene } from "./headlessRender";
import { multiply } from "../browser/matrix";
import { camera, transform } from "./screen";

export interface Extent {
  readonly minimum: ArrayLike<number>;
  readonly maximum: ArrayLike<number>;
}

const FILL = 0.75;

export function focusMatches(scene: RenderScene, model: string): DrawnPose[] {
  const eye = camera(scene, 16 / 9).eye;
  return drawnPoses(scene.effects, eye, Infinity, scene.world).filter((pose) => pose.model.includes(model));
}

function corners(extent: Extent): number[][] {
  const points: number[][] = [];
  for (let corner = 0; corner < 8; corner++) points.push([0, 1, 2].map((axis) => ((corner >> axis) & 1) === 0 ? extent.minimum[axis] ?? 0 : extent.maximum[axis] ?? 0));
  return points;
}

const row = (m: ArrayLike<number>, index: number, [x = 0, y = 0, z = 0]: readonly number[]) => (m[index] ?? 0) * x + (m[index + 4] ?? 0) * y + (m[index + 8] ?? 0) * z + (m[index + 12] ?? 0);

const axes = (view: ArrayLike<number>, index: number) => [view[index] ?? 0, view[index + 4] ?? 0, view[index + 8] ?? 0];

function screenBox(scene: RenderScene, pose: DrawnPose, extent: Extent, aspect: number) {
  const view = camera(scene, aspect), m = multiply(multiply(view.projection, view.view), transform(pose));
  let left = Infinity, right = -Infinity, bottom = Infinity, top = -Infinity;
  for (const corner of corners(extent)) {
    const w = row(m, 3, corner);
    if (w <= view.near) return { span: Infinity, x: 0, y: 0, right: [0, 0, 0], up: [0, 0, 0] };
    const sx = row(m, 0, corner) / w, sy = row(m, 1, corner) / w;
    left = Math.min(left, sx); right = Math.max(right, sx); bottom = Math.min(bottom, sy); top = Math.max(top, sy);
  }
  return { span: Math.max(right - left, top - bottom) / 2, x: (left + right) / 2, y: (bottom + top) / 2, right: axes(view.view, 0), up: axes(view.view, 1) };
}

const aimed = (scene: RenderScene, target: readonly number[], distance: number): RenderScene => ({
  ...scene,
  camera: { ...scene.camera, x: target[0] ?? 0, y: target[1] ?? 0, fields: { ...scene.camera.fields, CAMERA_FIELD_ZOFFSET: target[2] ?? 0, CAMERA_FIELD_TARGET_DISTANCE: distance } },
});

function centred(scene: RenderScene, pose: DrawnPose, extent: Extent, aspect: number, start: readonly number[], distance: number) {
  let target = [...start];
  for (let pass = 0; pass < 32; pass++) {
    const box = screenBox(aimed(scene, target, distance), pose, extent, aspect);
    if (box.span === Infinity || (Math.abs(box.x) < 1e-6 && Math.abs(box.y) < 1e-6)) return { target, span: box.span };
    const step = distance / 1000;
    const moved = (axis: readonly number[]) => screenBox(aimed(scene, target.map((v, i) => v + (axis[i] ?? 0) * step), distance), pose, extent, aspect);
    const sideways = (box.x - moved(box.right).x) / step, upwards = (box.y - moved(box.up).y) / step;
    target = target.map((v, i) => v + (box.right[i] ?? 0) * box.x / sideways + (box.up[i] ?? 0) * box.y / upwards);
  }
  return { target, span: screenBox(aimed(scene, target, distance), pose, extent, aspect).span };
}

export function focusScene(scene: RenderScene, pose: DrawnPose, extent: Extent, aspect: number): RenderScene {
  const middle = [0, 1, 2].map((axis) => ((extent.minimum[axis] ?? 0) + (extent.maximum[axis] ?? 0)) / 2);
  const m = transform(pose), start = [0, 1, 2].map((index) => row(m, index, middle));
  const at = (distance: number) => centred(scene, pose, extent, aspect, start, distance);
  let closer = scene.camera.fields.CAMERA_FIELD_TARGET_DISTANCE ?? 1650, farther = closer;
  for (let pass = 0; pass < 64 && at(closer).span < FILL; pass++) closer /= 2;
  for (let pass = 0; pass < 64 && at(farther).span > FILL; pass++) farther *= 2;
  for (let pass = 0; pass < 60; pass++) {
    const between = Math.sqrt(closer * farther);
    if (at(between).span > FILL) closer = between;
    else farther = between;
  }
  const distance = Math.sqrt(closer * farther);
  return aimed(scene, at(distance).target, distance);
}
