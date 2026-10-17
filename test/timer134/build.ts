import { join, resolve } from "node:path";
import { Effect, Layer } from "effect";
import { MapBuild } from "../../host/compile/mapBuild";
import { SourceErrors } from "../../host/compile/sourceErrors";
import { GameFiles } from "../../host/io/gameFiles";

const [base, out] = process.argv.slice(2);
if (base === undefined || out === undefined) throw new Error("usage: bun test/timer134/build.ts BASE.w3m OUT.w3x");
const root = resolve(import.meta.dir, "../..");
const services = MapBuild.layer({
  projectRoot: root,
  configPath: join(import.meta.dir, "tsconfig.json"),
  bundlePath: join(root, "build/timer134/map.lua"),
  compileInputs: [import.meta.dir, join(root, "src"), join(root, "plugins")],
  packager: join(root, "build/tools/map-pack"),
  toolchainLockPath: join(root, "typescript-toolchain.lock"),
  packageDirectory: root,
}).pipe(
  Layer.provideMerge(SourceErrors.layer({ sourceMapDirectory: join(root, "build/timer134/source-maps"), filePrefix: "timer134" })),
  Layer.provide(GameFiles.layer()),
);

await Effect.runPromise(MapBuild.use(maps => maps.build({
  base: resolve(base),
  out: resolve(out),
  name: "Wisp Timer 134",
  declaration: {
    author: "Wisp",
    description: "wisp#134 1/60 s periodic timer deadlines.",
    suggestedPlayers: "1",
    players: [{ id: 0, name: "Player 1" }],
    forces: [{ name: "Players", playerIds: [0] }],
  },
})).pipe(Effect.provide(services)));
