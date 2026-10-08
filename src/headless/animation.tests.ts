// One test per animation playback rule in wisp:docs/warsmash-notes.md,
// "Animation playback", run in Bun and in 32-bit Lua.
import { assertEquals, assertTrue, test } from "../runtime/testing";
import {
  advanceAnimation, type AnimationSequence, animationSample, blendWeight, freshAnimation, globalSequenceFrame, seekAnimation,
  selectAnimation, selectSequence, sequenceFrame,
} from "./animation";

/** Element by element, since assertEquals compares arrays by identity. */
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
  assertEquals(animationSample(MODEL, { animation: "walk", subAnimations: [], elapsed: 0, sought: 0, ticks: 0 }, "unit").sequence, 2, "a name that selects nothing shows Stand");
});

test("animation: an index outside the model selects no sequence", () => {
  assertEquals(selectSequence(MODEL, 4), 4);
  assertEquals(selectSequence(MODEL, 8), -1);
  assertEquals(selectSequence(MODEL, -1), -1);
  assertEquals(animationSample(MODEL, { animation: 8, subAnimations: [], elapsed: 0.5, sought: 0, ticks: 2 }, "unit").sequence, -1);
});

test("animation: selecting restarts the sequence clock and keeps the global clock", () => {
  const state = freshAnimation();
  selectAnimation(state, "stand");
  advanceAnimation(state, 1, 0.5);
  selectAnimation(state, "attack slam");
  same([state.animation, state.animationElapsed, state.animationSought, state.animationTicks, state.animationClock], ["attack slam", 0, 0, 0, 0.5]);
});

test("animation: time scale multiplies the clock, and zero freezes it, the global clock and the blend", () => {
  const state = freshAnimation();
  selectAnimation(state, "stand");
  advanceAnimation(state, 2, 0.0625);
  same([state.animationElapsed, state.animationTicks, state.animationClock], [0.125, 1, 0.125]);
  state.animationBlendTime = 0.125;
  selectAnimation(state, "attack slam");
  advanceAnimation(state, 0, 0.0625);
  same([state.animationElapsed, state.animationTicks, state.animationClock, blendWeight(state)], [0, 0, 0.125, 1]);
});

test("animation: a seek sets the sequence time without spending blend time", () => {
  const state = freshAnimation();
  state.animationBlendTime = 0.125;
  selectAnimation(state, "stand");
  advanceAnimation(state, 1, 0.0625);
  selectAnimation(state, "attack slam");
  seekAnimation(state, 0.25);
  same([state.animationElapsed, state.animationSought, state.animationTicks, blendWeight(state)], [0.25, 0.25, 0, 1]);
  const { animation, subAnimations, animationElapsed: elapsed, animationSought: sought, animationTicks: ticks } = state;
  assertEquals(animationSample(MODEL, { animation, subAnimations, elapsed, sought, ticks }, "unit").frame, 4250);
});

test("animation: the sample is the clock's whole millisecond", () => {
  assertEquals(sequenceFrame(sequence("Stand", 2000, 3000), 0, 15.75, 1), 2015);
  assertEquals(sequenceFrame(sequence("Stand", 2000, 3000), 0.5, 0, 0), 2000);
});

test("animation: a looping sequence restarts at its start on reaching the end minus 1 ms, dropping the overshoot", () => {
  const loop = sequence("Stand", 0, 101);
  // 25 ms steps reach 100 on the fourth step, which restarts at 0.
  same([1, 2, 3, 4, 5, 9].map((ticks) => sequenceFrame(loop, 0, ticks * 25, ticks)), [25, 50, 75, 0, 25, 25]);
  assertEquals(sequenceFrame(loop, 100, 0, 0), 0, "a seek to the end shows the start");
  assertEquals(sequenceFrame(loop, 50, 75, 3), 25, "from a seek, the first lap is shorter");
});

test("animation: a sequence that does not loop holds its end minus 1 ms", () => {
  const once = sequence("Attack", 4000, 5000, false);
  assertEquals(sequenceFrame(once, 0, 2000, 60), 4999);
  assertEquals(sequenceFrame(once, 1500, 0, 0), 4999, "a seek past the end holds too");
  assertEquals(sequenceFrame(once, 0.5, 0, 0), 4000);
});

test("animation: an effect never told what to play shows Birth once, then Stand looping; a unit shows Stand", () => {
  const playing = (seconds: number, ticks: number) => ({ animation: undefined, subAnimations: [], elapsed: seconds, sought: 0, ticks });
  shows(animationSample(MODEL, playing(0.25, 2), "effect"), 6, 6250);
  // 125 ms steps: Birth's last frame, 6499, is reached on the fourth step, which starts Stand.
  shows(animationSample(MODEL, playing(0.5, 4), "effect"), 2, 2000);
  shows(animationSample(MODEL, playing(0.75, 6), "effect"), 2, 2250);
  shows(animationSample(MODEL, playing(0.25, 2), "unit"), 2, 2250);
  const stopping = [sequence("Birth", 0, 100, false), sequence("Stand", 1000, 1100, false)];
  shows(animationSample(stopping, playing(0.25, 10), "effect"), 1, 1050, "an effect's Stand loops even when the model says not to");
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
