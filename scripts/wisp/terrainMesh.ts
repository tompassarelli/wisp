import { CELL, type Terrain, type TerrainPoint } from "./terrain";

export interface TerrainCell {
  readonly x: number;
  readonly y: number;
  /** South-west, south-east, north-west, north-east. */
  readonly corners: readonly [TerrainPoint, TerrainPoint, TerrainPoint, TerrainPoint];
}

/** Cells stop at the last row/column of points, including terrain outside camera bounds. */
export function terrainCells(terrain: Terrain): TerrainCell[] {
  const cells: TerrainCell[] = [];
  for (let row = 0; row < terrain.rows - 1; row++) for (let column = 0; column < terrain.columns - 1; column++) {
    const sw = terrain.points[row * terrain.columns + column], se = terrain.points[row * terrain.columns + column + 1];
    const nw = terrain.points[(row + 1) * terrain.columns + column], ne = terrain.points[(row + 1) * terrain.columns + column + 1];
    if (sw === undefined || se === undefined || nw === undefined || ne === undefined) throw new Error("terrain cell has missing corners");
    cells.push({ x: terrain.originX + column * CELL, y: terrain.originY + row * CELL, corners: [sw, se, nw, ne] });
  }
  return cells;
}

/** Ascending ground IDs draw the full base first, then corner masks from the tile atlas. */
export function terrainLayers(cell: TerrainCell): { tile: number; mask: number; variation: number }[] {
  return [...new Set(cell.corners.map(point => point.ground))].sort((a, b) => a - b).map((tile, index) => ({
    tile, mask: index === 0 ? 15 : cell.corners.reduce((mask, point, corner) => mask | (point.ground === tile ? [2, 1, 8, 4][corner] ?? 0 : 0), 0),
    variation: cell.corners[0].variation,
  }));
}

/** Installed SLK cells carry X/Y forward when omitted. Only format fields are retained. */
export function terrainRows(bytes: Uint8Array): ReadonlyMap<string, Readonly<Record<string, string>>> {
  const rows = new Map<number, Map<number, string>>();
  let x = 1, y = 1;
  for (const line of new TextDecoder().decode(bytes).split(/\r?\n/)) {
    const fields = line.match(/(?:[^;"\r\n]|"(?:[^"]|"")*")+/g) ?? [];
    if (fields[0] !== "C") continue;
    let value: string | undefined;
    for (const field of fields.slice(1)) {
      if (field.startsWith("X")) x = Number(field.slice(1));
      else if (field.startsWith("Y")) y = Number(field.slice(1));
      else if (field.startsWith("K")) { const cell = field.slice(1); value = cell.startsWith('"') ? cell.slice(1, -1).replaceAll('""', '"') : cell; }
    }
    if (value === undefined) continue;
    let row = rows.get(y);
    if (row === undefined) rows.set(y, row = new Map());
    row.set(x, value);
  }
  const headers = rows.get(1), result = new Map<string, Readonly<Record<string, string>>>();
  for (const [number, row] of rows) {
    if (number === 1) continue;
    const id = row.get(1);
    if (id === undefined) continue;
    result.set(id, Object.fromEntries([...row].map(([column, value]) => [headers?.get(column)?.toLowerCase() ?? "", value])));
  }
  return result;
}
