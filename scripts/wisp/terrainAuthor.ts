import { decodeTerrain } from "./terrain";

export type TerrainGridPoint = readonly [east: number, north: number];

function painter(bytes: Uint8Array, tile: string, endpoints: readonly TerrainGridPoint[]) {
  const terrain = decodeTerrain(bytes);
  const mask = terrain.version === 12 ? 0x3f : 0x0f;
  const ground = terrain.groundTiles.indexOf(tile);
  if (ground < 0 || ground > mask) throw new Error(`terrain tile ${tile} is not in the usable ground tile palette`);
  for (const [x, y] of endpoints) {
    if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0 || x >= terrain.columns || y >= terrain.rows) {
      throw new Error(`terrain point ${x},${y} is outside the ${terrain.columns} x ${terrain.rows} grid`);
    }
  }
  const output = bytes.slice(), view = new DataView(output.buffer);
  const header = 37 + 4 * (terrain.groundTiles.length + terrain.cliffTiles.length);
  const size = terrain.version === 12 ? 8 : 7;
  return { output, paint(x: number, y: number) {
    const at = header + (y * terrain.columns + x) * size + 4;
    if (terrain.version === 12) view.setUint16(at, (view.getUint16(at, true) & ~mask) | ground, true);
    else output[at] = ((output[at] ?? 0) & ~mask) | ground;
  } };
}

export function terrainLine(bytes: Uint8Array, tile: string, from: TerrainGridPoint, to: TerrainGridPoint): Uint8Array {
  const { output, paint } = painter(bytes, tile, [from, to]);
  let [x, y] = from;
  const [endX, endY] = to, dx = Math.abs(endX - x), dy = -Math.abs(endY - y);
  const sx = x < endX ? 1 : -1, sy = y < endY ? 1 : -1;
  let error = dx + dy;
  while (true) {
    paint(x, y);
    if (x === endX && y === endY) break;
    const twice = 2 * error;
    if (twice >= dy) { error += dy; x += sx; }
    if (twice <= dx) { error += dx; y += sy; }
  }
  return output;
}

export function terrainRectFill(bytes: Uint8Array, tile: string, first: TerrainGridPoint, second: TerrainGridPoint): Uint8Array {
  const { output, paint } = painter(bytes, tile, [first, second]);
  for (let y = Math.min(first[1], second[1]); y <= Math.max(first[1], second[1]); y++) {
    for (let x = Math.min(first[0], second[0]); x <= Math.max(first[0], second[0]); x++) paint(x, y);
  }
  return output;
}
