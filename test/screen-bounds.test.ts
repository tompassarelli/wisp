import { expect, test } from "bun:test";
import { parseMDL } from "../vendor/war3-model.mjs";
import type { DrawnPose, RenderScene } from "../scripts/wisp/headlessRender";
import { boundsModel, sceneBounds, type PixelBox } from "../scripts/wisp/screenBounds";
import { timingTest } from "../scripts/wisp/timingTest";

type Vector3 = readonly [number, number, number];

// One bone, "Arm", turns a cube about AXIS through PIVOT: 90 degrees a second over a looping 2 s Stand.
const AXIS: Vector3 = [1 / 3, 2 / 3, 2 / 3], PIVOT: Vector3 = [0, 0, 30], CENTRE: Vector3 = [120, 0, 60], HALF = 40;
const corners: Vector3[] = [0, 1, 2, 3, 4, 5, 6, 7].map((i) => [CENTRE[0] + (i & 1 ? HALF : -HALF), CENTRE[1] + (i & 2 ? HALF : -HALF), CENTRE[2] + (i & 4 ? HALF : -HALF)]);
const turn = (degrees: number) => { const half = degrees * Math.PI / 360; return [...AXIS.map((v) => v * Math.sin(half)), Math.cos(half)].join(", "); };
const cube = `Version { FormatVersion 800, }
Model "Cube" { NumGeosets 1, NumBones 1, BlendTime 150, }
Sequences 1 { Anim "Stand" { Interval { 0, 2000 }, } }
Textures 1 { Bitmap { Image "", ReplaceableId 1, } }
Materials 1 { Material { Layer { FilterMode Transparent, static TextureID 0, static Alpha 1, } } }
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
Bone "Arm" { ObjectId 0, GeosetId 0, GeosetAnimId None,
    Rotation 3 { Linear, 0: { ${turn(0)} }, 1000: { ${turn(90)} }, 2000: { ${turn(180)} }, }
}
PivotPoints 1 { { ${PIVOT.join(", ")} }, }
`;

function random(seed: number): () => number {
  let state = seed >>> 0;
  return () => { state = (state + 0x6d2b79f5) >>> 0; let t = state; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

const add = (a: Vector3, b: Vector3): Vector3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a: Vector3, b: Vector3): Vector3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const scaled = (a: Vector3, s: number): Vector3 => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a: Vector3, b: Vector3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vector3, b: Vector3): Vector3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = (a: Vector3) => scaled(a, 1 / Math.hypot(...a));
/** Rodrigues' rotation of v by `angle` radians about the unit axis k. */
const rotate = (v: Vector3, k: Vector3, angle: number) => add(add(scaled(v, Math.cos(angle)), scaled(cross(k, v), Math.sin(angle))), scaled(k, dot(k, v) * (1 - Math.cos(angle))));

function pose(fields: Partial<DrawnPose>): DrawnPose {
  return { handle: { kind: "effect", id: 1 }, model: "Cube.mdl", created: 0, x: 0, y: 0, z: 0, alpha: 255, scale: 1, timeScale: 1, queuedAnimations: [], yaw: 0, pitch: 0, roll: 0,
    color: [255, 255, 255], teamColor: 0, matrixScale: [1, 1, 1], flat: false, animation: "stand", subAnimations: [], animationElapsed: 0, animationClock: 0, animationBlendTime: 0, animationBlend: undefined, ...fields };
}

test("[property] posed screen bounds of a turning cube equal the analytic projection of its corners", () => {
  const model = boundsModel(parseMDL(cube)), next = random(125);
  const between = (low: number, high: number) => low + (high - low) * next();
  let compared = 0, offFrame = 0, farCulled = 0;
  for (let round = 0; round < 300; round++) {
    const fields = { CAMERA_FIELD_ROTATION: between(0, 360), CAMERA_FIELD_ANGLE_OF_ATTACK: between(280, 360), CAMERA_FIELD_TARGET_DISTANCE: between(1200, 3000), CAMERA_FIELD_ZOFFSET: between(-100, 300),
      CAMERA_FIELD_FIELD_OF_VIEW: between(40, 100), CAMERA_FIELD_NEARZ: between(10, 100), CAMERA_FIELD_FARZ: between(1500, 6000) };
    const target: Vector3 = [between(-2000, 2000), between(-2000, 2000), fields.CAMERA_FIELD_ZOFFSET];
    const placed = pose({ x: target[0] + between(-500, 500), y: target[1] + between(-500, 500), z: between(-200, 400), yaw: between(-Math.PI, Math.PI), pitch: between(-Math.PI, Math.PI), roll: between(-Math.PI, Math.PI),
      scale: between(0.5, 2), matrixScale: [between(0.7, 1.3), between(0.7, 1.3), between(0.7, 1.3)], animationElapsed: between(0, 5) });
    const scene = { frame: 0, client: 0, camera: { x: target[0], y: target[1], fields }, effects: [placed] } as unknown as RenderScene;

    const frame = Math.floor(Math.fround(placed.animationElapsed * 1000) % 2000), angle = frame / 1000 * Math.PI / 2;
    const world = (local: Vector3): Vector3 => {
      let v: Vector3 = [local[0] * placed.scale * placed.matrixScale[0], local[1] * placed.scale * placed.matrixScale[1], local[2] * placed.scale * placed.matrixScale[2]];
      v = rotate(v, [1, 0, 0], placed.roll); v = rotate(v, [0, 1, 0], placed.pitch); v = rotate(v, [0, 0, 1], placed.yaw);
      return add(v, [placed.x, placed.y, placed.z]);
    };
    const yaw = fields.CAMERA_FIELD_ROTATION * Math.PI / 180, pitch = fields.CAMERA_FIELD_ANGLE_OF_ATTACK * Math.PI / 180;
    const forward: Vector3 = [Math.cos(yaw) * Math.cos(pitch), Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch)];
    const eye = sub(target, scaled(forward, fields.CAMERA_FIELD_TARGET_DISTANCE)), right = unit(cross(forward, [0, 0, 1])), up = cross(right, forward);
    const tangent = Math.tan(fields.CAMERA_FIELD_FIELD_OF_VIEW * Math.PI / 360);

    for (const [width, height] of [[800, 600], [1280, 720], [2560, 1080]] as const) {
      const project = (point: Vector3) => {
        const relative = sub(point, eye), depth = dot(relative, forward);
        return { depth, x: (dot(relative, right) / (depth * tangent) + 1) * width / 2, y: (1 - dot(relative, up) * (width / height) / (depth * tangent)) * height / 2 };
      };
      const [row, ...others] = sceneBounds(scene, (path) => path === "Cube.mdl" ? model : undefined, width, height);
      expect(others).toEqual([]);
      if (row === undefined) throw new Error("no bounds row");
      const far = Math.hypot(...sub([placed.x, placed.y, placed.z], eye)) > fields.CAMERA_FIELD_FARZ;
      expect(row.farCulled).toBe(far);
      expect(row.geosets).toEqual([{ index: 0, alpha: 1, filterMode: 1, drawn: true }]);
      const points = corners.map((corner) => project(world(add(rotate(sub(corner, PIVOT), AXIS, angle), PIVOT))));
      expect(row.behindEye).toBe(points.every((point) => point.depth < fields.CAMERA_FIELD_NEARZ));
      if (!points.every((point) => point.depth >= fields.CAMERA_FIELD_NEARZ && point.depth <= fields.CAMERA_FIELD_FARZ)) continue;
      const expected: PixelBox = { left: Math.min(...points.map((p) => p.x)), top: Math.min(...points.map((p) => p.y)), right: Math.max(...points.map((p) => p.x)), bottom: Math.max(...points.map((p) => p.y)) };
      const [arm] = row.nodes;
      if (row.box === undefined || arm?.box === undefined) throw new Error("no box in front of the eye");
      for (const box of [row.box, arm.box]) for (const edge of ["left", "top", "right", "bottom"] as const) expect(Math.abs(box[edge] - expected[edge])).toBeLessThanOrEqual(0.01);
      const pivot = project(world(PIVOT));
      expect(arm.name).toBe("Arm");
      expect(Math.abs(arm.pivot.x - pivot.x)).toBeLessThanOrEqual(0.01);
      expect(Math.abs(arm.pivot.y - pivot.y)).toBeLessThanOrEqual(0.01);
      const outside = expected.right < 0 || expected.left > width || expected.bottom < 0 || expected.top > height;
      expect(row.offFrame).toBe(outside);
      compared++; if (outside) offFrame++; if (far) farCulled++;
    }
  }
  expect(compared).toBeGreaterThan(450);
  expect(offFrame).toBeGreaterThan(0);
  expect(farCulled).toBeGreaterThan(0);
});

timingTest("a 20,000-triangle model reports its boxes in under 50 ms", () => {
  const data = parseMDL(cube), geoset = data.Geosets[0];
  if (geoset === undefined) throw new Error("no geoset");
  const side = 100, vertices = new Float32Array((side + 1) ** 2 * 3), faces = new Uint16Array(side * side * 6);
  for (let i = 0; i <= side; i++) for (let j = 0; j <= side; j++) vertices.set([i * 2, j * 2, (i * j) % 7], (i * (side + 1) + j) * 3);
  for (let i = 0; i < side; i++) for (let j = 0; j < side; j++) {
    const a = i * (side + 1) + j;
    faces.set([a, a + 1, a + side + 2, a, a + side + 2, a + side + 1], (i * side + j) * 6);
  }
  Object.assign(geoset, { Vertices: vertices, Faces: faces, VertexGroup: new Uint8Array(vertices.length / 3) });
  const model = boundsModel(data);
  const scene = { frame: 0, client: 0, camera: { x: 0, y: 0, fields: {} }, effects: [pose({ animationElapsed: 0.7 })] } as unknown as RenderScene;
  const before = performance.now();
  const [row] = sceneBounds(scene, () => model, 1920, 1080);
  const elapsed = performance.now() - before;
  expect(faces.length / 3).toBe(20_000);
  expect(row?.box).toBeDefined();
  expect(elapsed).toBeLessThan(50);
});
