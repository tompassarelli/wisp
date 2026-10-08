import { expect } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
import { freshAnimation } from "../src/headless/animation";
import { renderScenes, type DrawnPose, type RenderScene } from "../scripts/wisp/headlessRender";
import { farmTest } from "../scripts/wisp/farmTest";
import { generateMDX, parseMDL } from "../vendor/war3-model.mjs";

farmTest("[repro #83] a visible Popcorn emitter fails the Definitive render and records its sampled world position and scale", async () => {
  const model = new Uint8Array(generateMDX(parseMDL(`Version { FormatVersion 1800, }
Model "Popcorn repro" { BlendTime 0, MinimumExtent { 0, 0, 0 }, MaximumExtent { 0, 0, 0 }, BoundsRadius 0, }
Sequences 1 { Anim "Birth" { Interval { 0, 1000 }, NonLooping, MinimumExtent { 0, 0, 0 }, MaximumExtent { 0, 0, 0 }, BoundsRadius 0, } }
Helper "Parent" { ObjectId 0, Translation 1 { DontInterp, 0: { 4, 5, 6 }, } Scaling 1 { DontInterp, 0: { 2, 3, 4 }, } }
ParticleEmitterPopcorn "Frost" {
  ObjectId 1, Parent 0,
  static LifeSpan 1, static EmissionRate 10, static Alpha 1, static Speed 0, static Color { 1, 1, 1 }, ReplaceableId 0,
  Path "Effects\\Frost.pkfx",
  AnimVisibilityGuide "",
  Visibility 2 { DontInterp, 0: 0, 100: 1, }
}
PivotPoints 2 { { 0, 0, 0 }, { 1, 2, 3 }, }`)));
  const pose: DrawnPose = { ...freshAnimation(), handle: { kind: "effect", id: 1 }, model: "popcorn.mdx", created: 0, x: 10, y: 20, z: 30, alpha: 255, scale: 2, timeScale: 1, queuedAnimations: [], yaw: Math.PI / 2, pitch: 0, roll: 0, color: [255, 255, 255], teamColor: 1, matrixScale: [3, 1, 2], flat: false };
  const base: RenderScene = { frame: 3, client: 0, effects: [{ ...pose, animationElapsed: 0.05 }], units: [], ui: [], camera: { x: 0, y: 0, fields: { CAMERA_FIELD_ROTATION: 90, CAMERA_FIELD_ANGLE_OF_ATTACK: 270, CAMERA_FIELD_TARGET_DISTANCE: 100 } }, environment: { sky: "", skyVisible: false, terrainVisible: false, dayNight: { terrain: "", unit: "" }, timeOfDay: 12 } };
  const directory = await mkdtemp(join(tmpdir(), "wisp-popcorn-"));
  try {
    const failure = await Effect.runPromise(Effect.flip(renderScenes({ readAsset: async () => model, width: 64, height: 64 }, [base, { ...base, frame: 9, effects: [{ ...pose, animationElapsed: 0.15 }] }], directory, "definitive")));
    expect(String(failure.cause)).toContain('p0 frame 9: popcorn.mdx: undrawn Popcorn emitter "Frost" (Effects\\Frost.pkfx)');
    const hidden = JSON.parse(await readFile(join(directory, "p0-frame-3.json"), "utf8"));
    expect(hidden.popcornEmitters).toEqual([]);
    const visible = JSON.parse(await readFile(join(directory, "p0-frame-9.json"), "utf8"));
    expect(visible.popcornEmitters).toHaveLength(1);
    const emitter = visible.popcornEmitters[0];
    expect({ model: emitter.model, emitter: emitter.emitter, effect: emitter.effect, handle: emitter.handle }).toEqual({ model: "popcorn.mdx", emitter: "Frost", effect: "Effects\\Frost.pkfx", handle: 1 });
    for (const [got, want] of emitter.position.map((value: number, axis: number) => [value, [-12, 56, 102][axis]])) expect(got).toBeCloseTo(want, 4);
    expect(emitter.scale).toEqual([12, 6, 16]);
    const report = JSON.parse(await readFile(join(directory, "render.json"), "utf8"));
    expect(report.images[0].notDrawn).toEqual([]);
    expect(report.images[1].notDrawn).toHaveLength(1);
  } finally { await rm(directory, { recursive: true, force: true }); }
}, 120_000);
