import { expect, test } from "bun:test";
import { freshAnimation } from "../src/game/native/animation";
import type { DrawnPose, PopcornEmitterPose, UnsupportedEmitterPose } from "../host/render/headlessRender";
import { emitterInventory, undrawnEmitters } from "../host/render/emitterInventory";
import { boundsModel, posedSampler } from "../host/render/screenBounds";
import { transform } from "../host/render/screen";
import { generateMDX, ModelRenderer, parseMDL, parseMDX } from "../vendor/war3-model.mjs";

test("[scenario wisp#121 provisional] a ribbon's Death visibility key leaves Birth and Stand visible and hides Death", () => {
  const model = parseMDX(generateMDX(parseMDL(`Version { FormatVersion 800, }
Model "Death-only ribbon visibility" { BlendTime 0, MinimumExtent { 0, 0, 0 }, MaximumExtent { 0, 0, 0 }, BoundsRadius 0, }
Sequences 3 {
  Anim "Birth" { Interval { 0, 300 }, NonLooping, MinimumExtent { 0, 0, 0 }, MaximumExtent { 0, 0, 0 }, BoundsRadius 0, }
  Anim "Stand" { Interval { 400, 700 }, MinimumExtent { 0, 0, 0 }, MaximumExtent { 0, 0, 0 }, BoundsRadius 0, }
  Anim "Death" { Interval { 800, 1100 }, NonLooping, MinimumExtent { 0, 0, 0 }, MaximumExtent { 0, 0, 0 }, BoundsRadius 0, }
}
RibbonEmitter "Ribbon" {
  ObjectId 0,
  static HeightAbove 10, static HeightBelow 10, static Alpha 1, static Color { 1, 1, 1 }, static TextureSlot 0,
  Visibility 1 { DontInterp, 900: 0, }
  EmissionRate 10, LifeSpan 1, Rows 1, Columns 1, MaterialID 0,
}
PivotPoints 1 { { 0, 0, 0 }, }`)));
  for (const [sequence, emitted] of [[0, 1], [1, 1], [2, 0]] as const) {
    const renderer = new ModelRenderer(model);
    renderer.setSequence(sequence);
    renderer.update(100);
    const ribbon = Reflect.get(renderer, "ribbonsController").emitters[0];
    expect(ribbon.creationTimes).toHaveLength(emitted);
    expect(ribbon.vertices === null ? 0 : ribbon.vertices.length).toBe(emitted * 6);
  }
});

test("[boundary MDX #75 P9.1] every Popcorn and version-1 emitter is named, and visible unsupported emitters fail", () => {
  const model = parseMDX(generateMDX(parseMDL(`Version { FormatVersion 1800, }
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
ParticleEmitter "Cinder" {
  ObjectId 2, Parent 0, static EmissionRate 10, static Gravity 0, static Longitude 0, static Latitude 0,
  Visibility 2 { DontInterp, 0: 0, 100: 1, }
  Particle { static LifeSpan 1, static InitVelocity 0, Path "Effects\\Cinder.mdx", }
}
PivotPoints 3 { { 0, 0, 0 }, { 1, 2, 3 }, { 1, 2, 3 }, }`)));
  const pose: DrawnPose = { ...freshAnimation(), handle: { kind: "effect", id: 1 }, model: "popcorn.mdx", created: 0, x: 10, y: 20, z: 30, alpha: 255, scale: 2, timeScale: 1, queuedAnimations: [], yaw: Math.PI / 2, pitch: 0, roll: 0, color: [255, 255, 255], teamColor: 1, matrixScale: [3, 1, 2], flat: false };
  const inventory = (animationElapsed: number) => {
    const posed = { ...pose, animationElapsed };
    const popcornEmitters: PopcornEmitterPose[] = [], unsupportedEmitters: UnsupportedEmitterPose[] = [];
    emitterInventory(posed, model, posedSampler(posed, boundsModel(model)), transform(posed), popcornEmitters, unsupportedEmitters);
    return { popcornEmitters, unsupportedEmitters, notDrawn: undrawnEmitters(unsupportedEmitters) };
  };
  const hidden = inventory(0.05);
  expect(hidden.popcornEmitters).toEqual([]);
  expect(hidden.notDrawn).toEqual([]);
  expect(hidden.unsupportedEmitters.map(({ emitter, visible, supported }) => ({ emitter, visible, supported }))).toEqual([{ emitter: "Frost", visible: false, supported: true }, { emitter: "Cinder", visible: false, supported: false }]);
  const visible = inventory(0.15);
  expect(visible.popcornEmitters).toHaveLength(1);
  const emitter = visible.popcornEmitters[0]!;
  expect({ model: emitter.model, emitter: emitter.emitter, effect: emitter.effect, handle: emitter.handle }).toEqual({ model: "popcorn.mdx", emitter: "Frost", effect: "Effects\\Frost.pkfx", handle: 1 });
  for (const [got, want] of emitter.position.map((value, axis) => [value, [-12, 56, 102][axis] ?? 0] as const)) expect(got).toBeCloseTo(want, 4);
  expect(emitter.scale).toEqual([12, 6, 16]);
  expect(visible.unsupportedEmitters.filter(({ kind }) => kind === "popcorn").map(({ visible, supported }) => ({ visible, supported }))).toEqual([{ visible: true, supported: true }]);
  expect(visible.notDrawn).toEqual(['popcorn.mdx: undrawn version-1 model emitter "Cinder" (Effects\\Cinder.mdx)']);
  expect(visible.unsupportedEmitters.map(({ kind, visible }) => ({ kind, visible }))).toEqual([{ kind: "popcorn", visible: true }, { kind: "model particle", visible: true }]);
});
