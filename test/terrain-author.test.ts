import { expect, test } from "bun:test";
import { syntheticTerrain, terrainExample } from "../examples/terrain";
import { decodeTerrain } from "../scripts/wisp/terrain";
import { terrainCells } from "../scripts/wisp/terrainMesh";
import { terrainLine, terrainRectFill } from "../scripts/wisp/terrainAuthor";

for (const version of [11, 12]) test(`[spec #98] W3E ${version} line and rectangle change exactly 16 points and preserve every other byte`, () => {
  const before = syntheticTerrain(version), after = terrainExample(version);
  const original = decodeTerrain(before), terrain = decodeTerrain(after);
  const selected = new Set([0, 1, 10, 11, 20, 21, 30, 31, 34, 35, 36, 37, 42, 43, 44, 45]);
  expect(terrain.points.length).toBe(48);
  for (let i = 0; i < 48; i++) expect(terrain.points[i]).toEqual({ ...original.points[i], ground: selected.has(i) ? 1 : 0 });
  expect([...after.keys()].filter(i => before[i] !== after[i])).toEqual([...selected].sort((a, b) => a - b).map(i => 45 + i * (version === 12 ? 8 : 7) + 4));
  expect(terrainCells(terrain).length).toBe(35);
  expect(terrainLine(before, "PATH", [7, 3], [0, 0])).toEqual(terrainLine(before, "PATH", [0, 0], [7, 3]));
  expect(terrainRectFill(before, "PATH", [5, 5], [2, 4])).toEqual(terrainRectFill(before, "PATH", [2, 4], [5, 5]));
});

test("[spec #98] missing tiles and invalid coordinates fail without changing the input", () => {
  const input = syntheticTerrain(), before = input.slice();
  expect(() => terrainLine(input, "NONE", [0, 0], [1, 1])).toThrow("palette");
  expect(() => terrainLine(input, "PATH", [-1, 0], [1, 1])).toThrow("outside");
  expect(() => terrainRectFill(input, "PATH", [0, 0], [8, 5])).toThrow("outside");
  expect(() => terrainRectFill(input, "PATH", [0.5, 0], [1, 1])).toThrow("outside");
  expect(input).toEqual(before);
});
