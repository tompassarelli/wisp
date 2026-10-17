import { expect } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
import { freshAnimation } from "../src/headless/animation";
import { renderScenes, type DrawnPose, type RenderScene } from "../host/render/headlessRender";
import { farmTest } from "../host/farm/farmTest";
import { generateMDX, parseMDL } from "../vendor/war3-model.mjs";

const plate = parseMDL(`Version { FormatVersion 800, }
Model "Plate" { BlendTime 0, MinimumExtent { -40, -40, 0 }, MaximumExtent { 40, 40, 0 }, BoundsRadius 60, }
Sequences 1 { Anim "Stand" { Interval { 0, 1000 }, MinimumExtent { -40, -40, 0 }, MaximumExtent { 40, 40, 0 }, BoundsRadius 60, } }
Textures 4 { Bitmap { Image "white.tga", } Bitmap { Image "white.tga", } Bitmap { Image "white.tga", } Bitmap { Image "white.tga", } }
Materials 2 { Material { Layer { FilterMode None, TwoSided, static TextureID 0, } } Material { Layer { FilterMode None, TwoSided, static TextureID 0, } } }
Geoset {
  Vertices 4 { { -40, -40, 0 }, { 40, -40, 0 }, { 40, 40, 0 }, { -40, 40, 0 }, }
  Normals 4 { { 0, 0, 1 }, { 0, 0, 1 }, { 0, 0, 1 }, { 0, 0, 1 }, }
  TVertices 4 { { 0, 0 }, { 1, 0 }, { 1, 1 }, { 0, 1 }, }
  VertexGroup { 0, 0, 0, 0, }
  Faces 1 6 { Triangles { { 0, 1, 2, 0, 2, 3 }, } }
  MinimumExtent { -40, -40, 0 }, MaximumExtent { 40, 40, 0 }, BoundsRadius 60,
  Groups 1 1 { Matrices { 0 }, } MaterialID 1, SelectionGroup 0,
}
Bone "Root" { ObjectId 0, GeosetId 0, GeosetAnimId None, }
PivotPoints 1 { { 0, 0, 0 }, }`);
plate.Version = 1100;
const [geoset] = plate.Geosets;
Object.assign(geoset!, { LevelOfDetail: 0, Tangents: new Float32Array([1, 0, 0, 1, 1, 0, 0, 1, 1, 0, 0, 1, 1, 0, 0, 1]), SkinWeights: new Uint8Array([0, 0, 0, 0, 255, 0, 0, 0, 0, 0, 0, 0, 255, 0, 0, 0, 0, 0, 0, 0, 255, 0, 0, 0, 0, 0, 0, 0, 255, 0, 0, 0]) });
const [flagged, drawn] = plate.Materials;
const [flaggedLayer] = flagged!.Layers, [drawnLayer] = drawn!.Layers;
Object.assign(flaggedLayer!, { ShaderTypeId: 1, NormalTextureID: 1, ORMTextureID: 2, ReflectionsTextureID: 3 });
Object.assign(drawnLayer!, { ShaderTypeId: 24, NormalTextureID: 1, ORMTextureID: 2, ReflectionsTextureID: 3 });
const hdPlate = new Uint8Array(generateMDX(plate));
const white = new Uint8Array([0, 0, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 1, 0, 24, 32, 255, 255, 255]);

farmTest("[spec HD layer slots] a Definitive material whose base layer is not shader type 1 draws its own normal and ORM textures", async () => {
  const pose: DrawnPose = { ...freshAnimation(), handle: { kind: "unit", id: 1 }, model: "plate.mdx", created: 0, x: 0, y: 0, z: 0, alpha: 255, scale: 1, timeScale: 1, queuedAnimations: [], yaw: 0, pitch: 0, roll: 0, color: [255, 255, 255], teamColor: 0, matrixScale: [1, 1, 1], flat: false, unit: true };
  const scene: RenderScene = { frame: 0, client: 0, effects: [pose], units: [], ui: [], camera: { x: 0, y: 0, fields: { CAMERA_FIELD_ROTATION: 90, CAMERA_FIELD_ANGLE_OF_ATTACK: 270, CAMERA_FIELD_TARGET_DISTANCE: 100 } }, environment: { sky: "", skyVisible: false, terrainVisible: false, dayNight: { terrain: "", unit: "" }, timeOfDay: 12 } };
  const assets = new Map([["plate.mdx", hdPlate], ["white.tga", white]]);
  const directory = await mkdtemp(join(tmpdir(), "wisp-hd-materials-"));
  try {
    const [image] = await Effect.runPromise(renderScenes({ readAsset: async path => assets.get(path), width: 64, height: 64 }, [scene], directory, "definitive"));
    expect(image!.notDrawn).toEqual([]);
    expect(image!.models).toBe(1);
  } finally { await rm(directory, { recursive: true, force: true }); }
}, 120_000);
