// Draws the #58 fixture's capture frame headlessly, client 0's view, so the
// reader can be tried on it before a native capture:
// `bun test/animation58/render.ts OUT_DIR`, then read OUT_DIR's PNG.
import * as BunRuntime from "@effect/platform-bun/BunRuntime";
import { Console, Effect } from "effect";
import { installHeadless } from "../../scripts/wisp/headless";
import { captureScene, renderScenes } from "../../scripts/wisp/headlessRender";
import { ANIMATION_NOOPS } from "./cases";
import { CAPTURE_FRAME, RULER, RULER_DEATH_SECONDS, RULER_UNIT } from "./layout";
import { install, start } from "./main";
import { fixtureModels } from "./models";

const program = (directory: string | undefined) => Effect.gen(function*() {
  if (directory === undefined) return yield* Effect.die("usage: bun test/animation58/render.ts OUT_DIR");
  const runtime = installHeadless({ filePrefix: "animation", globalPrefixes: ["__animation58"], intentionalNoops: ANIMATION_NOOPS });
  const clients = runtime.clients({ install, start }, [0, 1], { effectDeaths: (model) => (model === RULER ? RULER_DEATH_SECONDS : undefined) });
  clients.start();
  clients.frames(CAPTURE_FRAME);
  const client = clients.clients[0];
  if (client === undefined) return yield* Effect.die("no client");
  const scene = captureScene(client);
  runtime.restore();
  const models = fixtureModels();
  const images = yield* renderScenes({ readAsset: async (path) => models.get(path), unitModels: { [RULER_UNIT]: RULER }, width: 1920, height: 1080 }, [scene], directory);
  for (const image of images) yield* Console.log(`${directory}/${image.image}`);
});

BunRuntime.runMain(program(process.argv[2]));
