import { expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
import { decodeTerrain } from "../scripts/wisp/terrain";
import { terrainCells, terrainLayers } from "../scripts/wisp/terrainMesh";
import { renderScenes, sceneWithUnits, type RenderScene } from "../scripts/wisp/headlessRender";
import { farmTest } from "../scripts/wisp/farmTest";

/** Authored W3E version 11; format facts in docs/headless.md, Terrain. */
function terrainBytes(): Uint8Array {
  const bytes = new Uint8Array(45 + 4 * 7), view = new DataView(bytes.buffer);
  bytes.set(new TextEncoder().encode("W3E!")); view.setInt32(4, 11, true); bytes[8] = 76;
  view.setInt32(13, 2, true); bytes.set(new TextEncoder().encode("TESTMORE"), 17);
  view.setInt32(25, 0, true); view.setInt32(29, 2, true); view.setInt32(33, 2, true);
  view.setFloat32(37, 100, true); view.setFloat32(41, 200, true);
  for (let index = 0; index < 4; index++) {
    view.setInt16(45 + index * 7, 8192 + index * 4, true);
    bytes[49 + index * 7] = index === 1 ? 1 : 0;
    bytes[50 + index * 7] = 0x41;
    bytes[51 + index * 7] = 0xf2;
  }
  return bytes;
}
const scene: RenderScene = { frame: 1, client: 0, effects: [], units: [], ui: [],
  camera: { x: 64, y: 64, fields: { CAMERA_FIELD_ROTATION: 90, CAMERA_FIELD_ANGLE_OF_ATTACK: 270, CAMERA_FIELD_TARGET_DISTANCE: 180 } },
  environment: { sky: "", skyVisible: false, terrainVisible: true, dayNight: { terrain: "", unit: "" }, timeOfDay: 12 } };

test("[reference] W3E heights and split variations reach the renderer at the requested map origin", () => {
  const w3e = terrainBytes(), project = { readAsset: async () => undefined, terrain: { w3e, origin: [100, 200] as const } };
  const rendered = sceneWithUnits(project, scene).terrain;
  expect(rendered?.points.map(point => [point.height, point.variation, point.cliffVariation, point.cliff])).toEqual([[0, 1, 2, 15], [1, 1, 2, 15], [2, 1, 2, 15], [3, 1, 2, 15]]);
  const cells = terrainCells(rendered ?? decodeTerrain(w3e));
  expect(cells.map(cell => [cell.x, cell.y])).toEqual([[0, 0]]);
  expect(terrainLayers(cells[0]!)).toEqual([{ tile: 0, mask: 15, variation: 1 }, { tile: 1, mask: 1, variation: 1 }]);
  expect(sceneWithUnits({ ...project, terrain: { w3e, origin: [0, 0] as const } }, scene).terrain?.originX).toBe(100);
});

farmTest("[repro #82] textured W3E terrain changes Classic and Definitive pixels and obeys terrain visibility", async () => {
  const table = new TextEncoder().encode('ID;PWXL;N;E\nC;X1;Y1;K"tileID"\nC;X2;K"dir"\nC;X3;K"file"\nC;X1;Y2;K"TEST"\nC;X2;K"authored"\nC;X3;K"red"\nC;X1;Y3;K"MORE"\nC;X2;K"authored"\nC;X3;K"green"\nE');
  const tga = (red: number, green: number) => { const bytes = new Uint8Array(18 + 4 * 4 * 4); bytes[2] = 2; bytes[12] = bytes[14] = 4; bytes[16] = 32; for (let at = 18; at < bytes.length; at += 4) { bytes[at + 1] = green; bytes[at + 2] = red; bytes[at + 3] = 255; } return bytes; };
  const directory = await mkdtemp(join(tmpdir(), "wisp-terrain-"));
  try {
    for (const graphics of ["classic", "definitive"] as const) {
      const project = { readAsset: async (path: string) => path.endsWith(".slk") ? table : path.includes("red") ? tga(255, 0) : tga(0, 255), width: 64, height: 64, terrain: { w3e: terrainBytes(), origin: [100, 200] as const } };
      const images = await Effect.runPromise(renderScenes(project, [scene, { ...scene, frame: 2, environment: { ...scene.environment, terrainVisible: false } }], join(directory, graphics), graphics));
      expect(images[0]?.notDrawn).toEqual([]);
      expect(await readFile(join(directory, graphics, "p0-frame-1.png"))).not.toEqual(await readFile(join(directory, graphics, "p0-frame-2.png")));
    }
  } finally { await rm(directory, { recursive: true, force: true }); }
}, 120_000);
