import { Effect, Schema } from "effect";

import type { Graphics } from "./graphicsProfiles";

export type { Graphics } from "./graphicsProfiles";
export type AssetLayer = "base";
export interface AssetLocation {
  readonly source: "map" | "stock" | "project";
  readonly layer: AssetLayer;
  readonly path: string;
}
export interface RenderAssetResolution {
  readonly requested: string;
  readonly graphics: Graphics;
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

export class RenderAssetFailure extends Schema.TaggedError<RenderAssetFailure, { readonly brand: unique symbol }>()("RenderAssetFailure", { cause: Schema.Unknown }) {
  override get message(): string { return `render asset: ${String(this.cause)}`; }
}

export const resolveRenderAsset = (readers: RenderAssetReaders, requested: string, graphics: Graphics = "classic") => Effect.gen(function*() {
  const path = requested.replaceAll("\\", "/").replace(/\.mdl$/i, ".mdx");
  if (path.startsWith("/") || path.split("/").some((part) => part === "..") || path.includes(":")) {
    return yield* new RenderAssetFailure({ cause: `invalid map asset path: ${requested}` });
  }
  const attempts: AssetLocation[] = [];
  for (const source of ["map", "stock"] as const) {
    const location: AssetLocation = { source, layer: "base", path };
    attempts.push(location);
    const bytes = yield* Effect.tryPromise({
      try: () => source === "map" ? readers.map(path) : readers.stock(path, "base"),
      catch: (cause) => new RenderAssetFailure({ cause }),
    });
    if (bytes !== undefined) return { requested, graphics, attempts, selected: location, bytes } satisfies ResolvedRenderAsset;
    if (path.toLowerCase().startsWith("war3mapimported/")) break;
  }
  return { requested, graphics, attempts, selected: undefined, bytes: undefined } satisfies ResolvedRenderAsset;
});
