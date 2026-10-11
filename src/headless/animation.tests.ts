import { f32 } from "../sim/f32";
import { floorMod } from "../sim/intMath";
import { assertEquals, assertTrue, test } from "../runtime/testing";
import { advanceAnimation, type AnimationSequence, type AnimationState, animationSample, blendWeight, freshAnimation, seekAnimation, selectAnimation, settleAnimation } from "./animation";

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

test("animation: a pose settled when read matches one advanced every frame, through selections, seeks, time scales and blends", () => {
  let seed = 126;
  const next = (below: number) => {
    seed = floorMod(seed * 75 + 74, 65537);
    return floorMod(seed, below);
  };
  const SCALES = [1, 0.5, 2, 0, -1, f32(1.7), f32(0.333)];
  const STEPS = [f32(1 / 60), f32(0.025), 0.0625, f32(0.1), f32(1 / 60)];
  const pose = (state: AnimationState) => [state.animation, state.animationElapsed, state.animationClock, state.animationRestartPending === true,
    state.animationBlend?.remaining, state.animationBlend?.from.animation, state.animationBlend?.from.elapsed];
  for (let run = 0; run < 200; run++) {
    const eager = freshAnimation();
    const lazy = freshAnimation();
    let timeScale = SCALES[next(SCALES.length)] ?? 1;
    let seconds = STEPS[next(STEPS.length)] ?? 0;
    let pending = 0;
    const settle = () => {
      settleAnimation(lazy, timeScale, seconds, pending);
      pending = 0;
    };
    for (let command = 0; command < 60; command++) {
      const draws = next(4) === 0 ? next(200) : next(5);
      for (let draw = 0; draw < draws; draw++) advanceAnimation(eager, timeScale, seconds);
      pending += draws;
      const choice = next(7);
      if (choice <= 1) {
        settle();
        same(pose(lazy), pose(eager), `run ${run} command ${command}`);
      } else if (choice === 2) {
        settle();
        const blendTime = [0, 0.125, 0.25, next(400) / 1000][next(4)] ?? 0;
        eager.animationBlendTime = blendTime;
        lazy.animationBlendTime = blendTime;
        const animation = next(2) === 0 ? "stand" : next(5);
        const restart = next(2) === 0;
        selectAnimation(eager, animation, undefined, restart);
        selectAnimation(lazy, animation, undefined, restart);
      } else if (choice === 3) {
        settle();
        const at = next(3000) / 1000;
        seekAnimation(eager, at);
        seekAnimation(lazy, at);
      } else if (choice === 4) {
        settle();
        timeScale = SCALES[next(SCALES.length)] ?? 1;
      } else if (choice === 5) {
        settle();
        seconds = STEPS[next(STEPS.length)] ?? 0;
      }
    }
    settle();
    same(pose(lazy), pose(eager), `run ${run} end`);
  }
});
