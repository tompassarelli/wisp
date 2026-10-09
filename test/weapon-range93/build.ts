import { join, resolve } from "node:path";
import { Effect, Layer } from "effect";
import { MapBuild } from "../../scripts/wisp/mapBuild";
import { SourceErrors } from "../../scripts/wisp/sourceErrors";
import { GameFiles } from "../../scripts/wisp/gameFiles";

import { weaponRangeObjects } from "./objects";

const [base, out] = process.argv.slice(2);
if (base === undefined || out === undefined) throw new Error("usage: bun test/weapon-range93/build.ts BASE.w3m OUT.w3x");
const root = resolve(import.meta.dir, "../..");
const services = MapBuild.layer({
  projectRoot: root,
  configPath: join(import.meta.dir, "tsconfig.json"),
  bundlePath: join(root, "build/weapon-range93/map.lua"),
  compileInputs: [import.meta.dir, join(root, "src"), join(root, "plugins")],
  packager: join(root, "build/tools/map-pack"),
  toolchainLockPath: join(root, "typescript-toolchain.lock"),
  packageDirectory: root,
}).pipe(
  Layer.provideMerge(SourceErrors.layer({ sourceMapDirectory: join(root, "build/weapon-range93/source-maps"), filePrefix: "weapon-range93" })),
  Layer.provide(GameFiles.layer()),
);

await Effect.runPromise(MapBuild.use(maps => maps.build({
  base: resolve(base),
  out: resolve(out),
  name: "Wisp Weapon Range",
  objectData: [{ entry: "war3map.w3u", contents: weaponRangeObjects() }],
  declaration: {
    author: "Wisp",
    description: "Measures two weapon indices with near, gap and far targets.",
    suggestedPlayers: "2",
    players: [{ id: 0, name: "Player 1" }, { id: 1, name: "Player 2" }],
    forces: [{ name: "Players", playerIds: [0, 1] }],
  },
})).pipe(Effect.provide(services)));
