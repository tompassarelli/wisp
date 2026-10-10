import { assertEquals, assertTrue, test } from "../runtime/testing";
import { f32 } from "../sim/f32";
import {
  advanceAnimation, type AnimationSequence, animationSample, blendWeight, freshAnimation, globalSequenceFrame, seekAnimation,
  selectAnimation, selectSequence, sequenceFrame,
} from "./animation";

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

test("animation: a name selects its tags exactly, not a longer name containing it", () => {
  assertEquals(selectSequence(MODEL, "stand"), 2, "plain Stand, the most common variant, not Stand Hit");
  assertEquals(selectSequence(MODEL, "stand hit"), 0);
  assertEquals(selectSequence(MODEL, "Stand,Ready"), 3);
  assertEquals(selectSequence(MODEL, "ANIM_TYPE_STAND", ["SUBANIM_TYPE_READY"]), 3, "sub-animations add tags");
  assertEquals(selectSequence(MODEL, "attack slam"), 4);
});

test("animation: a missing tag set falls back to the closest set, then to the primary tag's plainest sequence", () => {
  assertEquals(selectSequence(MODEL, "attack slam fast"), 4, "most shared tags");
  assertEquals(selectSequence(MODEL, "death hit"), 7, "no shared tag: plainest death");
  assertEquals(selectSequence(MODEL, "walk"), -1, "no walk sequence selects nothing");
  assertEquals(animationSample(MODEL, { animation: "walk", subAnimations: [], elapsed: 0 }, "unit").sequence, 2, "a name that selects nothing shows Stand");
});

// An out-of-range sequence index shows Stand.
test("animation: an index outside the model shows Stand", () => {
  assertEquals(selectSequence(MODEL, 4), 4);
  assertEquals(selectSequence(MODEL, 8), -1);
  assertEquals(selectSequence(MODEL, -1), -1);
  shows(animationSample(MODEL, { animation: 8, subAnimations: [], elapsed: 0 }, "unit"), 2, 2000);
});

test("animation: selecting restarts the sequence clock and keeps the global clock", () => {
  const state = freshAnimation();
  selectAnimation(state, "stand");
  advanceAnimation(state, 1, 0.5);
  selectAnimation(state, "attack slam");
  same([state.animation, state.animationElapsed, state.animationClock], ["attack slam", 0, 0.5]);
});

test("animation: time scale multiplies the clock, and zero freezes it, the global clock and the blend", () => {
  const state = freshAnimation();
  selectAnimation(state, "stand");
  advanceAnimation(state, 2, 0.0625);
  same([state.animationElapsed, state.animationClock], [0.125, 0.125]);
  state.animationBlendTime = 0.125;
  selectAnimation(state, "attack slam");
  advanceAnimation(state, 0, 0.0625);
  same([state.animationElapsed, state.animationClock, blendWeight(state)], [0, 0.125, 1]);
});

test("animation: a seek sets the sequence time without spending blend time", () => {
  const state = freshAnimation();
  state.animationBlendTime = 0.125;
  selectAnimation(state, "stand");
  advanceAnimation(state, 1, 0.0625);
  selectAnimation(state, "attack slam");
  seekAnimation(state, 0.25);
  same([state.animationElapsed, blendWeight(state)], [0.25, 1]);
  const { animation, subAnimations, animationElapsed: elapsed } = state;
  assertEquals(animationSample(MODEL, { animation, subAnimations, elapsed }, "unit").frame, 4250);
});

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

test("animation: the sample is the clock's whole millisecond", () => {
  assertEquals(sequenceFrame(sequence("Stand", 2000, 3000), 15.75), 2015);
  assertEquals(sequenceFrame(sequence("Stand", 2000, 3000), 0.5), 2000);
});

// Looping playback keeps overshoot; dropping each lap's overshoot accumulates drift.

test("animation: a looping sequence wraps by its length, keeping the overshoot", () => {
  const loop = sequence("Stand", 1000, 1101);
  same([25, 100, 101, 225, 4500].map((ms) => sequenceFrame(loop, ms)), [1025, 1100, 1000, 1023, 1056]);
  assertEquals(sequenceFrame(loop, 150), 1049, "a seek past the end wraps too");
});

// Non-looping playback holds the final key pose.
test("animation: a sequence that does not loop holds its interval end", () => {
  const once = sequence("Attack", 4000, 5000, false);
  assertEquals(sequenceFrame(once, 2000), 5000);
  assertEquals(sequenceFrame(once, 999.5), 4999);
  assertEquals(sequenceFrame(once, 0.5), 4000);
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

test("animation: global sequences run on whole milliseconds of animation time, wrapped by their length", () => {
  assertEquals(globalSequenceFrame(3.5, 3333), 167);
  assertEquals(globalSequenceFrame(0.0625, 50), 12);
  assertEquals(globalSequenceFrame(5, 0), 0);
});
