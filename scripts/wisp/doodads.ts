export interface PlacedDoodad {
  readonly type: string;
  readonly skin: string;
  readonly variation: number;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly angle: number;
  readonly scale: [number, number, number];
  readonly visible: boolean;
  readonly life: number;
}

export interface TerrainDoodad {
  readonly type: string;
  readonly variation: number;
  readonly x: number;
  readonly y: number;
}

/** Skin IDs were added without a version bump; terrain placements use integer grid cells. */
export function decodeDoodadFile(bytes: Uint8Array, skinIds = true): { placed: PlacedDoodad[]; terrain: TerrainDoodad[] } {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let at = 0;
  const id = () => { const value = String.fromCharCode(...bytes.subarray(at, at + 4)); at += 4; return value; };
  const int = () => { const value = view.getInt32(at, true); at += 4; return value; };
  const float = () => { const value = view.getFloat32(at, true); at += 4; return value; };
  const byte = () => { const value = view.getUint8(at); at++; return value; };
  const count = () => { const value = int(); if (value < 0 || value > bytes.length - at) throw new Error("invalid war3map.doo count"); return value; };
  if (id() !== "W3do") throw new Error("not a war3map.doo doodad file");
  const version = int(), subversion = int();
  if (version !== 8 || subversion !== 11) throw new Error(`war3map.doo version ${version}/${subversion} is not 8/11`);
  const length = count(), placements: PlacedDoodad[] = [];
  for (let index = 0; index < length; index++) {
    const type = id(), variation = int(), x = float(), y = float(), z = float(), angle = float();
    const scale: [number, number, number] = [float(), float(), float()];
    const skin = skinIds ? id() : type, flags = byte(), life = byte();
    int();
    const sets = count();
    for (let set = 0; set < sets; set++) {
      const items = count();
      for (let item = 0; item < items; item++) { id(); int(); }
    }
    int();
    placements.push({ type, skin, variation, x, y, z, angle, scale, visible: (flags & 3) !== 0, life });
  }
  const terrainVersion = int();
  if (terrainVersion !== 0) throw new Error(`war3map.doo terrain version ${terrainVersion} is not 0`);
  const special = count();
  const terrain: TerrainDoodad[] = [];
  for (let index = 0; index < special; index++) terrain.push({ type: id(), variation: int(), x: int(), y: int() });
  return { placed: placements, terrain };
}

export function decodeDoodads(bytes: Uint8Array, skinIds = true): PlacedDoodad[] {
  return decodeDoodadFile(bytes, skinIds).placed;
}
