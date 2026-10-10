

import { assertEquals, assertTrue, test } from "../runtime/testing";
import { f32 } from "../sim/f32";
import { advanceAnimation, type AnimationSequence, animationSample, blendWeight, freshAnimation, seekAnimation, selectAnimation, sequenceFrame } from "./animation";


function same(actual: readonly unknown[], expected: readonly unknown[], message = ""): void {
  assertEquals(actual.length, expected.length, `${message} length`);
  for (let index = 0; index < expected.length; index++) assertEquals(actual[index], expected[index], `${message} [${index}]`);
}
const shows = (actual: { readonly sequence: number; readonly frame: number }, sequenceIndex: number, frame: number, message = "") =>
  same([actual.sequence, actual.frame], [sequenceIndex, frame], message);

const sequence = (name: string, start: number, end: number, looping = true, rarity = 0): AnimationSequence => ({ name, start, end, looping, rarity });
const MODEL = [
  sequence("Stand Hit", 0, 500),
  sequence("Stand - 2", 1000, 2000, true, 3),
  sequence("Stand", 2000, 3000),
  sequence("Stand Ready", 3000, 4000),
  sequence("Attack Slam", 4000, 5000, false),
  sequence("Attack - 1", 5000, 6000, false),
  sequence("Birth", 6000, 6500, false),
  sequence("Death", 7000, 8000, false),
];

// Effect selection and seek in one callback show the restarted clock; later seeks persist.

test("animation: [native #58] an effect selection resets a same-frame seek on the next drawn frame", () => {
  for (const frozenBefore of [false, true]) {
    const state = freshAnimation();
    advanceAnimation(state, 1, 0.5);
    if (frozenBefore) advanceAnimation(state, 0, 0.5);
    selectAnimation(state, "walk", undefined, true);
    seekAnimation(state, 0.25);
    advanceAnimation(state, 0, 1 / 60);
    assertEquals(state.animationElapsed, 0, "the pending selection restarts after the callback's seek");
    seekAnimation(state, f32(0.4));
    advanceAnimation(state, 0, 1 / 60);
    assertEquals(state.animationElapsed, f32(0.4), "a seek after the selection was drawn persists while frozen");
  }
});

// Looping playback keeps overshoot; dropping each lap's overshoot accumulates drift.

test("animation: a looping sequence wraps by its length, keeping the overshoot", () => {
  const loop = sequence("Stand", 1000, 1101);
  same([25, 100, 101, 225, 4500].map((ms) => sequenceFrame(loop, ms)), [1025, 1100, 1000, 1023, 1056]);
  assertEquals(sequenceFrame(loop, 150), 1049, "a seek past the end wraps too");
});

test("animation: an effect never told what to play shows Birth once, then Stand looping; a unit shows Stand", () => {
  const playing = (seconds: number) => ({ animation: undefined, subAnimations: [], elapsed: seconds });
  shows(animationSample(MODEL, playing(0.25), "effect"), 6, 6250);

  shows(animationSample(MODEL, playing(0.5), "effect"), 2, 2000);
  shows(animationSample(MODEL, playing(0.75), "effect"), 2, 2250);
  shows(animationSample(MODEL, playing(0.25), "unit"), 2, 2250);
  const stopping = [sequence("Birth", 0, 100, false), sequence("Stand", 1000, 1100, false)];
  shows(animationSample(stopping, playing(0.25), "effect"), 1, 1050, "an effect's Stand loops even when the model says not to");
});

test("animation: a blend keeps the old pose and fades it over the blend time of animation", () => {
  const state = freshAnimation();
  state.animationBlendTime = 0.125;
  selectAnimation(state, "stand");
  selectAnimation(state, "attack slam");
  assertTrue(state.animationBlend === undefined);
  advanceAnimation(state, 1, 0.0625);
  selectAnimation(state, "stand");
  assertEquals(state.animationBlend?.from.animation, "attack slam", "an animated unit saves its pose");
  assertEquals(state.animationBlend?.from.elapsed, 0.0625);
  advanceAnimation(state, 0.5, 0.0625);
  assertEquals(blendWeight(state), 0.75);
  selectAnimation(state, "death");
  same([state.animationBlend?.from.animation, blendWeight(state)], ["attack slam", 0.75], "a switch during a blend leaves it running");
  advanceAnimation(state, 1, 0.09375);
  assertTrue(state.animationBlend === undefined);
  state.animationBlendTime = 0;
  selectAnimation(state, "stand");
  assertTrue(state.animationBlend === undefined);
});
