import { expect, test } from "bun:test";
import type { DrawnPose, RenderScene } from "../host/render/headlessRender";
import { type Extent, focusMatches, focusScene } from "../host/render/focus";
import { multiply } from "../host/browser/matrix";
import { camera, transform } from "../host/render/screen";

function pose(fields: Partial<DrawnPose>): DrawnPose {
  return { handle: { kind: "effect", id: 1 }, model: "Units/Fighter.mdx", created: 0, x: 0, y: 0, z: 0, alpha: 255, scale: 1, timeScale: 1, queuedAnimations: [], yaw: 0, pitch: 0, roll: 0,
    color: [255, 255, 255], teamColor: 0, matrixScale: [1, 1, 1], flat: false, animation: "stand", subAnimations: [], animationElapsed: 0, animationClock: 0, animationBlendTime: 0, animationBlend: undefined, ...fields } as DrawnPose;
}

const random = (seed: number) => () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32;

function screenBox(scene: RenderScene, placed: DrawnPose, extent: Extent, aspect: number) {
  const view = camera(scene, aspect), m = multiply(multiply(view.projection, view.view), transform(placed));
  const xs: number[] = [], ys: number[] = [];
  for (let corner = 0; corner < 8; corner++) {
    const [x = 0, y = 0, z = 0] = [0, 1, 2].map((axis) => ((corner >> axis) & 1) === 0 ? extent.minimum[axis] ?? 0 : extent.maximum[axis] ?? 0);
    const w = (m[3] ?? 0) * x + (m[7] ?? 0) * y + (m[11] ?? 0) * z + (m[15] ?? 0);
    xs.push(((m[0] ?? 0) * x + (m[4] ?? 0) * y + (m[8] ?? 0) * z + (m[12] ?? 0)) / w);
    ys.push(((m[1] ?? 0) * x + (m[5] ?? 0) * y + (m[9] ?? 0) * z + (m[13] ?? 0)) / w);
  }
  return { left: Math.min(...xs), right: Math.max(...xs), bottom: Math.min(...ys), top: Math.max(...ys) };
}

test("[property] a focused scene centres the one matching body and fits its extent to three quarters of the frame, past a hidden twin, keeping the camera's angles", () => {
  const next = random(15), between = (low: number, high: number) => low + (high - low) * next();
  for (let round = 0; round < 200; round++) {
    const fields = { CAMERA_FIELD_ROTATION: between(0, 360), CAMERA_FIELD_ANGLE_OF_ATTACK: between(290, 350), CAMERA_FIELD_TARGET_DISTANCE: between(1200, 4000), CAMERA_FIELD_ZOFFSET: between(-100, 300),
      CAMERA_FIELD_FIELD_OF_VIEW: between(40, 100), CAMERA_FIELD_NEARZ: 10, CAMERA_FIELD_FARZ: 10000 };
    const body = pose({ x: between(-2000, 2000), y: between(-2000, 2000), z: between(-100, 300), yaw: between(-Math.PI, Math.PI), scale: between(0.5, 2) });
    const other = pose({ handle: { kind: "effect", id: 2 } as DrawnPose["handle"], model: "Units/Stage.mdx", x: between(-2000, 2000), y: between(-2000, 2000) });
    const hidden = pose({ handle: { kind: "effect", id: 3 } as DrawnPose["handle"], alpha: 0, x: between(-2000, 2000), y: between(-2000, 2000) });
    const scene = { frame: 0, client: 0, camera: { x: between(-2000, 2000), y: between(-2000, 2000), fields }, effects: [other, hidden, body] } as unknown as RenderScene;
    const extent = { minimum: [-between(20, 60), -between(20, 60), 0], maximum: [between(20, 60), between(20, 60), between(100, 260)] };
    const aspect = between(1, 2);
    expect(focusMatches(scene, "Fighter")).toEqual([body]);
    const focused = focusScene(scene, body, extent, aspect);
    const box = screenBox(focused, body, extent, aspect);
    expect(Math.max(box.right - box.left, box.top - box.bottom) / 2).toBeCloseTo(0.75, 2);
    expect(Math.abs((box.left + box.right) / 2)).toBeLessThan(0.1);
    expect(Math.abs((box.bottom + box.top) / 2)).toBeLessThan(0.1);
    for (const field of ["CAMERA_FIELD_ROTATION", "CAMERA_FIELD_ANGLE_OF_ATTACK", "CAMERA_FIELD_FIELD_OF_VIEW"] as const) expect(focused.camera.fields[field]).toBe(fields[field]);
  }
});
