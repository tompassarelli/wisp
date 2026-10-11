import { expect, test } from "bun:test";
import { parseMDL } from "../vendor/war3-model.mjs";
import type { DrawnPose, RenderScene } from "../scripts/wisp/headlessRender";
import { boundsModel, inFrame, sceneBounds, type PixelBox } from "../scripts/wisp/screenBounds";

type Vector3 = readonly [number, number, number];

// One bone, "Arm", turns a cube about AXIS through PIVOT: 90 degrees a second over a looping 2 s Stand.
const AXIS: Vector3 = [1 / 3, 2 / 3, 2 / 3], PIVOT: Vector3 = [0, 0, 30], CENTRE: Vector3 = [120, 0, 60], HALF = 40;
const corners: Vector3[] = [0, 1, 2, 3, 4, 5, 6, 7].map((i) => [CENTRE[0] + (i & 1 ? HALF : -HALF), CENTRE[1] + (i & 2 ? HALF : -HALF), CENTRE[2] + (i & 4 ? HALF : -HALF)]);
const turn = (degrees: number) => { const half = degrees * Math.PI / 360; return [...AXIS.map((v) => v * Math.sin(half)), Math.cos(half)].join(", "); };
const cubeModel = (bone: string) => `Version { FormatVersion 800, }
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
Bone "${bone}" { ObjectId 0, GeosetId 0, GeosetAnimId None,
    Rotation 3 { Linear, 0: { ${turn(0)} }, 1000: { ${turn(90)} }, 2000: { ${turn(180)} }, }
}
PivotPoints 1 { { ${PIVOT.join(", ")} }, }
`;
const cube = cubeModel("Arm");

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

type Point = readonly [number, number];
const turnOf = (p: Point, a: Point, b: Point) => (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]);
/** Andrew's monotone chain, turning positively. */
function hull(points: readonly Point[]): Point[] {
  const sorted = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]), chain = (list: readonly Point[]) => {
    const out: Point[] = [];
    for (const p of list) { while (out.length >= 2 && turnOf(p, out[out.length - 2] as Point, out[out.length - 1] as Point) <= 0) out.pop(); out.push(p); }
    return out.slice(0, -1);
  };
  return [...chain(sorted), ...chain([...sorted].reverse())];
}
/** The part of a convex polygon inside another, both turning positively. */
function intersect(polygon: readonly Point[], by: readonly Point[]): Point[] {
  let out = [...polygon];
  by.forEach((a, i) => {
    const b = by[(i + 1) % by.length] as Point, input = out;
    out = [];
    input.forEach((p, j) => {
      const q = input[(j + 1) % input.length] as Point, sp = turnOf(p, a, b), sq = turnOf(q, a, b);
      if (sp >= 0) out.push(p);
      if ((sp >= 0) !== (sq >= 0)) { const t = sp / (sp - sq); out.push([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t]); }
    });
  });
  return out;
}
const area = (polygon: readonly Point[]) => Math.abs(polygon.reduce((sum, p, i) => { const q = polygon[(i + 1) % polygon.length] as Point; return sum + p[0] * q[1] - q[0] * p[1]; }, 0)) / 2;
const perimeter = (polygon: readonly Point[]) => polygon.reduce((sum, p, i) => { const q = polygon[(i + 1) % polygon.length] as Point; return sum + Math.hypot(q[0] - p[0], q[1] - p[1]); }, 0);

test("[property] the in-frame raster covers a cube's projected polygon and hides the overlap of a cube in front", () => {
  const models = new Map([["Head.mdl", boundsModel(parseMDL(cubeModel("Head")))], ["Weapon.mdl", boundsModel(parseMDL(cubeModel("Weapon")))]]), next = random(126);
  const between = (low: number, high: number) => low + (high - low) * next(), whole = (low: number, high: number) => Math.floor(between(low, high + 1));
  let covered = 0, cropped = 0, overlapped = 0, edges = 0, missed = 0;
  for (let round = 0; round < 120; round++) {
    const fields = { CAMERA_FIELD_ROTATION: between(0, 360), CAMERA_FIELD_ANGLE_OF_ATTACK: between(280, 360), CAMERA_FIELD_TARGET_DISTANCE: between(500, 1500), CAMERA_FIELD_ZOFFSET: between(-100, 300),
      CAMERA_FIELD_FIELD_OF_VIEW: between(40, 100), CAMERA_FIELD_NEARZ: between(10, 100), CAMERA_FIELD_FARZ: 10000 };
    const target: Vector3 = [between(-2000, 2000), between(-2000, 2000), fields.CAMERA_FIELD_ZOFFSET];
    const width = whole(160, 480), height = whole(160, 480);
    const yaw = fields.CAMERA_FIELD_ROTATION * Math.PI / 180, pitch = fields.CAMERA_FIELD_ANGLE_OF_ATTACK * Math.PI / 180;
    const forward: Vector3 = [Math.cos(yaw) * Math.cos(pitch), Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch)];
    const eye = sub(target, scaled(forward, fields.CAMERA_FIELD_TARGET_DISTANCE)), right = unit(cross(forward, [0, 0, 1])), up = cross(right, forward);
    const tangent = Math.tan(fields.CAMERA_FIELD_FIELD_OF_VIEW * Math.PI / 360);
    const project = (point: Vector3) => {
      const relative = sub(point, eye), depth = dot(relative, forward);
      return { depth, x: (dot(relative, right) / (depth * tangent) + 1) * width / 2, y: (1 - dot(relative, up) * (width / height) / (depth * tangent)) * height / 2 };
    };
    const placed = (model: string, at: Vector3) => pose({ model, x: at[0], y: at[1], z: at[2], yaw: between(-Math.PI, Math.PI), pitch: between(-Math.PI, Math.PI), roll: between(-Math.PI, Math.PI),
      scale: between(0.3, 1.2), matrixScale: [between(0.7, 1.3), between(0.7, 1.3), between(0.7, 1.3)], animationElapsed: between(0, 5) });
    const corners2 = (placedPose: DrawnPose) => {
      const frame = Math.floor(Math.fround(placedPose.animationElapsed * 1000) % 2000), angle = frame / 1000 * Math.PI / 2;
      return corners.map((corner) => {
        let v = add(rotate(sub(corner, PIVOT), AXIS, angle), PIVOT);
        v = [v[0] * placedPose.scale * placedPose.matrixScale[0], v[1] * placedPose.scale * placedPose.matrixScale[1], v[2] * placedPose.scale * placedPose.matrixScale[2]];
        v = rotate(v, [1, 0, 0], placedPose.roll); v = rotate(v, [0, 1, 0], placedPose.pitch); v = rotate(v, [0, 0, 1], placedPose.yaw);
        return project(add(v, [placedPose.x, placedPose.y, placedPose.z]));
      });
    };
    const back = placed("Head.mdl", add(target, [between(-300, 300), between(-300, 300), between(-150, 150)]));
    const front = placed("Weapon.mdl", add(sub([back.x, back.y, back.z], scaled(sub([back.x, back.y, back.z], eye), between(0.25, 0.5))), [between(-60, 60), between(-60, 60), between(-60, 60)]));
    const backCorners = corners2(back), frontCorners = corners2(front);
    if ([...backCorners, ...frontCorners].some((p) => p.depth < fields.CAMERA_FIELD_NEARZ)) continue;

    const crop = { x: whole(0, width / 4), y: whole(0, height / 4), width: whole(width / 2, width * 3 / 4), height: whole(height / 2, height * 3 / 4) };
    const frame = { x: whole(-50, 900), y: whole(-50, 500), width: crop.width, height: crop.height };
    const cropPolygon = hull([[crop.x, crop.y], [crop.x + crop.width, crop.y], [crop.x, crop.y + crop.height], [crop.x + crop.width, crop.y + crop.height]]);
    const backPolygon = intersect(hull(backCorners.map((p) => [p.x, p.y])), cropPolygon), frontPolygon = intersect(hull(frontCorners.map((p) => [p.x, p.y])), cropPolygon);
    const portrait = (effects: DrawnPose[]) => inFrame({ scene: { camera: { x: target[0], y: target[1], fields }, effects } as unknown as RenderScene, width, height, crop, texture: { width: crop.width, height: crop.height },
      parts: { head: ["Head"], weapon: ["Weapon"] } }, (path) => models.get(path), frame);

    const alone = portrait([back]), head = alone.parts.head;
    if (head === undefined) throw new Error("no head row");
    expect(Math.abs(head.pixels - area(backPolygon))).toBeLessThanOrEqual(perimeter(backPolygon) + 1);
    expect(alone.headHiddenByWeapon).toBe(0);
    if (backPolygon.length > 0 && area(backPolygon) > 16) {
      if (head.box === undefined) throw new Error("no head box");
      // The pixels whose centres the analytic polygon holds, shifted from the crop into the frame.
      const expected = { left: Infinity, top: Infinity, right: -Infinity, bottom: -Infinity };
      for (let y = crop.y; y < crop.y + crop.height; y++) for (let x = crop.x; x < crop.x + crop.width; x++) {
        if (!backPolygon.every((a, i) => turnOf([x + 0.5, y + 0.5], a, backPolygon[(i + 1) % backPolygon.length] as Point) >= 0)) continue;
        expected.left = Math.min(expected.left, x - crop.x + frame.x); expected.right = Math.max(expected.right, x + 1 - crop.x + frame.x);
        expected.top = Math.min(expected.top, y - crop.y + frame.y); expected.bottom = Math.max(expected.bottom, y + 1 - crop.y + frame.y);
      }
      // Float32 posing moves a centre lying on an edge by at most one pixel, and rarely.
      for (const edge of ["left", "top", "right", "bottom"] as const) { expect(Math.abs(head.box[edge] - expected[edge])).toBeLessThanOrEqual(1); edges++; if (head.box[edge] !== expected[edge]) missed++; }
      expect(alone.crownMargin).toBe(head.box.top - frame.y);
      covered++;
      if (area(backPolygon) < area(hull(backCorners.map((p) => [p.x, p.y]))) - 1) cropped++;
    }

    if (Math.max(...frontCorners.map((p) => p.depth)) >= Math.min(...backCorners.map((p) => p.depth))) continue;
    const both = portrait([front, back]), overlap = intersect(backPolygon, hull(frontCorners.map((p) => [p.x, p.y])));
    expect(Math.abs(both.headHiddenByWeapon - area(overlap))).toBeLessThanOrEqual(perimeter(overlap) + 1);
    expect(Math.abs((both.parts.weapon?.pixels ?? 0) - area(frontPolygon))).toBeLessThanOrEqual(perimeter(frontPolygon) + 1);
    expect(Math.abs((both.parts.head?.pixels ?? 0) - (head.pixels - both.headHiddenByWeapon))).toBe(0);
    if (area(overlap) > 4) overlapped++;
  }
  expect(missed).toBeLessThanOrEqual(edges * 0.02);
  expect(covered).toBeGreaterThan(60);
  expect(cropped).toBeGreaterThan(5);
  expect(overlapped).toBeGreaterThan(10);
});
