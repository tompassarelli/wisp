




export interface WorldBounds {
  readonly minX: number;
  readonly maxX: number;
  readonly minY: number;
  readonly maxY: number;
}

export interface TerrainPoint {

  readonly height: number;

  readonly ground: number;

  readonly variation: number;

  readonly layer: number;
  readonly cliff: number;
  readonly cliffVariation: number;

  readonly flags: number;

  readonly water: number;
}

export interface Terrain {
  readonly version: number;

  readonly tileset: string;

  readonly groundTiles: readonly string[];
  readonly cliffTiles: readonly string[];

  readonly columns: number;
  readonly rows: number;

  readonly originX: number;
  readonly originY: number;

  readonly points: readonly TerrainPoint[];
}


export const CELL = 128;

// war3map.w3e v11/v12 points are 7/8 bytes; heights use zero 0x2000, four steps/unit, cliff steps 128 above layer 2, and 14-bit water levels.





export function decodeTerrain(bytes: Uint8Array): Terrain {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const text = (at: number, length: number) => String.fromCharCode(...bytes.subarray(at, at + length));
  if (bytes.length < 4 || text(0, 4) !== "W3E!") throw new Error("not a war3map.w3e terrain file");
  let at = 4;
  const version = view.getInt32(at, true); at += 4;
  if (version !== 11 && version !== 12) throw new Error(`war3map.w3e version ${version} is not 11 or 12`);
  const tileset = text(at, 1); at += 1;
  at += 4;
  const ids = () => {
    const count = view.getInt32(at, true); at += 4;
    const out = Array.from({ length: count }, (_, index) => text(at + index * 4, 4));
    at += count * 4;
    return out;
  };
  const groundTiles = ids(), cliffTiles = ids();
  const columns = view.getInt32(at, true), rows = view.getInt32(at + 4, true);
  const originX = view.getFloat32(at + 8, true), originY = view.getFloat32(at + 12, true);
  at += 16;
  const size = version === 12 ? 8 : 7;
  if (bytes.length < at + columns * rows * size) throw new Error(`war3map.w3e holds fewer than its ${columns} x ${rows} points`);
  const points: TerrainPoint[] = [];
  for (let index = 0; index < columns * rows; index++, at += size) {
    const raw = view.getInt16(at, true), water = view.getUint16(at + 2, true);
    const tile = version === 12 ? view.getUint16(at + 4, true) : bytes[at + 4] ?? 0;
    const groundBits = version === 12 ? tile & 0x3f : tile & 0x0f;
    const flags = (version === 12 ? tile >> 6 : tile >> 4) | ((water & 0xc000) >> 10);
    const variation = bytes[at + size - 2] ?? 0, cliff = bytes[at + size - 1] ?? 0;
    const layer = cliff & 0x0f;
    points.push({ height: (raw - 0x2000) / 4 + (layer - 2) * CELL, ground: groundBits, variation: variation & 31, layer, flags, cliff: cliff >> 4, cliffVariation: variation >> 5, water: ((water & 0x3fff) - 0x2000) / 4 });
  }
  return { version, tileset, groundTiles, cliffTiles, columns, rows, originX, originY, points };
}


export function worldBounds(terrain: Pick<Terrain, "columns" | "rows" | "originX" | "originY">): WorldBounds {
  return { minX: terrain.originX, maxX: terrain.originX + (terrain.columns - 1) * CELL, minY: terrain.originY, maxY: terrain.originY + (terrain.rows - 1) * CELL };
}


export function shiftedBounds(bounds: WorldBounds, origin: readonly [number, number] = [0, 0]): WorldBounds {
  const [x, y] = origin;
  return { minX: bounds.minX - x, maxX: bounds.maxX - x, minY: bounds.minY - y, maxY: bounds.maxY - y };
}
