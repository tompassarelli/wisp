import { readFileSync } from "node:fs";
import { parseModelMDX } from "../../host/models/models";
import { boundsModel, type BoundsModel } from "../../host/render/screenBounds";
import { generateMDX, type model } from "../../vendor/war3-model.mjs";
import { graft } from "./models";

/** The glow geoset's index in the source model: its only geoset whose layer draws ReplaceableId 2. */
export function glowGeoset(data: model.Model): number {
  const found = data.Geosets.flatMap((geoset, index) => (data.Materials[geoset.MaterialID]?.Layers ?? []).some((layer) => typeof layer.TextureID === "number" && data.Textures[layer.TextureID]?.ReplaceableId === 2) ? [index] : []);
  if (found.length !== 1 || found[0] === undefined) throw new Error(`expected one team-glow geoset, found ${found.length}`);
  return found[0];
}

const parse = (path: string): model.Model => parseModelMDX(new Uint8Array(readFileSync(path)).slice().buffer);

/** The glow-free body, and the same body with the source's team-glow geoset put back, as private inputs only. */
export function bodies(bodyOffPath: string, sourcePath: string): { readonly off: Uint8Array; readonly on: Uint8Array; readonly onModel: BoundsModel; readonly geoset: number } {
  const off = parse(bodyOffPath), source = parse(sourcePath);
  const on = graft(off, source, glowGeoset(source));
  const bytes = new Uint8Array(generateMDX(on));
  return { off: new Uint8Array(readFileSync(bodyOffPath)), on: bytes, onModel: boundsModel(parseModelMDX(bytes.slice().buffer)), geoset: on.Geosets.length - 1 };
}
