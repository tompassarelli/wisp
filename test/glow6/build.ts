import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { Effect, Layer } from "effect";
import { MapBuild } from "../../host/compile/mapBuild";
import { SourceErrors } from "../../host/compile/sourceErrors";
import { GameFiles } from "../../host/io/gameFiles";
import { BLACK_TEXTURE, TWIN_TEXTURE } from "./layout";
import { fixtureModels } from "./models";
import { blackTexture, encodeGreyBlp, twinTexture } from "./textures";

const [base, out] = process.argv.slice(2);
if (base === undefined || out === undefined) throw new Error("usage: bun test/glow6/build.ts BASE.w3m OUT.w3x");
const root = resolve(import.meta.dir, "../..");
const services = MapBuild.layer({
  projectRoot: root,
  configPath: join(import.meta.dir, "tsconfig.json"),
  bundlePath: join(root, "build/glow6/map.lua"),
  compileInputs: [import.meta.dir, join(root, "src"), join(root, "plugins")],
  packager: join(root, "build/tools/map-pack"),
  toolchainLockPath: join(root, "typescript-toolchain.lock"),
  packageDirectory: root,
}).pipe(
  Layer.provideMerge(SourceErrors.layer({ sourceMapDirectory: join(root, "build/glow6/source-maps"), filePrefix: "glow6" })),
  Layer.provide(GameFiles.layer()),
);

const assets = join(root, "build/glow6/assets");
mkdirSync(assets, { recursive: true });
const files = new Map<string, Uint8Array>([...fixtureModels(), [TWIN_TEXTURE, encodeGreyBlp(twinTexture())], [BLACK_TEXTURE, encodeGreyBlp(blackTexture())]]);
const imports = [...files].map(([entry, bytes]) => {
  const source = join(assets, entry.slice(entry.lastIndexOf("\\") + 1));
  writeFileSync(source, bytes);
  return { entry, source };
});
await Effect.runPromise(MapBuild.use(maps => maps.build({
  base: resolve(base),
  out: resolve(out),
  name: "Wisp Glow Quad",
  declaration: {
    author: "Wisp",
    description: "Shows a team-glow quad, its own-texture twin and neither, in turn, on a black board.",
    suggestedPlayers: "2",
    players: [{ id: 0, name: "Player 1" }, { id: 1, name: "Player 2" }],
    forces: [{ name: "Players", playerIds: [0, 1] }],
  },
  objectData: [],
  imports,
})).pipe(Effect.provide(services)));
