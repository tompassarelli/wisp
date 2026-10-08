import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { Effect, Layer } from "effect";
import { UnitObject, encodeObjectData } from "../../scripts/objectData";
import { MapBuild } from "../../scripts/wisp/mapBuild";
import { SourceErrors } from "../../scripts/wisp/sourceErrors";
import { GameFiles } from "../../scripts/wisp/gameFiles";
import { RULER, RULER_UNIT } from "./layout";
import { fixtureModels } from "./models";

const [base, out] = process.argv.slice(2);
if (base === undefined || out === undefined) throw new Error("usage: bun test/animation58/build.ts BASE.w3m OUT.w3x");
const root = resolve(import.meta.dir, "../..");
const services = MapBuild.layer({
  projectRoot: root,
  configPath: join(import.meta.dir, "tsconfig.json"),
  bundlePath: join(root, "build/animation58/map.lua"),
  compileInputs: [import.meta.dir, join(root, "src"), join(root, "plugins")],
  packager: join(root, "build/tools/map-pack"),
  toolchainLockPath: join(root, "typescript-toolchain.lock"),
  packageDirectory: root,
}).pipe(
  Layer.provideMerge(SourceErrors.layer({ sourceMapDirectory: join(root, "build/animation58/source-maps"), filePrefix: "animation" })),
  Layer.provide(GameFiles.layer()),
);

const models = join(root, "build/animation58/models");
mkdirSync(models, { recursive: true });
const imports = [...fixtureModels()].map(([entry, bytes]) => {
  const source = join(models, entry.slice(entry.lastIndexOf("\\") + 1));
  writeFileSync(source, bytes);
  return { entry, source };
});
const units = [new UnitObject(RULER_UNIT, "hfoo").name("Wisp ruler").model(RULER).scale(1).build()];

await Effect.runPromise(MapBuild.use(maps => maps.build({
  base: resolve(base),
  out: resolve(out),
  name: "Wisp Rulers",
  declaration: {
    author: "Wisp",
    description: "Draws twenty-six animation and effect cases as rulers seen from above.",
    suggestedPlayers: "2",
    players: [{ id: 0, name: "Player 1" }, { id: 1, name: "Player 2" }],
    forces: [{ name: "Players", playerIds: [0, 1] }],
  },
  objectData: [{ entry: "war3map.w3u", contents: encodeObjectData(units, false) }],
  imports,
})).pipe(Effect.provide(services)));
