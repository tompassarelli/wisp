import { expect } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
import { freshAnimation } from "../src/headless/animation";
import { renderScenes, type RenderScene, type DrawnPose } from "../scripts/wisp/headlessRender";
import { farmTest } from "../scripts/wisp/farmTest";
import { generateMDX, parseMDL } from "../vendor/war3-model.mjs";
import { FIXTURE_MDL } from "./animation58/models";
import { MARK } from "./animation58/layout";

farmTest("[repro #75] mixed SD and HD scenes replace an SD handle without destroying absent shaders", async () => {
  const directory = await mkdtemp(join(tmpdir(), "wisp-mixed-shaders-"));
  const text = FIXTURE_MDL[MARK];
  if (text === undefined) throw new Error("missing authored square");
  const hd = parseMDL(text);
  hd.Version = 1000;
  for (const material of hd.Materials) {
    material.Shader = "Shader_HD_DefaultUnit";
    const layer = material.Layers[0];
    if (layer === undefined) throw new Error("missing authored layer");
    material.Layers = Array.from({ length: 6 }, () => ({ ...layer }));
  }
  for (const geoset of hd.Geosets) {
    geoset.Tangents = new Float32Array([1, 0, 0, 1, 1, 0, 0, 1, 1, 0, 0, 1, 1, 0, 0, 1]);
    geoset.SkinWeights = new Uint8Array([0, 0, 0, 0, 255, 0, 0, 0, 0, 0, 0, 0, 255, 0, 0, 0, 0, 0, 0, 0, 255, 0, 0, 0, 0, 0, 0, 0, 255, 0, 0, 0]);
  }
  const assets = new Map([["sd.mdl", new TextEncoder().encode(text)], ["hd.mdx", new Uint8Array(generateMDX(hd))]]);
  const pose: DrawnPose = { ...freshAnimation(), handle: { kind: "unit", id: 1 }, model: "sd.mdl", created: 0, x: 0, y: 0, z: 0, alpha: 255, scale: 1, timeScale: 1, queuedAnimations: [], yaw: 0, pitch: 0, roll: 0, color: [255, 255, 255], teamColor: 1, matrixScale: [1, 1, 1], flat: false, unit: true };
  const base: RenderScene = { frame: 0, client: 0, effects: [pose, { ...pose, handle: { kind: "unit", id: 2 }, model: "hd.mdx", x: 20 }], units: [], ui: [], camera: { x: 0, y: 0, fields: { CAMERA_FIELD_ROTATION: 90, CAMERA_FIELD_ANGLE_OF_ATTACK: 270, CAMERA_FIELD_TARGET_DISTANCE: 100 } }, environment: { sky: "", skyVisible: false, terrainVisible: false, dayNight: { terrain: "", unit: "" }, timeOfDay: 12 } };
  try {
    const replacement = { ...base, frame: 1, effects: [{ ...pose, model: "hd.mdx" }] };
    const images = await Effect.runPromise(renderScenes({ readAsset: async path => assets.get(path), width: 64, height: 64 }, [base, replacement], directory));
    expect(images).toHaveLength(2);
    for (const image of images) expect(image.notDrawn).toEqual([]);
  } finally { await rm(directory, { recursive: true, force: true }); }
}, 120_000);
