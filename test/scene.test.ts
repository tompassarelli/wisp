import { expect, test } from "bun:test";
import { join } from "node:path";
import { Effect } from "effect";
import { SceneReportFile } from "../scripts/wisp/playerView";
import { mapCompiler, report } from "../scripts/compiler";
import { type SceneExpectations, sceneProblems } from "../scripts/wisp/scene";

const root = join(import.meta.dir, "..");

const expectations: SceneExpectations = {
  kinds: [
    { name: "stage deck", models: ["war3mapImported\\Deck.mdx"] },
    { name: "spark", models: ["Abilities\\Spark.mdx"], lifetime: 8 },
    { name: "trap", models: ["Abilities\\Trap.mdx"], lifetime: 600 },
    { name: "flash", models: ["Gone.mdx"], lifetime: 30 },
    { name: "puff", models: ["Abilities\\Puff.mdx"], lifetime: 12 },
    { name: "smoke", models: ["Abilities\\Smoke.mdx"], lifetime: 30 },
    { name: "hero", models: ["Units\\Hero.mdx"] },
  ],
  stage: { kind: "stage deck", pieces: 1 },
  framesPerSecond: 60,
};

test("[spec docs/player-view.md] the emitted scene recorder reports each model's effects, and the host names what a player would see wrong", async () => {
  expect(report(mapCompiler(join(import.meta.dir, "tsconfig.scene.json"))())).toBe("");
  const run = Bun.spawnSync([process.env.LUA ?? "lua", join(import.meta.dir, "scene-stub.lua"), join(root, "build/scene-tests/map.lua")], { cwd: root, stdout: "pipe", stderr: "pipe" });
  expect({ code: run.exitCode, stderr: run.stderr.toString() }).toEqual({ code: 0, stderr: "" });
  const scene = await Effect.runPromise(SceneReportFile.decode("fixture-scene-p0.txt", run.stdout.toString()));
  expect(scene).toEqual({
    serial: 6,
    frame: 101,
    effects: 9,
    models: [
      { model: "", live: 1, inView: 1, drawn: 1, created: 0, age: 101, longest: 101, destroyed: 0 },

      { model: "Abilities/Puff.mdx", live: 1, inView: 0, drawn: 0, created: 29, age: undefined, longest: 10, destroyed: 0 },

      { model: "Abilities/Smoke.mdx", live: 1, inView: 0, drawn: 0, created: 29, age: undefined, longest: 38, destroyed: 0 },
      { model: "Abilities/Spark.mdx", live: 1, inView: 0, drawn: 0, created: 0, age: undefined, longest: 9, destroyed: 0 },
      { model: "Abilities/Trap.mdx", live: 1, inView: 1, drawn: 0, created: 0, age: 101, longest: 101, destroyed: 0 },
      { model: "Flat.mdx", live: 3, inView: 3, drawn: 1, created: 0, age: 101, longest: 101, destroyed: 0 },
      { model: "Gone.mdx", live: 0, inView: 0, drawn: 0, created: undefined, age: undefined, longest: 90, destroyed: 1 },

      { model: "Units/Hero.mdx", live: 2, inView: 2, drawn: 1, created: 0, age: 101, longest: 101, destroyed: 0 },
      { model: "war3mapImported/Deck.mdx", live: 1, inView: 1, drawn: 1, created: 0, age: 101, longest: 101, destroyed: 0 },
    ],
  });
  expect(sceneProblems(scene, expectations).map(({ seen }) => seen)).toEqual([
    "invisible effects: 1 effects were created with no model, 1 of them meant to be drawn now",
    "a smoke stayed in view for 0.63 s; it should be gone within 0.50 s",
    "a spark stayed in view for 0.15 s; it should be gone within 0.13 s",
    "3 effects in view that the game declares no kind for, the oldest for 1.68 s",
    "a flash stayed in view for 1.50 s; it should be gone within 0.50 s",
  ]);
});
