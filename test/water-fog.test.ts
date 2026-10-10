import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
import { freshAnimation } from "../src/headless/animation";
import { renderScenes, sceneWithUnits, type DrawnPose, type RenderScene } from "../scripts/wisp/headlessRender";
import { farmTest } from "../scripts/wisp/farmTest";
import { decodeTerrain } from "../scripts/wisp/terrain";
import { terrainRows } from "../scripts/wisp/terrainMesh";
import { waterColor, waterMesh, waterTable, waterTexture } from "../scripts/wisp/water";
import { decodePng } from "./animation58/read";

function terrainBytes(water: boolean): Uint8Array {
  const bytes = new Uint8Array(41 + 4 * 7), view = new DataView(bytes.buffer);
  bytes.set(new TextEncoder().encode("W3E!")); view.setInt32(4, 11, true); bytes[8] = 76;
  view.setInt32(13, 1, true); bytes.set(new TextEncoder().encode("TEST"), 17);
  view.setInt32(21, 0, true); view.setInt32(25, 2, true); view.setInt32(29, 2, true);
  view.setFloat32(33, 0, true); view.setFloat32(37, 0, true);
  for (let index = 0; index < 4; index++) {
    view.setInt16(41 + index * 7, 0x2000, true); view.setUint16(43 + index * 7, 0x2000, true);
    bytes[45 + index * 7] = water ? 0x40 : 0; bytes[47 + index * 7] = 0x02;
  }
  return bytes;
}

const WATER_SLK = new TextEncoder().encode([
  "ID;PWXL;N;E",
  ...["waterID", "height", "texFile", "numTex", "texRate", "cells", "Smin_A", "Smin_R", "Smin_G", "Smin_B", "Smax_A", "Smax_R", "Smax_G", "Smax_B", "Dmin_A", "Dmin_R", "Dmin_G", "Dmin_B", "Dmax_A", "Dmax_R", "Dmax_G", "Dmax_B"]
    .map((name, index) => `C;X${index + 1};${index === 0 ? "Y1;" : ""}K"${name}"`),
  ...["\"LSha\"", "0.25", "\"Water\\Frame\"", "2", "15", "1", "0", "0", "0", "0", "255", "0", "0", "255", "255", "0", "0", "255", "255", "0", "0", "255"]
    .map((value, index) => `C;X${index + 1};${index === 0 ? "Y2;" : ""}K${value}`),
  "E",
].join("\n"));
const TERRAIN_SLK = new TextEncoder().encode('ID;PWXL;N;E\nC;X1;Y1;K"tileID"\nC;X2;K"dir"\nC;X3;K"file"\nC;X1;Y2;K"TEST"\nC;X2;K"authored"\nC;X3;K"red"\nE');
const tga = (red: number, green: number, blue: number) => {
  const bytes = new Uint8Array(18 + 4 * 4 * 4); bytes[2] = 2; bytes[12] = bytes[14] = 4; bytes[16] = 32;
  for (let at = 18; at < bytes.length; at += 4) bytes.set([blue, green, red, 255], at);
  return bytes;
};
const readAsset = async (path: string) => path === "TerrainArt\\Water.slk" ? WATER_SLK : path === "TerrainArt\\Terrain.slk" ? TERRAIN_SLK
  : path === "Water\\Frame00.blp" ? tga(255, 255, 255) : path === "Water\\Frame01.blp" ? tga(0, 0, 0) : path.includes("red") ? tga(255, 0, 0) : undefined;
const centre = async (directory: string, image: string) => {
  const pixels = decodePng(new Uint8Array(await Bun.file(join(directory, image)).arrayBuffer()));
  return Array.from(pixels.rgb.slice((32 * 64 + 32) * 3, (32 * 64 + 32) * 3 + 3));
};
/** Within one level per channel: the GPU rounds a blend's half levels either way. */
const near = (actual: readonly number[], want: readonly number[]) => expect(actual.every((value, index) => Math.abs(value - (want[index] ?? 0)) <= 1) ? want : actual).toEqual(want);

test("[wisp#79] terrain water takes the tileset's Water.slk colours by depth over ground and steps its texture frames at texRate", () => {
  const table = waterTable(terrainRows(WATER_SLK), "L");
  expect(table).toMatchObject({ offset: 32, texture: "Water\\Frame", frames: 2, rate: 15, cells: 1 });
  expect(waterColor(table, -1)[3]).toBe(0);
  expect(waterColor(table, 32)).toEqual([0, 0, 127.5, 127.5]);
  expect(waterColor(table, 64)).toEqual([0, 0, 255, 255]);

  expect([0, 3, 4, 7, 8].map((frame) => waterTexture(table, frame))).toEqual(["Water\\Frame00.blp", "Water\\Frame00.blp", "Water\\Frame01.blp", "Water\\Frame01.blp", "Water\\Frame00.blp"]);
  const mesh = waterMesh(decodeTerrain(terrainBytes(true)), table);
  expect(mesh.length).toBe(6 * 9);
  expect(Array.from(mesh.slice(0, 9))).toEqual([0, 0, 32, 0, 0, 0, 0, 0.5, 0.5]);
  expect(waterMesh(decodeTerrain(terrainBytes(false)), table).length).toBe(0);
});

const view = { x: 64, y: 64, fields: { CAMERA_FIELD_ROTATION: 90, CAMERA_FIELD_ANGLE_OF_ATTACK: 270, CAMERA_FIELD_TARGET_DISTANCE: 180 } };
const environment = { sky: "", skyVisible: false, terrainVisible: true, dayNight: { terrain: "", unit: "" }, timeOfDay: 12 };

farmTest("[wisp#79] water draws over its ground in its depth colour, animates by match frame, draws the same pixels for the same frame and hides with the terrain", async () => {
  const directory = await mkdtemp(join(tmpdir(), "wisp-water-"));
  try {
    for (const graphics of ["classic", "definitive"] as const) {
      const project = { readAsset, width: 64, height: 64, terrain: { w3e: terrainBytes(true), origin: [0, 0] as const } };
      const base: RenderScene = { frame: 0, client: 0, effects: [], units: [], ui: [], camera: view, environment };
      const scenes = [sceneWithUnits(project, base), sceneWithUnits(project, { ...base, client: 1 }), sceneWithUnits(project, { ...base, frame: 4 }), { ...base, frame: 5, environment: { ...environment, terrainVisible: false } }];
      const out = join(directory, graphics);
      const images = await Effect.runPromise(renderScenes(project, scenes, out, graphics, ["water"]));
      expect(images.map((image) => image.notDrawn)).toEqual([[], [], [], []]);
      expect(images.map((image) => image.water)).toEqual([true, true, true, false]);

      near(await centre(out, "p0-frame-0.png"), [128, 0, 64]);
      expect(await centre(out, "p1-frame-0.png")).toEqual(await centre(out, "p0-frame-0.png"));
      near(await centre(out, "p0-frame-4.png"), [128, 0, 0]);

      expect(await centre(out, "p0-frame-5.png")).toEqual([10, 15, 23]);
    }
  } finally { await rm(directory, { recursive: true, force: true }); }
}, 120_000);

const SQUARE = new TextEncoder().encode(`Version { FormatVersion 800, }
Model "Square" { BlendTime 0, MinimumExtent { -40, -40, 0 }, MaximumExtent { 40, 40, 0 }, BoundsRadius 60, }
Sequences 1 { Anim "Stand" { Interval { 0, 1000 }, } }
Textures 1 { Bitmap { Image "white.tga", } }
Materials 1 { Material { Layer { FilterMode None, TwoSided, Unshaded, static TextureID 0, } } }
Geoset {
  Vertices 4 { { -40, -40, 0 }, { 40, -40, 0 }, { 40, 40, 0 }, { -40, 40, 0 }, }
  Normals 4 { { 0, 0, 1 }, { 0, 0, 1 }, { 0, 0, 1 }, { 0, 0, 1 }, }
  TVertices 4 { { 0, 0 }, { 1, 0 }, { 1, 1 }, { 0, 1 }, }
  VertexGroup { 0, 0, 0, 0, }
  Faces 1 6 { Triangles { { 0, 1, 2, 0, 2, 3 }, } }
  Groups 1 1 { Matrices { 0 }, }
  MaterialID 0, SelectionGroup 0,
}
Bone "Root" { ObjectId 0, GeosetId 0, GeosetAnimId None, }
PivotPoints 1 { { 0, 0, 0 }, }`);

farmTest("[wisp#79] Definitive's height fog fades in below its top and over its depth range; Classic draws only the linear range", async () => {
  const white = tga(255, 255, 255);
  const square: DrawnPose = { ...freshAnimation(), handle: { kind: "effect", id: 1 }, model: "square.mdl", created: 0, x: 0, y: 0, z: 0, alpha: 255, scale: 1, timeScale: 1, queuedAnimations: [], yaw: 0, pitch: 0, roll: 0, color: [255, 255, 255], teamColor: 0, matrixScale: [1, 1, 1], flat: false };

  const fog = { style: 3, zStart: 0, zEnd: 200, density: 0.25, color: [0, 0, 1] as [number, number, number], heightStart: -100, heightEnd: 100, linearStart: 1000, linearEnd: 2000, maxLinearDensity: 1 };
  const base: RenderScene = { frame: 0, client: 0, effects: [square], units: [], ui: [], camera: { x: 0, y: 0, fields: { CAMERA_FIELD_ROTATION: 90, CAMERA_FIELD_ANGLE_OF_ATTACK: 270, CAMERA_FIELD_TARGET_DISTANCE: 100 } },
    environment: { ...environment, terrainVisible: false, fog } };
  const above = { ...base, frame: 1, environment: { ...base.environment, fog: { ...fog, heightStart: -300, heightEnd: -200 } } };
  const directory = await mkdtemp(join(tmpdir(), "wisp-height-fog-"));
  try {
    const want = { classic: [255, 255, 255], definitive: [191, 191, 255] };
    for (const graphics of ["classic", "definitive"] as const) {
      const out = join(directory, graphics);
      const images = await Effect.runPromise(renderScenes({ readAsset: async (path: string) => path === "white.tga" ? white : SQUARE, width: 64, height: 64 }, [base, above], out, graphics, graphics === "definitive" ? ["height-fog-falloff"] : []));
      expect(images.map((image) => image.heightFog)).toEqual(graphics === "definitive" ? [true, true] : [false, false]);
      near(await centre(out, "p0-frame-0.png"), want[graphics]);
      expect(await centre(out, "p0-frame-1.png")).toEqual([255, 255, 255]);
    }
  } finally { await rm(directory, { recursive: true, force: true }); }
}, 120_000);
