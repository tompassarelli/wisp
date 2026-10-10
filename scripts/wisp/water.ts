import { CELL, type Terrain } from "./terrain";
import { terrainCells } from "./terrainMesh";

type Rgba = readonly [number, number, number, number];

export interface WaterTable {

  readonly offset: number;

  readonly texture: string;
  readonly frames: number;

  readonly rate: number;

  readonly cells: number;

  readonly shallow: readonly [Rgba, Rgba];
  readonly deep: readonly [Rgba, Rgba];
}

export const SHALLOW_DEPTH = CELL / 2;

export function waterTable(rows: ReadonlyMap<string, Readonly<Record<string, string>>>, tileset: string): WaterTable {
  const row = rows.get(`${tileset}Sha`);
  if (row === undefined) throw new Error(`no installed Water.slk row for tileset ${tileset} (${tileset}Sha)`);
  const value = (key: string) => {
    const number = Number(row[key.toLowerCase()]);
    if (!Number.isFinite(number)) throw new Error(`Water.slk ${tileset}Sha has no number in ${key}`);
    return number;
  };
  const rgba = (prefix: string): Rgba => [value(`${prefix}_R`), value(`${prefix}_G`), value(`${prefix}_B`), value(`${prefix}_A`)];
  const texture = row.texfile;
  if (texture === undefined || texture === "") throw new Error(`Water.slk ${tileset}Sha names no texFile`);
  return { offset: value("height") * CELL, texture, frames: Math.max(1, value("numTex")), rate: value("texRate"), cells: Math.max(1, value("cells")),
    shallow: [rgba("Smin"), rgba("Smax")], deep: [rgba("Dmin"), rgba("Dmax")] };
}

export function waterColor(table: WaterTable, depth: number): Rgba {
  if (depth <= 0) return [table.shallow[0][0], table.shallow[0][1], table.shallow[0][2], 0];
  const [from, to] = depth <= SHALLOW_DEPTH ? table.shallow : table.deep;
  const t = depth <= SHALLOW_DEPTH ? depth / SHALLOW_DEPTH : Math.min(1, (depth - SHALLOW_DEPTH) / SHALLOW_DEPTH);
  return [0, 1, 2, 3].map((index) => (from[index] ?? 0) + ((to[index] ?? 0) - (from[index] ?? 0)) * t) as unknown as Rgba;
}

export function waterTexture(table: WaterTable, frame: number): string {
  const index = Math.floor(frame * table.rate / 60) % table.frames;
  return `${table.texture}${String(index).padStart(2, "0")}.blp`;
}

export function waterMesh(terrain: Terrain, table: WaterTable): Float32Array {
  const out: number[] = [], span = table.cells * CELL;
  for (const cell of terrainCells(terrain)) {
    if (!cell.corners.some((point) => (point.flags & 4) !== 0)) continue;
    const corners = cell.corners.map((point, corner) => {
      const x = cell.x + (corner % 2) * CELL, y = cell.y + Math.floor(corner / 2) * CELL, z = point.water + table.offset;
      const color = waterColor(table, z - point.height);
      return [x, y, z, x / span, y / span, ...color.map((channel) => channel / 255)];
    });
    for (const index of [0, 1, 2, 1, 3, 2]) out.push(...(corners[index] ?? []));
  }
  return new Float32Array(out);
}
