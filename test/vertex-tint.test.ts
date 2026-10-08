import { expect } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
import { freshAnimation } from "../src/headless/animation";
import { renderScenes, type RenderScene, type DrawnPose } from "../scripts/wisp/headlessRender";
import { farmTest } from "../scripts/wisp/farmTest";
import { decodePng } from "./animation58/read";
import { FIXTURE_MDL } from "./animation58/models";
import { MARK } from "./animation58/layout";

farmTest("[repro #40] rendered unit vertex color multiplies texels and team color, and white restores the original", async () => {
  const directory = await mkdtemp(join(tmpdir(), "wisp-tint-"));
  const text = FIXTURE_MDL[MARK];
  if (text === undefined) throw new Error("missing authored square");
  const white = new Uint8Array([0, 0, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 1, 0, 24, 32, 255, 255, 255]);
  const assets = new Map([["team.mdl", new TextEncoder().encode(text)], ["white.mdl", new TextEncoder().encode(text.replace('Image "", ReplaceableId 1,', 'Image "white.tga",'))], ["geoset.mdl", new TextEncoder().encode(text.replace('Image "", ReplaceableId 1,', 'Image "white.tga",') + "\nGeosetAnim { static Alpha 1, static Color { 0.25, 1, 0.5 }, GeosetId 0, }")], ["white.tga", white]]);
  const pose: DrawnPose = { ...freshAnimation(), handle: { kind: "unit", id: 1 }, model: "white.mdl", created: 0, x: 0, y: 0, z: 0, alpha: 255, scale: 1, timeScale: 1, queuedAnimations: [], yaw: 0, pitch: 0, roll: 0, color: [255, 255, 255], teamColor: 1, matrixScale: [1, 1, 1], flat: false, unit: true };
  const base: RenderScene = { frame: 0, client: 0, effects: [pose], units: [], ui: [], camera: { x: 0, y: 0, fields: { CAMERA_FIELD_ROTATION: 90, CAMERA_FIELD_ANGLE_OF_ATTACK: 270, CAMERA_FIELD_TARGET_DISTANCE: 100 } }, environment: { sky: "", skyVisible: false, terrainVisible: false, dayNight: { terrain: "", unit: "" }, timeOfDay: 12 } };
  const cases = [
    { model: "white.mdl", color: [255, 255, 255], want: [255, 255, 255] },
    { model: "white.mdl", color: [255, 100, 25], want: [255, 100, 25] },
    { model: "white.mdl", color: [255, 255, 255], want: [255, 255, 255] },
    { model: "team.mdl", color: [255, 255, 255], want: [0, 66, 255] },
    { model: "team.mdl", color: [255, 100, 25], want: [0, 26, 25] },
    { model: "team.mdl", color: [255, 255, 255], want: [0, 66, 255] },
    { model: "geoset.mdl", color: [255, 255, 255], want: [128, 255, 64] },
    { model: "geoset.mdl", color: [255, 100, 25], want: [128, 100, 6] },
  ];
  try {
    const scenes = cases.map((row, frame) => ({ ...base, frame, effects: [{ ...pose, handle: { kind: "unit", id: row.model === "white.mdl" ? 1 : row.model === "team.mdl" ? 2 : 3 }, model: row.model, color: row.color as [number, number, number] }] }));
    const images = await Effect.runPromise(renderScenes({ readAsset: async path => assets.get(path), width: 64, height: 64 }, scenes, directory));
    for (const [index, image] of images.entries()) {
      expect(image.notDrawn).toEqual([]);
      const pixels = decodePng(new Uint8Array(await Bun.file(join(directory, image.image)).arrayBuffer()));
      const center = Array.from(pixels.rgb.slice((32 * 64 + 32) * 3, (32 * 64 + 32) * 3 + 3));
      expect(center).toEqual(cases[index]?.want);
    }
  } finally { await rm(directory, { recursive: true, force: true }); }
}, 120_000);
