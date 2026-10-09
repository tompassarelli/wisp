import { expect, test } from "bun:test";
import { decodeDoodadFile, decodeDoodads } from "../scripts/wisp/doodads";
import { doodadSkinRows, terrainDoodadPoses } from "../scripts/wisp/terrainDoodads";
import { drawnPoses } from "../scripts/wisp/culling";
import type { Terrain } from "../scripts/wisp/terrain";

// Authored from HiveWE's war3map.doo format: id, variation, X and Y grid cells.
function specialFile(): Uint8Array {
  const bytes = new Uint8Array(56), view = new DataView(bytes.buffer);
  bytes.set(new TextEncoder().encode("W3do")); view.setInt32(4, 8, true); view.setInt32(8, 11, true);
  view.setInt32(20, 2, true);
  for (const [at, variation, x, y] of [[24, 1, 2, 1], [40, 0, 5, 1]]) {
    bytes.set(new TextEncoder().encode("TEST"), at);
    view.setInt32(at + 4, variation ?? 0, true); view.setInt32(at + 8, x ?? 0, true); view.setInt32(at + 12, y ?? 0, true);
  }
  return bytes;
}

test("[reference] special terrain doodad records preserve variation and cell coordinates", () => {
  expect(decodeDoodads(specialFile())).toEqual([]);
  expect(decodeDoodadFile(specialFile()).terrain).toEqual([
    { type: "TEST", variation: 1, x: 2, y: 1 }, { type: "TEST", variation: 0, x: 5, y: 1 },
  ]);
});

test("[provisional] special models use installed skin fields and shifted terrain cells before world culling", () => {
  const point = { height: 30, layer: 2, ground: 0, variation: 0, cliff: 15, cliffVariation: 0, flags: 0 };
  const terrain: Terrain = { version: 11, tileset: "L", columns: 4, rows: 3, originX: -256, originY: -128, groundTiles: ["TEST"], cliffTiles: [], points: Array.from({ length: 12 }, () => point) };
  const rows = doodadSkinRows(new TextEncoder().encode("[TEST]\nfile=Scenery\\Test\nnumVar=2\nfixedRot=270\ndefScale=1\n"));
  const poses = terrainDoodadPoses(decodeDoodadFile(specialFile()).terrain, terrain, rows, 60);
  expect(poses.map(pose => [pose.model, pose.x, pose.y, pose.z])).toEqual([["Scenery\\Test1.mdx", 0, 0, 30], ["Scenery\\Test0.mdx", 384, 0, 30]]);
  expect(poses[0]?.yaw).toBe(3 * Math.PI / 2);
  expect(drawnPoses(poses, [0, 0, 100], 1000, { minX: -256, maxX: 128, minY: -128, maxY: 128 }).map(pose => pose.model)).toEqual(["Scenery\\Test1.mdx"]);
});
