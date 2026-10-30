import { readFileSync } from "node:fs";

export interface ArchiveEntry {
  readonly entry: string;

  readonly source: string;
}

export interface AssetManifest {
  readonly container: string;
  readonly generation: number;
  readonly entries: Readonly<Record<string, string>>;
}

export interface AssetArchiveBase {
  readonly key: string;
  readonly manifest: AssetManifest;
}

const ASSET_ARCHIVE_GENERATIONS = 8;

const sha256 = (bytes: Uint8Array | string) => new Bun.CryptoHasher("sha256").update(bytes).digest("hex");

export const assetManifest = (container: string, assets: readonly ArchiveEntry[]): AssetManifest => {
  const entries: Record<string, string> = {};
  for (const { entry, source } of assets) entries[entry.toLowerCase()] = sha256(readFileSync(source));
  return { container: sha256(readFileSync(container)), generation: 0, entries };
};

export const assetArchiveKey = ({ container, entries }: AssetManifest) =>
  sha256(JSON.stringify([container, Object.entries(entries).sort(([left], [right]) => left < right ? -1 : 1)]));

export const changedAssets = (assets: readonly ArchiveEntry[], base: AssetManifest, wanted: AssetManifest) =>
  assets.filter(({ entry }) => base.entries[entry.toLowerCase()] !== wanted.entries[entry.toLowerCase()]);

/** The cached archive needing the fewest replacements: same container, no entry the wanted set lacks, a short enough chain of earlier incremental builds. */
export const nearestAssetArchive = (cached: readonly AssetArchiveBase[], wanted: AssetManifest): AssetArchiveBase | undefined => {
  let nearest: { readonly base: AssetArchiveBase; readonly distance: number } | undefined;
  for (const base of cached) {
    const { container, generation, entries } = base.manifest;
    if (container !== wanted.container || generation >= ASSET_ARCHIVE_GENERATIONS) continue;
    if (Object.keys(entries).some((name) => wanted.entries[name] === undefined)) continue;
    const distance = Object.keys(wanted.entries).filter((name) => entries[name] !== wanted.entries[name]).length;
    if (nearest === undefined || distance < nearest.distance) nearest = { base, distance };
  }
  return nearest?.base;
};
