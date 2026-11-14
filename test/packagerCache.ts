import { join } from "node:path";
import { Effect } from "effect";
import { ensurePackager } from "../host/compile/mapBuild";

export const packagerCache = join(import.meta.dir, "../build/packager-cache");
export const cachedPackager = join(packagerCache, "wisp/lan/map-pack");
export const PACKAGER_BUILD_MS = 300_000;

export const buildPackager = () => Effect.runPromise(ensurePackager(cachedPackager));
