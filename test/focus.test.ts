import { expect, test } from "bun:test";
import type { DrawnPose, RenderScene } from "../host/render/headlessRender";
import { type Extent, focusMatches, focusScene, posedExtent } from "../host/render/focus";
import { boundsModel } from "../host/render/screenBounds";
import { parseMDL } from "../vendor/war3-model.mjs";
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

const cubeModel = (centre: readonly number[], half: readonly number[]) => {
  const corners = [0, 1, 2, 3, 4, 5, 6, 7].map((i) => [0, 1, 2].map((axis) => (centre[axis] ?? 0) + ((i >> axis) & 1 ? 1 : -1) * (half[axis] ?? 0)));
  return `Version { FormatVersion 800, }
Model "Cube" { NumGeosets 1, NumBones 1, BlendTime 150, MinimumExtent { -5000, -5000, -5000 }, MaximumExtent { 5000, 5000, 5000 }, }
Sequences 1 { Anim "Stand" { Interval { 0, 1000 }, } }
Textures 1 { Bitmap { Image "", ReplaceableId 1, } }
Materials 1 { Material { Layer { FilterMode None, static TextureID 0, static Alpha 1, } } }
Geoset {
    Vertices 8 { ${corners.map((c) => `{ ${c.join(", ")} },`).join(" ")} }
    Normals 8 { ${corners.map(() => "{ 0, 0, 1 },").join(" ")} }
    TVertices 8 { ${corners.map(() => "{ 0, 0 },").join(" ")} }
    VertexGroup { ${corners.map(() => "0,").join(" ")} }
    Faces 1 36 { Triangles { { 0, 1, 3, 0, 3, 2, 4, 6, 7, 4, 7, 5, 0, 4, 5, 0, 5, 1, 2, 3, 7, 2, 7, 6, 0, 2, 6, 0, 6, 4, 1, 5, 7, 1, 7, 3 }, } }
    Groups 1 1 { Matrices { 0 }, }
    MaterialID 0,
    SelectionGroup 0,
}
Bone "Root" { ObjectId 0, GeosetId 0, GeosetAnimId None, }
PivotPoints 1 { { 0, 0, 0 }, }
`;
};

test("[property] a posed body's extent is its drawn vertices' box, not the model's declared extent", () => {
  const next = random(35), between = (low: number, high: number) => low + (high - low) * next();
  for (let round = 0; round < 40; round++) {
    const centre = [between(-100, 100), between(-100, 100), between(0, 200)], half = [between(10, 80), between(10, 80), between(10, 120)];
    const found = boundsModel(parseMDL(cubeModel(centre, half)));
    const scene = { frame: 0, client: 0, camera: { x: 0, y: 0, fields: {} }, effects: [] } as unknown as RenderScene;
    const extent = posedExtent(pose({ model: "Cube.mdl" }), found, camera(scene, 16 / 9));
    for (let axis = 0; axis < 3; axis++) {
      expect(extent?.minimum[axis]).toBeCloseTo((centre[axis] ?? 0) - (half[axis] ?? 0), 3);
      expect(extent?.maximum[axis]).toBeCloseTo((centre[axis] ?? 0) + (half[axis] ?? 0), 3);
    }
  }
});
