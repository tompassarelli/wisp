import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { Effect, Layer } from "effect";
import { MapBuild } from "../../host/compile/mapBuild";
import { SourceErrors } from "../../host/compile/sourceErrors";
import { GameFiles } from "../../host/io/gameFiles";
import { blackTexture, encodeGreyBlp, twinTexture } from "../glow6/textures";
import { bodies } from "./body";
import { posedGlow, replicaMdl } from "./derive";
import { BLACK_TEXTURE, BODY_OFF, BODY_ON, REPLICAS, SHOTS, TWIN_TEXTURE, replicaPath } from "./layout";
import { FIXED_MDL, encodeMdl } from "./models";
import { phaseScenes } from "./scenes";

const [base, bodyOff, source, out] = process.argv.slice(2);
if (base === undefined || bodyOff === undefined || source === undefined || out === undefined) throw new Error("usage: bun test/glow6e/build.ts BASE.w3m GLOW_FREE_BODY.mdx GLOW_SOURCE.mdx OUT.w3x");
const root = resolve(import.meta.dir, "../..");
const services = MapBuild.layer({
  projectRoot: root,
  configPath: join(import.meta.dir, "tsconfig.json"),
  bundlePath: join(root, "build/glow6e/map.lua"),
  compileInputs: [import.meta.dir, join(root, "src"), join(root, "plugins"), join(root, "test/glow6")],
  packager: join(root, "build/tools/map-pack"),
  toolchainLockPath: join(root, "typescript-toolchain.lock"),
  packageDirectory: root,
}).pipe(
  Layer.provideMerge(SourceErrors.layer({ sourceMapDirectory: join(root, "build/glow6e/source-maps"), filePrefix: "glow6e" })),
  Layer.provide(GameFiles.layer()),
);

const body = bodies(bodyOff, source);
const scenes = phaseScenes();
const replicas = SHOTS.flatMap((shot) => {
  const scene = scenes.get(`on-${shot.frame}`);
  if (scene === undefined) throw new Error(`no on-${shot.frame} scene`);
  const glow = posedGlow(body.onModel, body.geoset, scene);
  return REPLICAS.map((replica) => [replicaPath(replica, shot.frame), encodeMdl(replicaMdl(glow, replica, shot.frame))] as const);
});
const assets = join(root, "build/glow6e/assets");
mkdirSync(assets, { recursive: true });
const files = new Map<string, Uint8Array>([
  ...Object.entries(FIXED_MDL).map(([path, text]) => [path, encodeMdl(text)] as const), ...replicas,
  [BODY_ON, body.on], [BODY_OFF, body.off], [TWIN_TEXTURE, encodeGreyBlp(twinTexture())], [BLACK_TEXTURE, encodeGreyBlp(blackTexture())],
]);
const imports = [...files].map(([entry, bytes]) => {
  const file = join(assets, entry.slice(entry.lastIndexOf("\\") + 1));
  writeFileSync(file, bytes);
  return { entry, source: file };
});
await Effect.runPromise(MapBuild.use(maps => maps.build({
  base: resolve(base),
  out: resolve(out),
  name: "Wisp Glow Replica",
  declaration: {
    author: "Wisp",
    description: "Shows team-glow plane replicas, a fighter body with and without its glow, and a billboarded twin, in turn, on black.",
    suggestedPlayers: "2",
    players: [{ id: 0, name: "Player 1" }, { id: 1, name: "Player 2" }],
    forces: [{ name: "Players", playerIds: [0, 1] }],
  },
  objectData: [],
  imports,
})).pipe(Effect.provide(services)));
