import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Effect } from "effect";
import { ensurePackager, mapPack } from "../compile/mapBuild";
import { ENVIRONMENT_FIELDS, encodeMapInfo, type MapInfo } from "./mapInfo";

const SCRIPT = `function InitGlobals()
end

function main()
InitGlobals()
RunInitializationTriggers()
end

function config()
end
`;

const zeros = (length: number) => new Uint8Array(length);

const FIELD_BYTES = { byte: 1, int: 4, string: 1 } as const;

const environment = () => zeros(ENVIRONMENT_FIELDS.reduce((length, [field, count]) => length + FIELD_BYTES[field] * count, 0));

export const syntheticMapInfo = (): MapInfo => {
  const versions = zeros(28);
  new DataView(versions.buffer).setInt32(0, 39, true);
  return {
    versions, name: "Synthetic", author: "", description: "", suggestedPlayers: "",
    bounds: zeros(56), flags: 0, environment: environment(), players: [], forces: [], tables: zeros(0),
  };
};

export const syntheticBaseMap = (packager: string, out: string) => Effect.acquireUseRelease(
  Effect.sync(() => mkdtempSync(join(tmpdir(), "wisp-synthetic-map-"))),
  (work) => Effect.gen(function*() {
    yield* ensurePackager(packager);
    const entries = [
      { entry: "war3map.lua", source: join(work, "war3map.lua") },
      { entry: "war3map.w3i", source: join(work, "war3map.w3i") },
    ];
    writeFileSync(entries[0]!.source, SCRIPT);
    writeFileSync(entries[1]!.source, encodeMapInfo(syntheticMapInfo()));
    rmSync(out, { force: true });
    yield* mapPack(packager).create(out, entries, join(work, "entries"));
  }),
  (work) => Effect.sync(() => rmSync(work, { recursive: true, force: true })),
);

if (import.meta.main) {
  const [packager, out] = process.argv.slice(2);
  if (packager === undefined || out === undefined) {
    console.error("usage: bun host/toolchain/syntheticBaseMap.ts PACKAGER OUT.w3x");
    process.exit(2);
  }
  await Effect.runPromise(syntheticBaseMap(resolve(packager), resolve(out)));
}
