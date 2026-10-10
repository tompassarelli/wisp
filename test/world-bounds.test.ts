import { expect, test } from "bun:test";
import { drawnPoses } from "../scripts/wisp/culling";
import { decodeTerrain, shiftedBounds, worldBounds } from "../scripts/wisp/terrain";

/** A flat war3map.w3e (version 12, 8-byte points) of `columns` x `rows` points from (originX, originY), written here. */
function flatTerrain(columns: number, rows: number, originX: number, originY: number): Uint8Array {
  const header = 4 + 4 + 1 + 4 + 4 + 4 + 4 + 16;
  const bytes = new Uint8Array(header + columns * rows * 8), view = new DataView(bytes.buffer);
  bytes.set([...("W3E!")].map((c) => c.charCodeAt(0)), 0);
  view.setInt32(4, 12, true); bytes[8] = "L".charCodeAt(0);
  view.setInt32(13, 1, true); bytes.set([..."Ldrt"].map((c) => c.charCodeAt(0)), 17);
  view.setInt32(21, 0, true);
  view.setInt32(25, columns, true); view.setInt32(29, rows, true); view.setFloat32(33, originX, true); view.setFloat32(37, originY, true);
  for (let index = 0; index < columns * rows; index++) { view.setInt16(header + index * 8, 0x2000, true); bytes[header + index * 8 + 7] = 2; }
  return bytes;
}

const pose = (name: string, x: number, y: number, unit = false) => ({ name, x, y, z: 500, alpha: 255, scale: 1, flat: false, ...(unit ? { unit: true as const } : {}) });

test("[native] an effect whose origin lies outside the terrain's world bounds isn't drawn: Stratholme's cathedral on the 64 x 64 base (smashcraft#297)", () => {

  const terrain = decodeTerrain(flatTerrain(65, 65, -4096, -4096));
  expect(worldBounds(terrain)).toEqual({ minX: -4096, maxX: 4096, minY: -4096, maxY: 4096 });

  const world = shiftedBounds(worldBounds(terrain), [0, -256]);
  const poses = [pose("gate", -1900, 3800), pose("cathedral", 1500, 6200), pose("fighter", 0, 4400, true)];
  expect(drawnPoses(poses, [0, -1428, 2152], 8000, world).map((p) => p.name)).toEqual(["gate", "fighter"]);

  const extended = shiftedBounds(worldBounds(decodeTerrain(flatTerrain(65, 97, -4096, -4096))), [0, -256]);
  expect(drawnPoses(poses, [0, -1428, 2152], 8000, extended).map((p) => p.name)).toEqual(["gate", "cathedral", "fighter"]);
});
