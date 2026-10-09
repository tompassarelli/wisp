import { expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
import { decodeDoodads } from "../scripts/wisp/doodads";
import { renderScenes, sceneWithUnits, type RenderScene } from "../scripts/wisp/headlessRender";
import { farmTest } from "../scripts/wisp/farmTest";

// Fixture placements use WC3MapSpecification/Doodads/8_11.md.
function placements(skinIds = true, visible = true): Uint8Array {
  const bytes: number[] = [];
  const id = (value: string) => bytes.push(...[...value].map((c) => c.charCodeAt(0)));
  const number = (value: number, float = false) => { const b = new Uint8Array(4), v = new DataView(b.buffer); if (float) v.setFloat32(0, value, true); else v.setInt32(0, value, true); bytes.push(...b); };
  id("W3do"); number(8); number(11); number(2);
  for (let index = 0; index < 2; index++) {
    id("TEST"); number(index);
    for (const value of [100 + index * 5000, 200, 30, Math.PI / 2, 2, 3, 4]) number(value, true);
    if (skinIds) id("SKIN");
    bytes.push(visible ? 6 : 4, 100);
    number(-1); number(index === 0 ? 1 : 0);
    if (index === 0) { number(1); id("ITEM"); number(100); }
    number(index);
  }
  number(0); number(0);
  return new Uint8Array(bytes);
}

const scene: RenderScene = { frame: 60, client: 0, effects: [], units: [], ui: [],
  camera: { x: 0, y: 0, fields: { CAMERA_FIELD_ROTATION: 90, CAMERA_FIELD_ANGLE_OF_ATTACK: 270, CAMERA_FIELD_TARGET_DISTANCE: 300 } },
  environment: { sky: "", skyVisible: false, terrainVisible: false, dayNight: { terrain: "", unit: "" }, timeOfDay: 12 } };

test("[reference] doodad 8/11 skin and legacy records retain placements after item sets and join the scene at the map origin with their skin variations", () => {
  for (const skinIds of [true, false]) {
    const rows = decodeDoodads(placements(skinIds), skinIds);
    expect(rows.map((row) => [row.type, row.skin, row.variation, row.x, row.y, row.z, row.scale, row.visible])).toEqual([
      ["TEST", skinIds ? "SKIN" : "TEST", 0, 100, 200, 30, [2, 3, 4], true],
      ["TEST", skinIds ? "SKIN" : "TEST", 1, 5100, 200, 30, [2, 3, 4], true],
    ]);
    expect(rows[0]?.angle).toBeCloseTo(Math.PI / 2, 6);
  }
  {
    const project = { readAsset: async () => undefined, terrain: { origin: [100, 200] as const }, doodads: { doo: placements(), models: { SKIN: ["first.mdx", "second.mdx"] } } };
    const poses = sceneWithUnits(project, scene).effects;
    expect(poses.map((pose) => [pose.model, pose.x, pose.y, pose.z, pose.matrixScale, pose.animation])).toEqual([
      ["first.mdx", 0, 0, 30, [2, 3, 4], "stand"], ["second.mdx", 5000, 0, 30, [2, 3, 4], "stand"],
    ]);
    expect(sceneWithUnits({ ...project, doodads: { ...project.doodads, doo: placements(true, false) } }, scene).effects).toEqual([]);
  }
});

farmTest("[scenario] placed doodads change actual Classic and Definitive frames and outside-bound models cull", async () => {
  const mdl = new TextEncoder().encode(`Version { FormatVersion 800, }
Model "Placed square" { BlendTime 0, MinimumExtent { -20, -20, 0 }, MaximumExtent { 20, 20, 0 }, BoundsRadius 30, }
Sequences 1 { Anim "Stand" { Interval { 0, 1000 }, } }
Textures 1 { Bitmap { Image "white.tga", } }
Materials 1 { Material { Layer { FilterMode None, TwoSided, Unshaded, static TextureID 0, } } }
Geoset {
  Vertices 4 { { -20, -20, 0 }, { 20, -20, 0 }, { 20, 20, 0 }, { -20, 20, 0 }, }
  Normals 4 { { 0, 0, 1 }, { 0, 0, 1 }, { 0, 0, 1 }, { 0, 0, 1 }, }
  TVertices 4 { { 0, 0 }, { 1, 0 }, { 1, 1 }, { 0, 1 }, }
  VertexGroup { 0, 0, 0, 0, }
  Faces 1 6 { Triangles { { 0, 1, 2, 0, 2, 3 }, } }
  Groups 1 1 { Matrices { 0 }, }
  MaterialID 0, SelectionGroup 0,
}
Bone "Root" { ObjectId 0, GeosetId 0, GeosetAnimId None, }
PivotPoints 1 { { 0, 0, 0 }, }`);
  const white = new Uint8Array(22); white[2] = 2; white[12] = white[14] = 1; white[16] = 32; white.fill(255, 18);
  const directory = await mkdtemp(join(tmpdir(), "wisp-doodads-"));
  try {
    for (const graphics of ["classic", "definitive"] as const) {
      const project = { readAsset: async (path: string) => path === "white.tga" ? white : mdl, width: 64, height: 64,
        terrain: { origin: [100, 200] as const, bounds: { minX: 0, minY: 0, maxX: 400, maxY: 400 } },
        doodads: { doo: placements(), models: { SKIN: ["first.mdx", "second.mdx"] } } };
      const frames = await Effect.runPromise(renderScenes({ readAsset: project.readAsset, width: 64, height: 64 },
        [sceneWithUnits(project, scene), { ...sceneWithUnits({ ...project, doodads: { ...project.doodads, doo: placements(true, false) } }, scene), frame: 61 }], join(directory, graphics), graphics));
      expect(frames[0]?.models).toBe(1); expect(frames[1]?.models).toBe(0);
      expect(await readFile(join(directory, graphics, "p0-frame-60.png"))).not.toEqual(await readFile(join(directory, graphics, "p0-frame-61.png")));
    }
  } finally { await rm(directory, { recursive: true, force: true }); }
}, 120_000);
