import { join, resolve } from "node:path";
import { Effect, Layer } from "effect";
import { MapBuild } from "../../host/compile/mapBuild";
import { SourceErrors } from "../../host/compile/sourceErrors";
import { GameFiles } from "../../host/io/gameFiles";

const [base, out] = process.argv.slice(2);
if (base === undefined || out === undefined) throw new Error("usage: bun test/relay-mark54/build.ts BASE.w3m OUT.w3x");
const root = resolve(import.meta.dir, "../..");
const services = MapBuild.layer({
  projectRoot: root,
  configPath: join(import.meta.dir, "tsconfig.json"),
  bundlePath: join(root, "build/relay-mark54/map.lua"),
  compileInputs: [import.meta.dir, join(root, "src"), join(root, "plugins")],
  packager: join(root, "build/tools/map-pack"),
  toolchainLockPath: join(root, "typescript-toolchain.lock"),
  packageDirectory: root,
}).pipe(
  Layer.provideMerge(SourceErrors.layer({ sourceMapDirectory: join(root, "build/relay-mark54/source-maps"), filePrefix: "relay-mark54" })),
  Layer.provide(GameFiles.layer()),
);

await Effect.runPromise(MapBuild.use(maps => maps.build({
  base: resolve(base),
  out: resolve(out),
  name: "Wisp Relay Mark 54",
  declaration: {
    author: "Wisp",
    description: "wisp#54: prints every WISP_RLY sync event with its player id, prefix, data and game time.",
    suggestedPlayers: "2",
    players: [{ id: 0, name: "Player 1" }, { id: 1, name: "Player 2" }, { id: 2, name: "Player 3" }],
    forces: [{ name: "Players", playerIds: [0, 1, 2] }],
  },
})).pipe(Effect.provide(services)));
