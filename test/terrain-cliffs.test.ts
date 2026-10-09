import { expect, test } from "bun:test";
import { cliffGround, cliffShape } from "../scripts/wisp/terrainCliffs";
import { terrainCells } from "../scripts/wisp/terrainMesh";
import type { Terrain, TerrainPoint } from "../scripts/wisp/terrain";

const point = (layer = 2): TerrainPoint => ({ layer, height: (layer - 2) * 128, ground: 0, variation: 0, cliff: 0, cliffVariation: 0, flags: 2, water: 0 });

test("[reference] installed cliff model high corners stay at NW, SW, SE, NE", () => {
  // 3.0.0.24268 stock BAAA, ABAA, AABA, AAAB place z=128 at
  // (-128,0), (-128,128), (0,128), (0,0), respectively.
  for (const [corner, shape] of [[2, "BAAA"], [0, "ABAA"], [1, "AABA"], [3, "AAAB"]] as const) {
    expect(cliffShape({ x: 0, y: 0, corners: [point(corner === 0 ? 3 : 2), point(corner === 1 ? 3 : 2), point(corner === 2 ? 3 : 2), point(corner === 3 ? 3 : 2)] })).toBe(shape);
  }
});

test("[reference] cliff ground replaces nearby painted ground and blight without spreading across the map", () => {
  const terrain: Terrain = { version: 11, tileset: "L", groundTiles: ["TEST"], cliffTiles: ["CLdi"], columns: 5, rows: 5, originX: -256, originY: -256, points: Array.from({ length: 25 }, (_, index) => point(index === 12 ? 3 : 2)) };
  const result = cliffGround(terrain, new Map([["CLdi", { groundtile: "Ldrt" }]]));
  const cell = terrainCells(result)[0];
  expect(cell?.corners.map(p => [result.groundTiles[p.ground], p.flags & 2])).toEqual([["Ldrt", 0], ["Ldrt", 0], ["Ldrt", 0], ["Ldrt", 0]]);
  expect(result.points[24]).toEqual(terrain.points[24]);
  expect(terrain.points[0]?.flags).toBe(2);
});
