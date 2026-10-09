import { expect, test } from "bun:test";
import { join } from "node:path";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { Cause, Effect, Exit, Layer } from "effect";
import { Clients } from "../scripts/wisp/clients";
import { GameFiles } from "../scripts/wisp/gameFiles";
import { SceneReportFile, checkPlayerView } from "../scripts/wisp/playerView";
import { mapCompiler, report } from "../scripts/compiler";
import { type Frame, colorRows, decodePpm, encodePpm, frameProblems, measureFrame, pixelShare } from "../scripts/wisp/frameProbe";
import { type SceneExpectations, type SceneReport, sceneProblems } from "../scripts/wisp/scene";

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

test("[spec docs/player-view.md] a stage drawn with an empty model is a missing stage", () => {
  const scene: SceneReport = { serial: 1, frame: 30, effects: 4, models: [
    { model: "", live: 3, inView: 3, drawn: 3, created: 0, age: 30, longest: 30, destroyed: 0 },
    { model: "Units/Hippogryph.mdx", live: 1, inView: 1, drawn: 1, created: 0, age: 30, longest: 30, destroyed: 0 },
  ] };
  const empty = { ...expectations, kinds: [{ name: "stage deck", models: [""] }, ...expectations.kinds.slice(1)] };
  expect(sceneProblems(scene, empty)).toEqual([
    { seen: "no stage under the fighters: 0 of the 1 stage deck pieces a match needs are drawn", evidence: "the game declares no stage deck model" },
    { seen: "invisible stage deck: 3 effects were created with no model, 3 of them meant to be drawn now", evidence: "model path is empty" },
    { seen: "1 effect in view that the game declares no kind for, the oldest for 0.50 s", evidence: "model Units/Hippogryph.mdx, 1 drawn" },
  ]);
  const drawn = { ...scene, models: [{ model: "war3mapImported/Deck.mdx", live: 3, inView: 3, drawn: 3, created: 0, age: 30, longest: 30, destroyed: 0 }] };
  expect(sceneProblems(drawn, expectations)).toEqual([]);
});

test("[invariant] a frame probe counts rows of the declared colours by pixel measurement", () => {
  const width = 100;
  const height = 50;
  const rgb = new Uint8Array(width * height * 3).fill(200);

  for (let y = 30; y < 35; y++) for (let x = 20; x < 80; x++) if (x !== 50) rgb.set([50, 60, 70], (y * width + x) * 3);
  for (let x = 0; x < 10; x++) rgb.set([50, 60, 70], (40 * width + x) * 3);
  const frame: Frame = { width, height, rgb };
  expect(decodePpm(encodePpm(frame))).toEqual(frame);
  const band = { top: 0.5, bottom: 1, left: 0, right: 1 };
  expect(colorRows(frame, band, [[48, 58, 68]], 4, 0.5)).toBe(5);
  expect(colorRows(frame, band, [[48, 58, 68]], 1, 0.5)).toBe(0);
  expect(pixelShare(frame, { top: 0, bottom: 0.5, left: 0, right: 1 }, (red) => red === 200)).toBe(1);
  const features = [{ name: "deck rows", absent: "no stage", measure: (seen: Frame) => {
    const rows = colorRows(seen, band, [[48, 58, 68]], 4, 0.5);
    return { present: rows >= 6, measured: `${rows} rows, needs 6` };
  } }];
  expect(frameProblems(measureFrame(frame, features))).toEqual([{ seen: "no stage", evidence: "deck rows: 5 rows, needs 6" }]);
});

test("[spec docs/player-view.md] the player-view check reads each client's settled scene report and keeps its captured frame", async () => {
  const documents = mkdtempSync(join(tmpdir(), "wisp-player-view-"));
  try {
    mkdirSync(join(documents, "CustomMapData"));
    const reportText = (frame: number, deck: string) => `function PreloadFiles takes nothing returns nothing\r\n\tcall PreloadStart()\r\n\tcall Preload( "scene 4 frame ${frame} effects 3" )\r\n\tcall Preload( "model 3 3 3 0 ${frame} ${frame} 0 ${deck}" )\r\n\tcall PreloadEnd( 0.0 )\r\n\r\nendfunction\r\n`;
    const sky = new Uint8Array(4 * 4 * 3).fill(200);
    const client = { name: "a", documents };
    const fail = () => Effect.die("unused");
    const clients = Layer.succeed(Clients, Clients.of({ all: [client], capture: () => Effect.succeed({ width: 4, height: 4, rgb: sky }), read: fail, words: fail, click: fail, keys: fail, typeText: fail, batch: fail }));
    const expected = {
      filePrefix: "fixture",
      scene: { ...expectations, settledFrame: 30 },
      frame: [{ name: "sky", absent: "no sky", measure: (frame: Frame) => ({ present: pixelShare(frame, { top: 0, bottom: 1, left: 0, right: 1 }, (red) => red === 200) === 1, measured: "all sky" }) }],
    };
    const check = checkPlayerView(expected, 0, join(documents, "frames")).pipe(Effect.provide(Layer.merge(clients, GameFiles.layer())));
    writeFileSync(join(documents, "CustomMapData/fixture-scene-p1.txt"), reportText(31, ""));
    const failed = await Effect.runPromiseExit(check);
    expect(Exit.isFailure(failed) ? Cause.pretty(failed.cause) : "passed").toContain("a: a player would see\n  - no stage under the fighters");
    writeFileSync(join(documents, "CustomMapData/fixture-scene-p1.txt"), reportText(31, "war3mapImported/Deck.mdx"));
    expect(Exit.isSuccess(await Effect.runPromiseExit(check))).toBe(true);
    expect(decodePpm(await Bun.file(join(documents, "frames/a.ppm")).bytes())).toEqual({ width: 4, height: 4, rgb: sky });
  } finally {
    rmSync(documents, { recursive: true });
  }
});
