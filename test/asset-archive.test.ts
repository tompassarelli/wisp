import { expect, test } from "bun:test";
import { nearestAssetArchive, type AssetManifest } from "../host/compile/assetArchivePlan";

const manifest = (generation: number, container: string, entries: Record<string, string>, packager = "p"): AssetManifest => ({ container, packager, generation, entries });

test("[invariant] a cached archive is no base when its container or packager source differs, it holds an entry the build lacks, or its chain of incremental builds is long", () => {
  const wanted = manifest(0, "a", { x: "1", y: "2" });
  const base = (key: string, generation: number, container: string, entries: Record<string, string>) => ({ key, manifest: manifest(generation, container, entries) });
  expect(nearestAssetArchive([base("other", 0, "b", { x: "1", y: "2" })], wanted)).toBeUndefined();
  expect(nearestAssetArchive([{ key: "repacked", manifest: manifest(0, "a", { x: "1", y: "2" }, "q") }], wanted)).toBeUndefined();
  expect(nearestAssetArchive([base("extra", 0, "a", { x: "1", z: "3" })], wanted)).toBeUndefined();
  expect(nearestAssetArchive([base("tall", 8, "a", { x: "1", y: "2" })], wanted)).toBeUndefined();
  expect(nearestAssetArchive([base("far", 0, "a", { x: "0" }), base("near", 0, "a", { x: "1" })], wanted)?.key).toBe("near");
});
