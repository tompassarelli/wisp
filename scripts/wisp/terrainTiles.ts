import type { TerrainPoint } from "./terrain";

export interface TerrainTileLayer {
  readonly tile: number | "blight";
  readonly mask: number;
  readonly variation: number;
}


export function terrainTileLayers(corners: readonly [TerrainPoint, TerrainPoint, TerrainPoint, TerrainPoint]): TerrainTileLayer[] {
  const tiles = corners.map(point => (point.flags & 2) !== 0 ? "blight" as const : point.ground);
  return [...new Set(tiles)].sort((a, b) => a === "blight" ? 1 : b === "blight" ? -1 : a - b).map((tile, index) => ({
    tile, mask: index === 0 ? 15 : tiles.reduce<number>((mask, value, corner) => mask | (value === tile ? [2, 1, 8, 4][corner] ?? 0 : 0), 0),
    variation: corners[0].variation,
  }));
}


export function terrainTileUV(width: number, height: number, mask: number, variation: number): readonly [number, number, number, number] {
  const columns = width > height ? 8 : 4;
  const full = mask === 15, variant = variation & 15;
  const column = full ? columns === 8 ? 4 + variant % 4 : variation === 0 ? 0 : 3 : mask % 4;
  const row = full ? columns === 8 ? Math.floor(variant / 4) : variation === 0 ? 0 : 3 : Math.floor(mask / 4);
  return [column / columns + 0.5 / width, row / 4 + 0.5 / height, (column + 1) / columns - 0.5 / width, (row + 1) / 4 - 0.5 / height];
}


export function terrainBlightPath(bytes: Uint8Array, tileset: string): string {
  let section = "";
  for (const raw of new TextDecoder().decode(bytes).split(/\r?\n/)) {
    const line = raw.replace(/\/\/.*$/, "").trim();
    if (line.startsWith("[")) { section = line.slice(1, line.indexOf("]")).toLowerCase(); continue; }
    if (section !== "tilesets") continue;
    const equals = line.indexOf("=");
    if (equals < 0 || line.slice(0, equals).trim() !== tileset) continue;
    const path = line.slice(equals + 1).split(",")[1]?.trim();
    if (path !== undefined && path !== "") return /\.[^\\/]+$/.test(path) ? path : `${path}.blp`;
  }
  throw new Error(`no installed WorldEditData.txt blight path for tileset ${tileset}`);
}
