import { type AnimationSequence, type SequenceSample, selectSequence, sequenceFrame } from "../../src/headless/animation";
import { FRAME_MS } from "../../src/headless/frameRate";
import type { DrawnPose } from "../render/renderScene";

const length = (sequence: AnimationSequence | undefined) => sequence === undefined ? 0 : Math.max(0, sequence.end - sequence.start);

/**
 * What a destroyed effect shows on `frame`, as Warcraft draws it: its Death sequence once and then it is gone, or, with no Death, the rest of the
 * sequence it was playing (its Birth and then its Stand, or the animation it was set to) once and then it is gone.
 * Undefined means the effect draws as usual, "gone" that it has played out.
 */
export function destroyedSample(pose: DrawnPose, sequences: readonly AnimationSequence[], frame: number): SequenceSample | "gone" | undefined {
  if (pose.destroyed === undefined) return undefined;
  const death = selectSequence(sequences, "death");
  if (length(sequences[death]) > 0) {
    const ms = Math.max(0, frame - pose.destroyed) * FRAME_MS;
    const sequence = sequences[death];
    return sequence === undefined || ms >= length(sequence) ? "gone" : { sequence: death, frame: sequenceFrame(sequence, ms, false) };
  }
  const elapsed = pose.animationElapsed * 1000;
  if (pose.animation !== undefined) return elapsed >= length(sequences[selectSequence(sequences, pose.animation, pose.subAnimations)]) ? "gone" : undefined;
  const birth = selectSequence(sequences, "birth");
  const stand = selectSequence(sequences, "stand");
  return elapsed >= length(sequences[birth]) + length(sequences[stand === birth ? -1 : stand]) ? "gone" : undefined;
}
