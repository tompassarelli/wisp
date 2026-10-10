import { expect } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
import { freshAnimation } from "../src/headless/animation";
import { renderScenes, type DrawnPose, type RenderScene } from "../scripts/wisp/headlessRender";
import { farmTest } from "../scripts/wisp/farmTest";
import { decodePng } from "./animation58/read";

const square = new TextEncoder().encode(`Version { FormatVersion 800, }
Model "HDR" { BlendTime 0, MinimumExtent { -40, -40, 0 }, MaximumExtent { 40, 40, 0 }, BoundsRadius 60, }
Sequences 1 { Anim "Stand" { Interval { 0, 1000 }, } }
Textures 1 { Bitmap { Image "white.tga", } }
Materials 1 { Material { Layer { FilterMode None, TwoSided, static TextureID 0, } } }
Geoset {
  Vertices 4 { { -40, -40, 0 }, { 40, -40, 0 }, { 40, 40, 0 }, { -40, 40, 0 }, }
  Normals 4 { { 0, 0, 1 }, { 0, 0, 1 }, { 0, 0, 1 }, { 0, 0, 1 }, }
  TVertices 4 { { 0, 0 }, { 1, 0 }, { 1, 1 }, { 0, 1 }, }
  VertexGroup { 0, 0, 0, 0, }
  Faces 1 6 { Triangles { { 0, 1, 2, 0, 2, 3 }, } }
  Groups 1 1 { Matrices { 0 }, } MaterialID 0, SelectionGroup 0,
}
Bone "Root" { ObjectId 0, GeosetId 0, GeosetAnimId None, }
PivotPoints 1 { { 0, 0, 0 }, }`);
const white = new Uint8Array([0, 0, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 1, 0, 24, 32, 255, 255, 255]);
const light = (value: number) => new TextEncoder().encode(`Version { FormatVersion 800, }
Model "Light" { BlendTime 0, MinimumExtent { -1, -1, -1 }, MaximumExtent { 1, 1, 1 }, BoundsRadius 1, }
Sequences 1 { Anim "Stand" { Interval { 0, 1000 }, } }
Light "Sun" { ObjectId 0, Directional, static Intensity 0, static Color { 0, 0, 0 }, static AmbIntensity ${value}, static AmbColor { 1, 1, 1 }, }
PivotPoints 1 { { 0, 0, 0 }, }`);

farmTest("[wisp#75 P7.0 contract] linear HDR bloom rejects below-threshold colour, accepts HDR thresholds above one, and tone maps after additive composition", async () => {
  const pose: DrawnPose = { ...freshAnimation(), handle: { kind: "unit", id: 1 }, model: "square.mdl", created: 0, x: 0, y: 0, z: 0, alpha: 255, scale: 1, timeScale: 1, queuedAnimations: [], yaw: 0, pitch: 0, roll: 0, color: [255, 255, 255], teamColor: 0, matrixScale: [1, 1, 1], flat: false, unit: true };
  const base: RenderScene = { frame: 0, client: 0, effects: [pose], units: [], ui: [], camera: { x: 0, y: 0, fields: { CAMERA_FIELD_ROTATION: 90, CAMERA_FIELD_ANGLE_OF_ATTACK: 270, CAMERA_FIELD_TARGET_DISTANCE: 100 } }, environment: { sky: "", skyVisible: false, terrainVisible: false, dayNight: { terrain: "", unit: "low.mdl" }, timeOfDay: 12 } };
  const assets = new Map([["square.mdl", square], ["white.tga", white], ["low.mdl", light(0.5)], ["edge.mdl", light(1)], ["high.mdl", light(2)], ["war3mapPostProcessing.txt", new TextEncoder().encode("[ASSAO]\nEnabled=0\n[Bloom]\nEnabled=1\nBloomThreshold=1.5\nBloomIntensity=1\nBloomSaturation=1\nBaseIntensity=1\nBaseSaturation=1\nBlurAmount=1\nBlurSampleCount=2\n")]]);
  const directory = await mkdtemp(join(tmpdir(), "wisp-colour-pipeline-"));
  try {
    const scenes = ["low.mdl", "edge.mdl", "high.mdl"].map((unit, frame) => ({ ...base, frame, environment: { ...base.environment, dayNight: { terrain: "", unit } } }));
    const images = await Effect.runPromise(renderScenes({ readAsset: async path => assets.get(path), width: 64, height: 64 }, scenes, directory, "definitive", ["bloom"]));
    const expected = [128, 243, 254];
    for (const [index, image] of images.entries()) {
      expect(image.notDrawn).toEqual([]);
      expect(image.post.bloom).toBe(true);
      const pixels = decodePng(new Uint8Array(await Bun.file(join(directory, image.image)).arrayBuffer()));
      const center = Array.from(pixels.rgb.slice((32 * 64 + 32) * 3, (32 * 64 + 32) * 3 + 3));
      for (const channel of center) expect(Math.abs(channel - expected[index]!)).toBeLessThanOrEqual(1);
    }
  } finally { await rm(directory, { recursive: true, force: true }); }
}, 120_000);
