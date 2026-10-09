import { CELL, type Terrain } from "./terrain";
import { terrainCells, type TerrainCell } from "./terrainMesh";

/** Stock meshes place their lettered corners at NW, SW, SE, NE. */
export function cliffShape(cell: TerrainCell): string | undefined {
  const low = Math.min(...cell.corners.map(point => point.layer));
  if (cell.corners.every(point => point.layer === low) || cell.corners.some(point => (point.flags & 1) !== 0)) return undefined;
  return [2, 0, 1, 3].map(index => String.fromCharCode(65 + (cell.corners[index]?.layer ?? low) - low)).join("");
}

/** Cliff ground replaces painted ground and blight in the surrounding point neighborhood. */
export function cliffGround(terrain: Terrain, rows: ReadonlyMap<string, Readonly<Record<string, string>>>): Terrain {
  const groundTiles = [...terrain.groundTiles], points = [...terrain.points];
  for (const cell of terrainCells(terrain)) {
    if (cliffShape(cell) === undefined) continue;
    const cliff = cell.corners.find(point => point.cliff !== 15)?.cliff ?? 0;
    const id = terrain.cliffTiles[cliff], tile = id === undefined ? undefined : rows.get(id)?.groundtile;
    if (tile === undefined || tile === "_") continue;
    let ground = groundTiles.indexOf(tile);
    if (ground < 0) { ground = groundTiles.length; groundTiles.push(tile); }
    const column = (cell.x - terrain.originX) / CELL, row = (cell.y - terrain.originY) / CELL;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const x = column + dx, y = row + dy;
      if (x < 0 || y < 0 || x >= terrain.columns || y >= terrain.rows) continue;
      const index = y * terrain.columns + x, point = points[index];
      if (point !== undefined) points[index] = { ...point, ground, flags: point.flags & ~2 };
    }
  }
  return { ...terrain, groundTiles, points };
}
