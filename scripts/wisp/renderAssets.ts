import { Effect, Schema } from "effect";

import type { Graphics } from "./graphicsProfiles";

export type { Graphics } from "./graphicsProfiles";
export type AssetLayer = "base" | "_hd.w3mod" | "_de.w3mod";
export interface AssetLocation {
  readonly source: "map" | "stock" | "project";
  readonly layer: AssetLayer;
  readonly path: string;
}
export interface RenderAssetResolution {
  readonly requested: string;
  readonly graphics: Graphics;
  readonly bodyAlias?: AssetLayer;
  readonly suffixConversion?: string;
  readonly selectedPath?: string | null;
  readonly attempts: readonly AssetLocation[];
  readonly selected: AssetLocation | undefined;
}
export interface ResolvedRenderAsset extends RenderAssetResolution {
  readonly bytes: Uint8Array | undefined;
}
export interface RenderAssetReaders {
  readonly map: (path: string) => Promise<Uint8Array | undefined>;
  readonly stock: (path: string, layer: AssetLayer) => Promise<Uint8Array | undefined>;
}

export class RenderAssetFailure extends Schema.TaggedError<RenderAssetFailure>()("RenderAssetFailure", { cause: Schema.Unknown }) {
  override get message(): string { return `render asset: ${String(this.cause)}`; }
}

export const resolveRenderAsset = (readers: RenderAssetReaders, requested: string, graphics: Graphics = "classic", body?: AssetLocation) => Effect.gen(function*() {
  const path = requested.replaceAll("\\", "/").replace(/\.mdl$/i, ".mdx");
  if (path.startsWith("/") || path.split("/").some((part) => part === "..") || path.includes(":")) {
    return yield* new RenderAssetFailure({ cause: `invalid map asset path: ${requested}` });
  }
  const explicit = /^(_(?:de|hd)\.w3mod)\/(.*)$/i.exec(path);
  const layers: readonly AssetLayer[] = explicit !== null ? [explicit[1]?.toLowerCase() as AssetLayer]
    : graphics === "definitive" ? ["_de.w3mod", "_hd.w3mod", "base"] : ["base"];
  const attempts: AssetLocation[] = [];
  const metadata = body === undefined ? {} : { bodyAlias: body.layer, suffixConversion: /\.(tif|blp|tga)$/i.test(path) && body.layer !== "base" ? `${path.match(/\.[^.]+$/)?.[0]} → .dds` : "none" };
  for (const source of ["map", "stock"] as const) {
    const inherited: readonly AssetLayer[] = body === undefined || explicit !== null ? layers
      : source === "map" && body.layer !== "base" ? [body.layer, "base"]
      : source === "stock" && body.source === "stock" ? layers.slice(layers.indexOf(body.layer))
      : [body.layer];
    for (const layer of inherited) {
      const originalPath = explicit?.[2] ?? path;
      const assetPath = source === "stock" && body !== undefined && layer !== "base" ? originalPath.replace(/\.(tif|blp|tga)$/i, ".dds") : originalPath;
      const location: AssetLocation = { source, layer, path: source === "map" && layer !== "base" ? `${layer}/${assetPath}` : assetPath };
      attempts.push(location);
      const bytes = yield* Effect.tryPromise({
        try: () => source === "map" ? readers.map(location.path) : readers.stock(assetPath, layer),
        catch: (cause) => new RenderAssetFailure({ cause }),
      });
      if (bytes !== undefined) return { requested, graphics, ...metadata, ...(body === undefined ? {} : { selectedPath: source === "stock" && layer !== "base" ? `${layer}/${assetPath}` : location.path, suffixConversion: source === "stock" ? metadata.suffixConversion : "none" }), attempts, selected: location, bytes } satisfies ResolvedRenderAsset;
    }
    if (path.toLowerCase().startsWith("war3mapimported/")) break;
  }
  return { requested, graphics, ...metadata, ...(body === undefined ? {} : { selectedPath: null }), attempts, selected: undefined, bytes: undefined } satisfies ResolvedRenderAsset;
});
