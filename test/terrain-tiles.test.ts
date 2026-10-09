import { expect, test } from "bun:test";
import type { TerrainPoint } from "../scripts/wisp/terrain";
import { terrainTileLayers, terrainTileUV, terrainBlightPath } from "../scripts/wisp/terrainTiles";

const point = (ground: number, blight = false): TerrainPoint => ({ ground, flags: blight ? 2 : 0, variation: 1, height: 0, layer: 2, cliff: 15, cliffVariation: 0, water: 0 });

test("[reference] terrain atlas variation 1 is east of 0 and blight replaces corners above ground", () => {
  // HiveWE's W3E format page, Ground Textures and Blight (16 September 2025).
  const uv = terrainTileUV(512, 256, 15, 1);
  expect(uv).toEqual([5 / 8 + 0.5 / 512, 0.5 / 256, 6 / 8 - 0.5 / 512, 1 / 4 - 0.5 / 256]);
  expect(terrainTileUV(512, 256, 15, 14)).toEqual([6 / 8 + 0.5 / 512, 3 / 4 + 0.5 / 256, 7 / 8 - 0.5 / 512, 1 - 0.5 / 256]);
  expect(terrainTileUV(512, 256, 1, 0)).toEqual([1 / 8 + 0.5 / 512, 0.5 / 256, 2 / 8 - 0.5 / 512, 1 / 4 - 0.5 / 256]);
  expect(terrainTileUV(512, 256, 8, 0)).toEqual([0.5 / 512, 2 / 4 + 0.5 / 256, 1 / 8 - 0.5 / 512, 3 / 4 - 0.5 / 256]);
  expect(terrainTileLayers([point(3), point(0, true), point(0), point(3, true)])).toEqual([
    { tile: 0, mask: 15, variation: 1 }, { tile: 3, mask: 2, variation: 1 }, { tile: "blight", mask: 5, variation: 1 },
  ]);
  expect(terrainTileLayers([point(0, true), point(1, true), point(2, true), point(3, true)])).toEqual([{ tile: "blight", mask: 15, variation: 1 }]);
});

test("[invariant] blight uses the requested installed tileset path", () => {
  const table = new TextEncoder().encode("[TileSets]\nL=label,authored\\summer\nV=label,authored\\village.blp\n[Other]\nL=label,wrong\n");
  expect(terrainBlightPath(table, "L")).toBe("authored\\summer.blp");
  expect(terrainBlightPath(table, "V")).toBe("authored\\village.blp");
  expect(() => terrainBlightPath(table, "Z")).toThrow("tileset Z");
});
