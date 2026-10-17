import { expect, test } from "bun:test";
import { parseMDL } from "../vendor/war3-model.mjs";
import type { DrawnPose, RenderScene } from "../scripts/wisp/render/headlessRender";
import { boundsModel, compareEdges, inFrame, sceneBounds, silhouetteBounds, SILHOUETTE_DELTA, type PixelBox, type Texels } from "../scripts/wisp/render/screenBounds";
import { NATIVE_RISE, NATIVE_SPREAD } from "../scripts/wisp/render/screen";

type Vector3 = readonly [number, number, number];

// One bone, "Arm", turns a cube about AXIS through PIVOT: 90 degrees a second over a looping 2 s Stand.
const AXIS: Vector3 = [1 / 3, 2 / 3, 2 / 3], PIVOT: Vector3 = [0, 0, 30], CENTRE: Vector3 = [120, 0, 60], HALF = 40;
const corners: Vector3[] = [0, 1, 2, 3, 4, 5, 6, 7].map((i) => [CENTRE[0] + (i & 1 ? HALF : -HALF), CENTRE[1] + (i & 2 ? HALF : -HALF), CENTRE[2] + (i & 4 ? HALF : -HALF)]);
const turn = (degrees: number) => { const half = degrees * Math.PI / 360; return [...AXIS.map((v) => v * Math.sin(half)), Math.cos(half)].join(", "); };
// With `parent`, the turning bone hangs from a still bone of that name pivoting at the origin.
const cubeModel = (bone: string, parent?: string) => `Version { FormatVersion 800, }
Model "Cube" { NumGeosets 1, NumBones ${parent === undefined ? 1 : 2}, BlendTime 150, }
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
Bone "${bone}" { ObjectId 0,${parent === undefined ? "" : " Parent 1,"} GeosetId 0, GeosetAnimId None,
    Rotation 3 { Linear, 0: { ${turn(0)} }, 1000: { ${turn(90)} }, 2000: { ${turn(180)} }, }
}
${parent === undefined ? "" : `Bone "${parent}" { ObjectId 1, GeosetId None, GeosetAnimId None, }\n`}PivotPoints ${parent === undefined ? 1 : 2} { { ${PIVOT.join(", ")} },${parent === undefined ? "" : " { 0, 0, 0 },"} }
`;
const cube = cubeModel("Arm");
// The cube, opaque, with a quad through its middle wider than the cube, drawn by `layer` from a second texture `bitmap`:
// an additive team glow, of which only the disc inside the cube draws, or an alpha-keyed Transparent veil.
const GLOW_HALF = HALF * 1.38, glowCorners: Vector3[] = [0, 1, 2, 3].map((i) => [CENTRE[0] + (i & 1 ? GLOW_HALF : -GLOW_HALF), CENTRE[1] + (i & 2 ? GLOW_HALF : -GLOW_HALF), CENTRE[2]]);
const quadCube = (bitmap: string, layer: string) => cube.replace("FilterMode Transparent", "FilterMode None").replace("NumGeosets 1", "NumGeosets 2").replace('Textures 1 { Bitmap { Image "", ReplaceableId 1, } }', `Textures 2 { Bitmap { Image "", ReplaceableId 1, } Bitmap { ${bitmap} } }`)
  .replace("Materials 1 {", "Materials 2 {").replace("Alpha 1, } } }", `Alpha 1, } } Material { Layer { ${layer} static TextureID 1, static Alpha 1, } } }`).replace("Bone \"Arm\"", `Geoset {
    Vertices 4 { ${glowCorners.map((c) => `{ ${c.join(", ")} },`).join(" ")} }
    Normals 4 { ${glowCorners.map(() => "{ 0, 0, 1 },").join(" ")} }
    TVertices 4 { { 0, 0 }, { 1, 0 }, { 0, 1 }, { 1, 1 }, }
    VertexGroup { 0, 0, 0, 0, }
    Faces 1 6 { Triangles { { 0, 1, 3, 0, 3, 2 }, } }
    Groups 1 1 { Matrices { 0 }, }
    MaterialID 1,
    SelectionGroup 0,
}
Bone "Arm"`);
const glowCube = quadCube('Image "", ReplaceableId 2,', "FilterMode Additive, TwoSided,"), veiledCube = quadCube('Image "Veil.blp",', "FilterMode Transparent, TwoSided,");

// A square on the turning bone, wider than the cube, drawn by one layer: an alpha-keyed texture, one-sided or two-sided, or an additive team glow at alpha 0.75.
const QUAD_HALF = HALF * 2, QUAD_Z = CENTRE[2] + HALF, GLOW_ALPHA = 0.75;
const quadModel = (texture: string, layer: string) => `Version { FormatVersion 800, }
Model "Quad" { NumGeosets 1, NumBones 1, BlendTime 150, }
Sequences 1 { Anim "Stand" { Interval { 0, 2000 }, } }
Textures 1 { Bitmap { ${texture} } }
Materials 1 { Material { Layer { ${layer} static TextureID 0, } } }
Geoset {
    Vertices 4 { ${[0, 1, 2, 3].map((i) => `{ ${CENTRE[0] + (i & 1 ? QUAD_HALF : -QUAD_HALF)}, ${CENTRE[1] + (i & 2 ? QUAD_HALF : -QUAD_HALF)}, ${QUAD_Z} },`).join(" ")} }
    Normals 4 { ${[0, 1, 2, 3].map(() => "{ 0, 0, 1 },").join(" ")} }
    TVertices 4 { { 0, 0 }, { 1, 0 }, { 0, 1 }, { 1, 1 }, }
    VertexGroup { 0, 0, 0, 0, }
    Faces 1 6 { Triangles { { 0, 1, 3, 0, 3, 2 }, } }
    Groups 1 1 { Matrices { 0 }, }
    MaterialID 0,
    SelectionGroup 0,
}
Bone "Arm" { ObjectId 0, GeosetId 0, GeosetAnimId None,
    Rotation 3 { Linear, 0: { ${turn(0)} }, 1000: { ${turn(90)} }, 2000: { ${turn(180)} }, }
}
PivotPoints 1 { { ${PIVOT.join(", ")} }, }
`;
const keyedQuad = quadModel('Image "Quad.blp",', "FilterMode Transparent, static Alpha 1,"), twoSidedQuad = quadModel('Image "Quad.blp",', "FilterMode Transparent, TwoSided, static Alpha 1,"), glowQuad = quadModel('Image "", ReplaceableId 2,', `FilterMode Additive, static Alpha ${GLOW_ALPHA},`);
const quadPoint = (u: number, v: number): Vector3 => [CENTRE[0] - QUAD_HALF + 2 * QUAD_HALF * u, CENTRE[1] - QUAD_HALF + 2 * QUAD_HALF * v, QUAD_Z];
const TEXELS = 64;
const texture = (rgba: (x: number, y: number) => readonly [number, number, number, number]): Texels => {
  const data = new Uint8Array(TEXELS * TEXELS * 4);
  for (let y = 0; y < TEXELS; y++) for (let x = 0; x < TEXELS; x++) data.set(rgba(x, y), (y * TEXELS + x) * 4);
  return { width: TEXELS, height: TEXELS, data };
};

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

test("[property] posed screen bounds of a turning cube equal the analytic projection of its corners, and of a textured quad only the texels its layer draws on the faces it doesn't cull", () => {
  const model = boundsModel(parseMDL(cube)), glow = boundsModel(parseMDL(glowCube)), veiled = boundsModel(parseMDL(veiledCube)), keyed = boundsModel(parseMDL(keyedQuad)), twoSided = boundsModel(parseMDL(twoSidedQuad)), glowing = boundsModel(parseMDL(glowQuad)), next = random(125);
  const brightTexels = texture(() => [255, 255, 255, 255]);
  const between = (low: number, high: number) => low + (high - low) * next();
  let compared = 0, offFrame = 0, farCulled = 0, textured = 0, brightGlow = 0, veils = 0, backFaces = 0;
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
    const tangent = Math.tan(fields.CAMERA_FIELD_FIELD_OF_VIEW * Math.PI / 360) * NATIVE_SPREAD;
    // An opaque texel rectangle in a transparent border, and a red radial falloff reaching zero at `reach` from the centre.
    const c0 = Math.floor(between(2, 20)), c1 = Math.floor(between(c0 + 8, 62)), r0 = Math.floor(between(2, 20)), r1 = Math.floor(between(r0 + 8, 62)), reach = between(0.15, 0.48);
    const keyedTexels = texture((x, y) => x >= c0 && x < c1 && y >= r0 && y < r1 ? [255, 255, 255, 255] : [255, 255, 255, 0]);
    const glowTexels = texture((x, y) => [Math.round(255 * Math.max(0, 1 - Math.hypot((x + 0.5) / TEXELS - 0.5, (y + 0.5) / TEXELS - 0.5) / reach)), 0, 0, 255]);
    const textures = { image: (path: string) => path === "Quad.blp" ? keyedTexels : undefined, teamGlow: (team: number) => team === 0 ? glowTexels : undefined };
    const brightTextures = { image: () => undefined, teamGlow: () => brightTexels };
    // Bilinear alpha is the product of two ramps across the opaque texels' edges, so it reaches the 0.75 cut a quarter texel inside each edge and on
    // the hyperbola ramp(x) * ramp(y) = 0.75 at each corner; the glow adds more than the silhouette threshold inside `shows`.
    const keyedRegion = [[c0 - 1, r0 - 1, 1, 1], [c1, r0 - 1, -1, 1], [c0 - 1, r1, 1, -1], [c1, r1, -1, -1]].flatMap(([x = 0, y = 0, sx = 0, sy = 0]) =>
      Array.from({ length: 17 }, (_, i) => { const fx = 0.75 + 0.25 * i / 16; return [(x + sx * fx + 0.5) / TEXELS, (y + sy * 0.75 / fx + 0.5) / TEXELS] as const; }));
    const shows = reach * (1 - SILHOUETTE_DELTA / 255 / GLOW_ALPHA);
    const glowRegion = Array.from({ length: 180 }, (_, i) => [0.5 + shows * Math.cos(i * Math.PI / 90), 0.5 + shows * Math.sin(i * Math.PI / 90)] as const);

    for (const [width, height] of [[800, 600], [1280, 720], [2560, 1080]] as const) {
      const project = (point: Vector3) => {
        const relative = sub(point, eye), depth = dot(relative, forward);
        return { depth, x: (dot(relative, right) / (depth * tangent) + 1) * width / 2, y: (1 - dot(relative, up) * (width / height) / (depth * tangent) - NATIVE_RISE) * height / 2 };
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
      const glowBox = sceneBounds(scene, (path) => path === "Cube.mdl" ? glow : undefined, width, height)[0]?.box;
      if (glowBox === undefined) throw new Error("no glow box in front of the eye");
      for (const box of [row.box, arm.box, glowBox]) for (const edge of ["left", "top", "right", "bottom"] as const) expect(Math.abs(box[edge] - expected[edge])).toBeLessThanOrEqual(0.01);
      expect(sceneBounds(scene, (path) => path === "Cube.mdl" ? glow : undefined, width, height)[0]?.teamGlow).toBe("disc");
      const atAngle = (local: Vector3) => project(world(add(rotate(sub(local, PIVOT), AXIS, angle), PIVOT)));
      // The body leaves the glow out whatever its texture: none (the disc rule), the radial falloff, or a full-bright one that draws the whole quad.
      for (const glowTextures of width === 800 ? [undefined, textures, brightTextures] : [undefined]) {
        const glowRow = sceneBounds(scene, (path) => path === "Cube.mdl" ? glow : undefined, width, height, glowTextures)[0];
        if (glowRow?.body === undefined || glowRow.box === undefined) throw new Error("no body box in front of the eye");
        for (const edge of ["left", "top", "right", "bottom"] as const) expect(Math.abs(glowRow.body[edge] - expected[edge])).toBeLessThanOrEqual(0.01);
        if (glowTextures !== brightTextures) continue;
        const glowPoints = glowCorners.map(atAngle);
        if (!glowPoints.every((p) => p.depth >= fields.CAMERA_FIELD_NEARZ && p.depth <= fields.CAMERA_FIELD_FARZ && p.x >= 0 && p.y >= 0 && p.x <= width && p.y <= height)) continue;
        const quadBox = centreBox(hull(glowPoints.map((p) => [p.x, p.y])));
        if (quadBox === undefined) continue;
        const whole = { left: Math.min(expected.left, quadBox.left), top: Math.min(expected.top, quadBox.top), right: Math.max(expected.right, quadBox.right), bottom: Math.max(expected.bottom, quadBox.bottom) };
        for (const edge of ["left", "top", "right", "bottom"] as const) expect(Math.abs(glowRow.box[edge] - whole[edge])).toBeLessThanOrEqual(1);
        expect(glowRow.teamGlow).toBe("texture");
        brightGlow++;
      }
      // The body leaves out a see-through geoset too: an opaque-texelled Transparent veil, read or not, while the whole box counts it.
      if (width === 800) for (const veilTextures of [undefined, { image: (path: string) => path === "Veil.blp" ? brightTexels : undefined, teamGlow: () => undefined }]) {
        const veilRow = sceneBounds(scene, (path) => path === "Cube.mdl" ? veiled : undefined, width, height, veilTextures)[0];
        if (veilRow?.body === undefined || veilRow.box === undefined) throw new Error("no veiled body box in front of the eye");
        for (const edge of ["left", "top", "right", "bottom"] as const) expect(Math.abs(veilRow.body[edge] - expected[edge])).toBeLessThanOrEqual(0.01);
        const veilPoints = glowCorners.map(atAngle);
        if (!veilPoints.every((p) => p.depth >= fields.CAMERA_FIELD_NEARZ && p.depth <= fields.CAMERA_FIELD_FARZ && p.x >= 0 && p.y >= 0 && p.x <= width && p.y <= height)) continue;
        // Unread, the veil counts its whole surface by its corners; read, the pixels whose centres its opaque texels cover.
        const veilBox = veilTextures === undefined ? { left: Math.min(...veilPoints.map((p) => p.x)), top: Math.min(...veilPoints.map((p) => p.y)), right: Math.max(...veilPoints.map((p) => p.x)), bottom: Math.max(...veilPoints.map((p) => p.y)) }
          : centreBox(hull(veilPoints.map((p) => [p.x, p.y])));
        if (veilBox === undefined) continue;
        const whole = { left: Math.min(expected.left, veilBox.left), top: Math.min(expected.top, veilBox.top), right: Math.max(expected.right, veilBox.right), bottom: Math.max(expected.bottom, veilBox.bottom) };
        for (const edge of ["left", "top", "right", "bottom"] as const) expect(Math.abs(veilRow.box[edge] - whole[edge])).toBeLessThanOrEqual(veilTextures === undefined ? 0.01 : 1);
        if (veilTextures !== undefined && (["left", "top", "right", "bottom"] as const).some((edge) => Math.abs(whole[edge] - expected[edge]) > 2)) veils++;
      }
      if (width === 800) for (const [quad, region] of [[keyed, keyedRegion], [twoSided, keyedRegion], [glowing, glowRegion]] as const) {
        const quadCorners = [quadPoint(0, 0), quadPoint(1, 0), quadPoint(0, 1), quadPoint(1, 1)].map(atAngle);
        if (!quadCorners.every((p) => p.depth >= fields.CAMERA_FIELD_NEARZ && p.depth <= fields.CAMERA_FIELD_FARZ)) continue;
        // A one-sided layer draws only the face that turns counter-clockwise on screen with y up: its triangles' 0, 1, 3 order, seen from +z.
        const [a, b, , d] = quadCorners as [ReturnType<typeof project>, ReturnType<typeof project>, unknown, ReturnType<typeof project>];
        const back = (b.x - a.x) * (d.y - a.y) - (b.y - a.y) * (d.x - a.x) > 0;
        if (back && quad !== twoSided) {
          expect(sceneBounds(scene, (path) => path === "Cube.mdl" ? quad : undefined, width, height, textures)[0]?.box).toBeUndefined();
          backFaces++;
          continue;
        }
        const drawn = region.map(([u, v]) => atAngle(quadPoint(u, v)));
        if (drawn.some((p) => p.x < 0 || p.y < 0 || p.x > width || p.y > height)) continue;
        const want = centreBox(hull(drawn.map((p) => [p.x, p.y])));
        if (want === undefined || want.right - want.left < 3 || want.bottom - want.top < 3) continue;
        const quadRow = sceneBounds(scene, (path) => path === "Cube.mdl" ? quad : undefined, width, height, textures)[0];
        if (quadRow?.box === undefined) throw new Error("no textured box");
        for (const edge of ["left", "top", "right", "bottom"] as const) expect(Math.abs(quadRow.box[edge] - want[edge])).toBeLessThanOrEqual(1);
        if (quad === glowing) expect(quadRow.teamGlow).toBe("texture");
        textured++;
      }
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
  expect(textured).toBeGreaterThan(400);
  expect(brightGlow).toBeGreaterThan(200);
  expect(veils).toBeGreaterThan(100);
  expect(backFaces).toBeGreaterThan(50);
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
/** Pixel edges of the pixels whose centres a convex polygon holds; undefined when it holds none. */
function centreBox(polygon: readonly Point[]): PixelBox | undefined {
  let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity;
  const ys = polygon.map((p) => p[1]);
  for (let row = Math.floor(Math.min(...ys)); row <= Math.ceil(Math.max(...ys)); row++) {
    const y = row + 0.5;
    let low = Infinity, high = -Infinity;
    polygon.forEach((p, i) => {
      const q = polygon[(i + 1) % polygon.length] as Point;
      if ((p[1] - y) * (q[1] - y) > 0 || p[1] === q[1]) return;
      const x = p[0] + (q[0] - p[0]) * (y - p[1]) / (q[1] - p[1]);
      low = Math.min(low, x); high = Math.max(high, x);
    });
    const first = Math.ceil(low - 0.5), last = Math.floor(high - 0.5);
    if (first > last) continue;
    left = Math.min(left, first); right = Math.max(right, last + 1); top = Math.min(top, row); bottom = Math.max(bottom, row + 1);
  }
  return left <= right ? { left, top, right, bottom } : undefined;
}
const area = (polygon: readonly Point[]) => Math.abs(polygon.reduce((sum, p, i) => { const q = polygon[(i + 1) % polygon.length] as Point; return sum + p[0] * q[1] - q[0] * p[1]; }, 0)) / 2;
const perimeter = (polygon: readonly Point[]) => polygon.reduce((sum, p, i) => { const q = polygon[(i + 1) % polygon.length] as Point; return sum + Math.hypot(q[0] - p[0], q[1] - p[1]); }, 0);

// Head.mdl skins the head cube to an unnamed child of Head and carries unweighted Weapon/Hand bones; the weapon cube is skinned to Weapon under Hand.
test("[property] the in-frame raster covers a cube's projected polygon, labels it with its nearest named node, shows it only through texels at least half opaque, and hides the overlap of a cube in front", () => {
  const headModel = cubeModel("HeadMesh", "Head").replace("NumBones 2", "NumBones 4")
    .replace("PivotPoints 2", 'Bone "Weapon" { ObjectId 2, GeosetId None, GeosetAnimId None, }\nBone "Hand" { ObjectId 3, GeosetId None, GeosetAnimId None, }\nPivotPoints 4')
    .replace("{ 0, 0, 0 }, }", "{ 0, 0, 0 }, { 0, 0, 0 }, { 0, 0, 0 }, }");
  const models = new Map([["Head.mdl", boundsModel(parseMDL(headModel))], ["Weapon.mdl", boundsModel(parseMDL(cubeModel("Weapon", "Hand")))]]), next = random(126);
  const between = (low: number, high: number) => low + (high - low) * next(), whole = (low: number, high: number) => Math.floor(between(low, high + 1));
  let covered = 0, cropped = 0, overlapped = 0, apart = 0, edges = 0, missed = 0;
  for (let round = 0; round < 120; round++) {
    const fields = { CAMERA_FIELD_ROTATION: between(0, 360), CAMERA_FIELD_ANGLE_OF_ATTACK: between(280, 360), CAMERA_FIELD_TARGET_DISTANCE: between(500, 1500), CAMERA_FIELD_ZOFFSET: between(-100, 300),
      CAMERA_FIELD_FIELD_OF_VIEW: between(40, 100), CAMERA_FIELD_NEARZ: between(10, 100), CAMERA_FIELD_FARZ: 10000 };
    const target: Vector3 = [between(-2000, 2000), between(-2000, 2000), fields.CAMERA_FIELD_ZOFFSET];
    const width = whole(160, 480), height = whole(160, 480);
    const yaw = fields.CAMERA_FIELD_ROTATION * Math.PI / 180, pitch = fields.CAMERA_FIELD_ANGLE_OF_ATTACK * Math.PI / 180;
    const forward: Vector3 = [Math.cos(yaw) * Math.cos(pitch), Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch)];
    const eye = sub(target, scaled(forward, fields.CAMERA_FIELD_TARGET_DISTANCE)), right = unit(cross(forward, [0, 0, 1])), up = cross(right, forward);
    const tangent = Math.tan(fields.CAMERA_FIELD_FIELD_OF_VIEW * Math.PI / 360) * NATIVE_SPREAD;
    const project = (point: Vector3) => {
      const relative = sub(point, eye), depth = dot(relative, forward);
      return { depth, x: (dot(relative, right) / (depth * tangent) + 1) * width / 2, y: (1 - dot(relative, up) * (width / height) / (depth * tangent) - NATIVE_RISE) * height / 2 };
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
    const portrait = (effects: DrawnPose[], parts: Record<string, string[]> = { head: ["Head"], weapon: ["Weapon"], hand: ["Hand"] }) => inFrame({ scene: { camera: { x: target[0], y: target[1], fields }, effects } as unknown as RenderScene, width, height, crop, texture: { width: crop.width, height: crop.height },
      parts }, (path) => models.get(path), frame);
    // The pixels whose centres the analytic polygon holds, shifted from the crop into the frame.
    const centresBox = (polygon: readonly Point[]) => {
      const box = { left: Infinity, top: Infinity, right: -Infinity, bottom: -Infinity };
      for (let y = crop.y; y < crop.y + crop.height; y++) for (let x = crop.x; x < crop.x + crop.width; x++) {
        if (!polygon.every((a, i) => turnOf([x + 0.5, y + 0.5], a, polygon[(i + 1) % polygon.length] as Point) >= 0)) continue;
        box.left = Math.min(box.left, x - crop.x + frame.x); box.right = Math.max(box.right, x + 1 - crop.x + frame.x);
        box.top = Math.min(box.top, y - crop.y + frame.y); box.bottom = Math.max(box.bottom, y + 1 - crop.y + frame.y);
      }
      return box;
    };

    const alone = portrait([back]), head = alone.parts.head;
    if (head === undefined) throw new Error("no head row");
    // Texels from row `cut` down under half opacity show as the crop ending at `cut`; the rows above are at least half opaque.
    const cut = whole(1, crop.height - 1), alpha = Uint8Array.from({ length: crop.width * crop.height }, (_, texel) => texel < cut * crop.width ? whole(128, 255) : whole(0, 127));
    const faded = inFrame({ scene: { camera: { x: target[0], y: target[1], fields }, effects: [back] } as unknown as RenderScene, width, height, crop, texture: { width: crop.width, height: crop.height, alpha },
      parts: { head: ["Head"], weapon: ["Weapon"], hand: ["Hand"] } }, (path) => models.get(path), frame);
    const shortened = inFrame({ scene: { camera: { x: target[0], y: target[1], fields }, effects: [back] } as unknown as RenderScene, width, height, crop: { ...crop, height: cut }, texture: { width: crop.width, height: cut },
      parts: { head: ["Head"], weapon: ["Weapon"], hand: ["Hand"] } }, (path) => models.get(path), { ...frame, height: cut });
    expect(faded).toEqual(shortened);
    expect(Math.abs(head.pixels - area(backPolygon))).toBeLessThanOrEqual(perimeter(backPolygon) + 1);
    expect(alone.headHiddenByWeapon).toBe(0);
    if (backPolygon.length > 0 && area(backPolygon) > 16) {
      if (head.box === undefined) throw new Error("no head box");
      const expected = centresBox(backPolygon);
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
    expect(both.parts.hand?.pixels).toBe(0);
    expect(both.handGap).toBeUndefined();
    // The back cube declared as the hand: its visible box touches the weapon's when they overlap, and is its analytic box when apart.
    const held = portrait([front, back], { head: ["Head"], weapon: ["Weapon"], hand: ["Head"] }).handGap;
    if (area(overlap) > 4) expect(held).toBe((both.parts.head?.pixels ?? 0) === 0 ? undefined : 0);
    else if (area(overlap) === 0 && area(backPolygon) > 16 && area(frontPolygon) > 16) {
      const a = centresBox(backPolygon), b = centresBox(frontPolygon);
      const gap = Math.hypot(Math.max(0, a.left - b.right, b.left - a.right), Math.max(0, a.top - b.bottom, b.top - a.bottom));
      expect(Math.abs((held ?? -10) - gap)).toBeLessThanOrEqual(Math.SQRT2);
      if (gap > 2) apart++;
    }
    if (area(overlap) > 4) overlapped++;
  }
  expect(missed).toBeLessThanOrEqual(edges * 0.02);
  expect(covered).toBeGreaterThan(60);
  expect(cropped).toBeGreaterThan(5);
  expect(overlapped).toBeGreaterThan(10);
  expect(apart).toBeGreaterThan(5);
});

test("[property] the native silhouette's box is the drawn blob's near Wisp's box, under sub-threshold noise and a distractor", () => {
  const next = random(127), whole = (low: number, high: number) => Math.floor(low + (high - low + 1) * next());
  let rounds = 0, atBorder = 0;
  for (let round = 0; round < 150; round++) {
    const width = whole(100, 180), height = whole(100, 180), size = width * height;
    const hidden = new Uint8Array(size * 3).map(() => whole(0, 255));
    // The shown capture differs from the hidden one by at most 24 per channel everywhere, often by exactly 24.
    const shown = hidden.map((value) => Math.max(0, Math.min(255, value + (next() < 0.3 ? (next() < 0.5 ? -24 : 24) : whole(-24, 24)))));
    const paint = (blob: Uint8Array) => {
      for (let i = 0; i < size; i++) {
        if (blob[i] !== 1) continue;
        const c = whole(0, 2), value = hidden[i * 3 + c] ?? 0;
        shown[i * 3 + c] = value >= 128 ? value - whole(25, value) : value + whole(25, 255 - value);
      }
    };
    // A connected blob: each rectangle or ellipse is centred on a pixel already drawn.
    const draw = (cx: number, cy: number, span: number) => {
      const blob = new Uint8Array(size), drawn: number[] = [cy * width + cx], box = { left: Infinity, top: Infinity, right: -Infinity, bottom: -Infinity };
      for (let shape = whole(1, 5); shape > 0; shape--) {
        const at = drawn[whole(0, drawn.length - 1)] ?? 0, x0 = at % width, y0 = Math.floor(at / width), rx = whole(0, span), ry = whole(0, span), ellipse = next() < 0.5;
        for (let y = Math.max(0, y0 - ry); y <= Math.min(height - 1, y0 + ry); y++) for (let x = Math.max(0, x0 - rx); x <= Math.min(width - 1, x0 + rx); x++) {
          if (ellipse && ((x - x0) / (rx + 0.5)) ** 2 + ((y - y0) / (ry + 0.5)) ** 2 > 1) continue;
          if (blob[y * width + x] === 1) continue;
          blob[y * width + x] = 1; drawn.push(y * width + x);
          box.left = Math.min(box.left, x); box.top = Math.min(box.top, y); box.right = Math.max(box.right, x + 1); box.bottom = Math.max(box.bottom, y + 1);
        }
      }
      return { blob, box };
    };
    const { blob, box } = draw(whole(0, width - 1), whole(0, height - 1), 15);
    paint(blob);
    // Wisp's box is off the blob's by up to 10 px an edge; `near` grows it by 20.
    const near = { left: box.left + whole(-10, 10) - 20, top: box.top + whole(-10, 10) - 20, right: box.right + whole(-10, 10) + 20, bottom: box.bottom + whole(-10, 10) + 20 };
    const alone = silhouetteBounds({ width, height, rgb: shown }, { width, height, rgb: hidden }, near);
    expect(alone).toEqual(box);
    if (alone?.left === 0 || alone?.top === 0 || alone?.right === width || alone?.bottom === height) atBorder++;

    // A distractor wholly outside `near`.
    const corners = [[0, 0], [width - 1, 0], [0, height - 1], [width - 1, height - 1]].filter(([x = 0, y = 0]) => x + 12 < near.left || x - 12 >= near.right || y + 12 < near.top || y - 12 >= near.bottom);
    const corner = corners[whole(0, corners.length - 1)];
    if (corner === undefined) continue;
    const distractor = draw(corner[0] ?? 0, corner[1] ?? 0, 6);
    const outside = distractor.box.right <= near.left || distractor.box.left >= near.right || distractor.box.bottom <= near.top || distractor.box.top >= near.bottom;
    if (!outside) continue;
    paint(distractor.blob);
    expect(silhouetteBounds({ width, height, rgb: shown }, { width, height, rgb: hidden }, near)).toEqual(box);

    const wisp = { left: box.left + whole(-6, 6), top: box.top + whole(-6, 6), right: box.right + whole(-6, 6), bottom: box.bottom + whole(-6, 6) };
    const edges = { left: box.left - wisp.left, top: box.top - wisp.top, right: box.right - wisp.right, bottom: box.bottom - wisp.bottom };
    expect(compareEdges(wisp, box)).toEqual({ ...edges, within: Object.values(edges).every((edge) => Math.abs(edge) <= 4) });
    rounds++;
  }
  expect(rounds).toBeGreaterThan(120);
  expect(atBorder).toBeGreaterThan(0);
});
