import { freshAnimation } from "../../src/headless/animation";
import type { TerrainDoodad } from "./doodads";
import type { DrawnPose } from "./headlessRender";
import { CELL, type Terrain } from "./terrain";


export function doodadSkinRows(bytes: Uint8Array): ReadonlyMap<string, Readonly<Record<string, string>>> {
  const rows = new Map<string, Record<string, string>>();
  let row: Record<string, string> | undefined;
  for (const source of new TextDecoder().decode(bytes).split(/\r?\n/)) {
    const line = source.trim(), section = /^\[([^\]]+)\]$/.exec(line);
    if (section !== null) { row = {}; rows.set(section[1] ?? "", row); continue; }
    const at = line.indexOf("=");
    if (row !== undefined && at > 0) row[line.slice(0, at).toLowerCase()] = line.slice(at + 1);
  }
  return rows;
}


export function terrainDoodadPoses(placements: readonly TerrainDoodad[], terrain: Terrain, rows: ReadonlyMap<string, Readonly<Record<string, string>>>, frame: number,
  models: Readonly<Record<string, string | readonly string[]>> = {}): DrawnPose[] {
  return placements.map((placed, index) => {
    const row = rows.get(placed.type), variants = models[placed.type];
    const file = row?.file;
    const model = typeof variants === "string" ? variants : variants?.[placed.variation] ?? (file === undefined || file === "_" ? undefined
      : file.replace(/\.(mdx|mdl)$/i, "") + (Number(row?.numvar ?? 1) > 1 ? placed.variation : "") + ".mdx");
    if (model === undefined) throw new Error(`no installed doodad model for ${placed.type} variation ${placed.variation}`);
    const column = Math.max(0, Math.min(terrain.columns - 1, placed.x)), rowIndex = Math.max(0, Math.min(terrain.rows - 1, placed.y));
    const point = terrain.points[rowIndex * terrain.columns + column];
    if (point === undefined) throw new Error(`no terrain height for doodad ${placed.type}`);
    return { ...freshAnimation(), handle: { kind: "effect", id: -1_000_000 - index }, model, created: 0,
      x: terrain.originX + placed.x * CELL, y: terrain.originY + placed.y * CELL, z: point.height,
      alpha: 255, scale: Number(row?.defscale ?? 1), timeScale: 1, queuedAnimations: [],
      yaw: Number(row?.fixedrot ?? 0) * Math.PI / 180, pitch: 0, roll: 0, color: [255, 255, 255],
      teamColor: Number(row?.teamcolor ?? 0), matrixScale: [1, 1, 1], flat: false,
      animation: "stand", animationElapsed: frame / 60, animationClock: frame / 60 };
  });
}
