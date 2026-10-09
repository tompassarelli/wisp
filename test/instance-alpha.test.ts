import { expect } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
import { generateMDX, parseMDL } from "../vendor/war3-model.mjs";
import { freshAnimation } from "../src/headless/animation";
import { renderScenes, type DrawnPose, type RenderScene } from "../scripts/wisp/headlessRender";
import { farmTest } from "../scripts/wisp/farmTest";
import { decodePng } from "./animation58/read";

// Authored square and solid textures; no installed game bytes enter this fixture.
const SQUARE = `Version { FormatVersion 800, }
Model "AlphaSquare" { BlendTime 0, MinimumExtent { -40, -40, 0 }, MaximumExtent { 40, 40, 0 }, BoundsRadius 60, }
Sequences 1 { Anim "Stand" { Interval { 0, 1000 }, MinimumExtent { -40, -40, 0 }, MaximumExtent { 40, 40, 0 }, BoundsRadius 60, } }
Textures 3 { Bitmap { Image "white.tga", } Bitmap { Image "normal.tga", } Bitmap { Image "orm.tga", } }
Materials 1 { Material { Layer { FilterMode None, TwoSided, Unshaded, Unfogged, static TextureID 0, static Alpha 1, } } }
Geoset {
 Vertices 4 { { -40, -40, 0 }, { 40, -40, 0 }, { 40, 40, 0 }, { -40, 40, 0 }, }
 Normals 4 { { 0, 0, 1 }, { 0, 0, 1 }, { 0, 0, 1 }, { 0, 0, 1 }, }
 TVertices 4 { { 0, 0 }, { 1, 0 }, { 1, 1 }, { 0, 1 }, }
 VertexGroup { 0, 0, 0, 0, }
 Faces 1 6 { Triangles { { 0, 1, 2, 0, 2, 3 }, } }
 Groups 1 1 { Matrices { 0 }, } MaterialID 0, SelectionGroup 0,
 MinimumExtent { -40, -40, 0 }, MaximumExtent { 40, 40, 0 }, BoundsRadius 60,
}
Bone "Root" { ObjectId 0, GeosetId 0, GeosetAnimId None, }
PivotPoints 1 { { 0, 0, 0 }, }`;

function square(hd: boolean): Uint8Array {
 const data = parseMDL(SQUARE);
 if (hd) {
  data.Version = 1100;
  data.Materials[0]!.Layers[0]!.ShaderTypeId = 1;
  data.Materials[0]!.Layers[0]!.NormalTextureID = 1;
  data.Materials[0]!.Layers[0]!.ORMTextureID = 2;
  for (const geoset of data.Geosets) {
   geoset.LevelOfDetail = 0;
   geoset.SkinWeights = new Uint8Array(32);
   geoset.Tangents = new Float32Array(16);
   for (let vertex = 0; vertex < 4; vertex++) {
    geoset.SkinWeights.set([0, 0, 0, 0, 255, 0, 0, 0], vertex * 8);
    geoset.Tangents.set([1, 0, 0, 1], vertex * 4);
   }
  }
 }
 return new Uint8Array(generateMDX(data));
}
function tga(rgb: readonly number[]): Uint8Array {
 const bytes = new Uint8Array(22); bytes[2] = 2; bytes[12] = bytes[14] = 1; bytes[16] = 32;
 bytes.set([rgb[2] ?? 0, rgb[1] ?? 0, rgb[0] ?? 0, 255], 18); return bytes;
}

farmTest("[repro #84] alpha 140 blends an opaque Classic and Definitive model over the background", async () => {
 const directory = await mkdtemp(join(tmpdir(), "wisp-instance-alpha-"));
 try {
  for (const hd of [false, true]) {
   const bytes = square(hd);
   const project = { width: 64, height: 64, readAsset: async (path: string) => path === "square.mdx" ? bytes : tga(path === "normal.tga" ? [128, 128, 255] : path === "orm.tga" ? [255, 255, 0] : [255, 255, 255]) };
   const pose: DrawnPose = { ...freshAnimation(), handle: { kind: "effect", id: 1 }, model: "square.mdx", created: 0, x: 0, y: 0, z: 0, alpha: 255, scale: 1, timeScale: 1, queuedAnimations: [], yaw: 0, pitch: 0, roll: 0, color: [255, 255, 255], teamColor: 0, matrixScale: [1, 1, 1], flat: false };
   const scene: RenderScene = { frame: 0, client: 0, effects: [], units: [], ui: [], camera: { x: 0, y: 0, fields: { CAMERA_FIELD_ROTATION: 90, CAMERA_FIELD_ANGLE_OF_ATTACK: 270, CAMERA_FIELD_TARGET_DISTANCE: 180 } }, environment: { sky: "", skyVisible: false, terrainVisible: false, dayNight: { terrain: "", unit: "" }, timeOfDay: 12 } };
   const out = join(directory, hd ? "hd" : "sd");
   const images = await Effect.runPromise(renderScenes(project, [scene, { ...scene, frame: 1, effects: [pose] }, { ...scene, frame: 2, effects: [{ ...pose, alpha: 140 }] }], out, hd ? "definitive" : "classic"));
   expect(images.map(image => image.notDrawn)).toEqual([[], [], []]);
   const centers = await Promise.all(images.map(async image => {
    const pixels = decodePng(new Uint8Array(await Bun.file(join(out, image.image)).arrayBuffer()));
    return Array.from(pixels.rgb.slice((32 * 64 + 32) * 3, (32 * 64 + 32) * 3 + 3));
   }));
   const [background, opaque, faded] = centers;
   expect(opaque).not.toEqual(background);
   for (let channel = 0; channel < 3; channel++) {
    const want = Math.round(opaque![channel]! * 140 / 255 + background![channel]! * 115 / 255);
    expect(Math.abs(faded![channel]! - want)).toBeLessThanOrEqual(1);
   }
  }
 } finally { await rm(directory, { recursive: true, force: true }); }
}, 120_000);
