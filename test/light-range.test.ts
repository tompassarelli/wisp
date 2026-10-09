import { expect } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
import { freshAnimation } from "../src/headless/animation";
import { renderScenes, type DrawnPose, type RenderScene } from "../scripts/wisp/headlessRender";
import { farmTest } from "../scripts/wisp/farmTest";
import { decodePng } from "./animation58/read";

const SQUARE = new TextEncoder().encode(`Version { FormatVersion 800, }
Model "Square" { BlendTime 0, MinimumExtent { -40, -40, 0 }, MaximumExtent { 40, 40, 0 }, BoundsRadius 60, }
Sequences 1 { Anim "Stand" { Interval { 0, 1000 }, } }
Textures 1 { Bitmap { Image "grey.tga", } }
Materials 1 { Material { Layer { FilterMode None, TwoSided, static TextureID 0, } } }
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

const LIGHT = new TextEncoder().encode(`Version { FormatVersion 800, }
Model "Light" { BlendTime 150, MinimumExtent { -1, -1, -1 }, MaximumExtent { 1, 1, 1 }, BoundsRadius 1, }
Sequences 1 { Anim "Stand" { Interval { 333, 60333 }, } }
Light "Sun" {
  ObjectId 0,
  Directional,
  static AttenuationStart 80,
  static AttenuationEnd 200,
  static Intensity 2,
  static Color { 0, 0, 0 },
  static AmbIntensity 2,
  static AmbColor { 0.75, 0.75, 0.75 },
}
PivotPoints 1 { { 0, 0, 0 }, }`);

const GREY = new Uint8Array([0, 0, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 1, 0, 24, 32, 100, 100, 100]);

// Native Definitive fighters rose from L* 25.2 under stock light to 54.5 under Naxxramas' ambient 0.7 x intensity 2, Classic only 5.6 -> 16.1 abs dL (wisp:docs/headless.md).
farmTest("[native wisp#79 stage 4] Definitive lights a classic texel past its texture colour when ambient exceeds 1; Classic clamps the light at 1", async () => {
  const square: DrawnPose = { ...freshAnimation(), handle: { kind: "unit", id: 1 }, model: "square.mdl", created: 0, x: 0, y: 0, z: 0, alpha: 255, scale: 1, timeScale: 1, queuedAnimations: [], yaw: 0, pitch: 0, roll: 0, color: [255, 255, 255], teamColor: 0, matrixScale: [1, 1, 1], flat: false, unit: true };
  const scene: RenderScene = { frame: 0, client: 0, effects: [square], units: [], ui: [], camera: { x: 0, y: 0, fields: { CAMERA_FIELD_ROTATION: 90, CAMERA_FIELD_ANGLE_OF_ATTACK: 270, CAMERA_FIELD_TARGET_DISTANCE: 100 } },
    environment: { sky: "", skyVisible: false, terrainVisible: false, dayNight: { terrain: "light.mdl", unit: "light.mdl" }, timeOfDay: 12 } };
  const assets = new Map([["square.mdl", SQUARE], ["light.mdl", LIGHT], ["grey.tga", GREY]]);
  const directory = await mkdtemp(join(tmpdir(), "wisp-light-range-"));
  try {
    const want = { classic: [100, 100, 100], definitive: [150, 150, 150] };
    for (const graphics of ["classic", "definitive"] as const) {
      const out = join(directory, graphics);
      await Effect.runPromise(renderScenes({ readAsset: async (path: string) => assets.get(path), width: 64, height: 64 }, [scene], out, graphics));
      const pixels = decodePng(new Uint8Array(await Bun.file(join(out, "p0-frame-0.png")).arrayBuffer()));
      const centre = Array.from(pixels.rgb.slice((32 * 64 + 32) * 3, (32 * 64 + 32) * 3 + 3));
      for (const [channel, value] of centre.entries()) expect(Math.abs(value - (want[graphics][channel] ?? 0))).toBeLessThanOrEqual(1);
    }
  } finally { await rm(directory, { recursive: true, force: true }); }
}, 120_000);
