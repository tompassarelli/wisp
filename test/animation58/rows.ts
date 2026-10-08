import { type AnimationSequence, type SavedAnimation, type SequenceSample, animationSample, blendWeight, globalSequenceFrame } from "../../src/headless/animation";
import type { EffectPose, UnitPose } from "../../src/headless/client";
import { CLIP, CLIP_SEQUENCES, GLOBAL_LENGTH, RULER, RULER_SEQUENCES, RULER_UNIT, type RulerSequence, SLOTS, needleDx } from "./layout";

const table = (sequences: readonly RulerSequence[]): AnimationSequence[] =>
  sequences.map(({ name, start, end, looping }) => ({ name, start, end, looping, rarity: 0 }));
const RULER_TABLE = table(RULER_SEQUENCES);
const CLIP_TABLE = table(CLIP_SEQUENCES);

/** Where a sample puts the needle: no sequence leaves every track at its default, the ruler's origin. */
function needle(sequences: readonly RulerSequence[], sample: SequenceSample): [number, number] {
  const sequence = sequences[sample.sequence];
  if (sequence === undefined) return [0, 0];
  return [needleDx(sequence.keys, sample.frame - sequence.start), sequence.lane];
}

const saved = (pose: EffectPose | UnitPose): SavedAnimation => ({
  animation: pose.animation, subAnimations: pose.subAnimations, elapsed: pose.animationElapsed, sought: pose.animationSought, ticks: pose.animationTicks,
});

const round = (value: number) => Math.floor(value + 0.5);

/**
 * One case's row: the needle's X and Y offsets and the global marker's X
 * offset, in world units from the ruler's origin, with the model stretched by
 * `scale` along X and Y.
 */
function row(name: string, pose: EffectPose | UnitPose, kind: "effect" | "unit", clip: boolean, scale: readonly [number, number]): string {
  const sequences = clip ? CLIP_SEQUENCES : RULER_SEQUENCES;
  const samples = clip ? CLIP_TABLE : RULER_TABLE;
  let [dx, dy] = needle(sequences, animationSample(samples, saved(pose), kind));
  const blend = pose.animationBlend;
  const weight = blendWeight(pose);
  if (blend !== undefined && weight > 0) {
    const [fromDx, fromDy] = needle(sequences, animationSample(samples, blend.from, kind));
    dx = (1 - weight) * dx + weight * fromDx;
    dy = (1 - weight) * dy + weight * fromDy;
  }
  const gx = globalSequenceFrame(pose.animationClock, GLOBAL_LENGTH) / 2;
  return `${name}=${round(dx * scale[0])},${round(dy * scale[1])},${round(gx * scale[0])}`;
}

/** What the headless rules show on every ruler, found by its model and origin, in SLOTS order. */
export function animationRows(effects: readonly EffectPose[], units: readonly UnitPose[]): string[] {
  const rows: string[] = [];
  for (const slot of SLOTS) {
    const effect = effects.find((pose) => (pose.model === RULER || pose.model === CLIP) && pose.x === slot.x && pose.y === slot.y);
    const unit = units.find((pose) => pose.typeId === RULER_UNIT && pose.x === slot.x && pose.y === slot.y);
    // An effect at scale 0 draws nothing.
    if (effect !== undefined && effect.scale === 0) rows.push(`${slot.name}=gone`);
    else if (effect !== undefined) {
      const stretch: [number, number] = [effect.scale * effect.matrixScale[0], effect.scale * effect.matrixScale[1]];
      rows.push(row(slot.name, effect, "effect", effect.model === CLIP, stretch));
    } else if (unit !== undefined) rows.push(row(slot.name, unit, "unit", false, [1, 1]));
    else rows.push(`${slot.name}=gone`);
  }
  return rows;
}
