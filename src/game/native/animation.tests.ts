import { f32 } from "../../sim/f32";
import { assertEquals, test } from "../../runtime/testing";
import { type AnimationSequence, animationSample } from "./animation";

function same(actual: readonly unknown[], expected: readonly unknown[], message = ""): void {
  assertEquals(actual.length, expected.length, `${message} length`);
  for (let index = 0; index < expected.length; index++) assertEquals(actual[index], expected[index], `${message} [${index}]`);
}
const shows = (actual: { readonly sequence: number; readonly frame: number }, sequenceIndex: number, frame: number, message = "") =>
  same([actual.sequence, actual.frame], [sequenceIndex, frame], message);

const sequence = (name: string, start: number, end: number, looping = true, rarity = 0): AnimationSequence => ({ name, start, end, looping, rarity });

test("animation: a name the model lacks shows Stand, and on a model with no Stand its first sequence, never no sequence, so a Birth-and-Death missile asked for stand shows Birth, not every track at its default", () => {
  const missile = [sequence("Birth", 0, 1500, false), sequence("Death", 2000, 3267, false)];
  const at = (animation: string | number, elapsed: number) => animationSample(missile, { animation, subAnimations: [], elapsed }, "effect");
  shows(at("stand", f32(0.5)), 0, 499, "stand on a missile with Birth and Death only");
  shows(at("stand", 3), 0, 1500, "stand held at Birth's end after it");
  shows(at("walk", 0), 0, 0, "a name the model lacks");
  shows(at(99, 0), 0, 0, "an index the model lacks");
  shows(at("death", f32(0.25)), 1, 2249, "a name the model has");
  const withStand = [sequence("Birth", 0, 1500, false), sequence("Stand", 2000, 3000), sequence("Death", 4000, 5000, false)];
  shows(animationSample(withStand, { animation: "walk", subAnimations: [], elapsed: 0 }, "effect"), 1, 2000, "a name the model lacks, with a Stand");
  shows(animationSample([], { animation: "stand", subAnimations: [], elapsed: 0 }, "effect"), -1, 0, "a model with no sequences");
});
