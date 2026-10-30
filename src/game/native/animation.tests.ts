import { f32 } from "../../sim/f32";
import { floorMod } from "../../sim/intMath";
import { assertEquals, assertTrue, test } from "../../runtime/testing";
import { advanceAnimation, type AnimationSequence, type AnimationState, animationSample, blendWeight, freshAnimation, seekAnimation, selectAnimation, settleAnimation } from "./animation";

function same(actual: readonly unknown[], expected: readonly unknown[], message = ""): void {
  assertEquals(actual.length, expected.length, `${message} length`);
  for (let index = 0; index < expected.length; index++) assertEquals(actual[index], expected[index], `${message} [${index}]`);
}
const shows = (actual: { readonly sequence: number; readonly frame: number }, sequenceIndex: number, frame: number, message = "") =>
  same([actual.sequence, actual.frame], [sequenceIndex, frame], message);

const sequence = (name: string, start: number, end: number, looping = true, rarity = 0): AnimationSequence => ({ name, start, end, looping, rarity });
test("[property seed 58] animation: an effect never told what to play shows Birth once, then Stand looping; a unit shows Stand", () => {
  let seed = 58;
  const next = (below: number) => {
    seed = floorMod(seed * 75 + 74, 65537);
    return floorMod(seed, below);
  };
  for (let run = 0; run < 300; run++) {
    const birthLength = next(2) === 0 ? 125 * (1 + next(12)) : 1 + next(1500);
    const standLength = 1 + next(2500);
    const hasBirth = next(3) !== 0;
    const hasStand = next(5) !== 0;
    const standLooping = next(2) === 0;
    const model: AnimationSequence[] = [sequence("Attack", 100, 600, false), sequence("Death", 700, 1700, false)];
    if (hasStand) model.splice(next(model.length + 1), 0, sequence("Stand", 3000, 3000 + standLength, standLooping));
    if (hasBirth) model.splice(next(model.length + 1), 0, sequence("Birth", 9000, 9000 + birthLength, false));
    const standIndex = hasStand ? model.findIndex((own) => own.name === "Stand") : 0;
    const stand = model[standIndex] ?? model[0]!;
    const birthIndex = model.findIndex((own) => own.name === "Birth");
    // Whole 1/256 s steps keep every sample time exact in binary32; a quarter of the samples fall where Birth ends, when a step does.
    const steps = floorMod(birthLength, 125) === 0 && next(4) === 0 ? birthLength * 32 / 125 : next(4096);
    const ms = steps * 1000 / 256;
    const at = `run ${run} at ${ms} ms`;
    const below = (clock: number) => Math.max(0, Math.ceil(clock) - 1);
    const standFrame = (from: number, looping: boolean) => stand.start + (looping ? floorMod(below(from), stand.end - stand.start) : Math.min(below(from), stand.end - stand.start));
    const effect = animationSample(model, { animation: undefined, subAnimations: [], elapsed: steps / 256 }, "effect");
    if (hasBirth && ms < birthLength) shows(effect, birthIndex, 9000 + below(ms), `${at}: an effect's Birth`);
    else shows(effect, standIndex, standFrame(hasBirth ? ms - birthLength : ms, true), `${at}: an effect's Stand, or its first sequence without one, loops even when the model says not to`);
    shows(animationSample(model, { animation: undefined, subAnimations: [], elapsed: steps / 256 }, "unit"), standIndex, standFrame(ms, stand.looping), `${at}: a unit's Stand, or its first sequence without one`);
  }
});

test("[spec wisp#2] animation: a clock on an exact millisecond draws the millisecond before it and a fractional clock its whole millisecond; zero draws the start, a lap's end the lap's last millisecond, and a held sequence its end", () => {
  const model = [sequence("Stand", 0, 244669), sequence("Attack", 3000, 3500, false), sequence("Walk", 1000, 2000)];
  const at = (animation: string, elapsed: number) => animationSample(model, { animation, subAnimations: [], elapsed }, "effect");
  shows(at("Stand", f32(237.585)), 0, 237584, "a timeline seek to 237.585 s");
  shows(at("Stand", f32(237.60167)), 0, 237601, "a timeline seek to 237.60167 s");
  shows(at("Walk", f32(0.4)), 2, 1399, "a seek to 0.4 s");
  shows(at("Walk", f32(0.4005)), 2, 1400, "a seek to 0.4005 s");
  shows(at("Walk", 0), 2, 1000, "a seek to 0");
  shows(at("Walk", 1), 2, 1999, "one whole lap");
  shows(at("Attack", f32(0.25)), 1, 3249, "a seek to 0.25 s");
  shows(at("Attack", 2), 1, 3500, "past a non-looping end");
});

test("animation: a pose settled when read matches one advanced every frame, and a blend keeps the old pose and fades it over the blend time, through selections, seeks, time scales and blends", () => {
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
      for (let draw = 0; draw < draws; draw++) {
        const fading = eager.animationBlend;
        const remaining = fading?.remaining ?? 0;
        advanceAnimation(eager, timeScale, seconds);
        const fade = f32(f32(timeScale * seconds) * 1000);
        if (fading !== undefined && fade !== 0) {
          assertEquals(fading.remaining, f32(remaining - fade), `run ${run} command ${command} draw ${draw} fade`);
          assertEquals(eager.animationBlend, fading.remaining > 0 ? fading : undefined, `run ${run} command ${command} draw ${draw} blend ends`);
        }
        const weight = blendWeight(eager);
        const blend = eager.animationBlend;
        assertEquals(weight, blend === undefined || eager.animationBlendTime <= 0 ? 0 : Math.min(1, blend.remaining / (eager.animationBlendTime * 1000)), `run ${run} command ${command} weight`);
        assertTrue(weight >= 0 && weight <= 1);
      }
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
        const running = eager.animationBlend;
        const [from, elapsed, drawn] = [eager.animation, eager.animationElapsed, eager.animationClock * 1000 >= 1];
        selectAnimation(eager, animation, undefined, restart);
        const blend = eager.animationBlend;
        const at = `run ${run} command ${command} select`;
        if (running !== undefined) assertTrue(blend === running);
        else if (blendTime > 0 && from !== undefined && drawn) same([blend?.from.animation, blend?.from.elapsed, blend?.remaining], [from, elapsed, f32(blendTime * 1000)], `${at}: a blend keeps the old pose`);
        else assertEquals(blend, undefined, `${at}: no blend`);
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
