import { type AnimationSequence, animationSample, type SavedAnimation } from "../../../src/headless/animation";

const STEP_MS = 1000 / 60;

/** The parts of war3-model's renderer that emitter stepping reaches into. */
export interface EmitterRenderer {
  update(delta: number): void;
  rendererData: { frame: number; animation: number; animationInfo: { Interval: ArrayLike<number> } };
}

/**
 * Steps a model's particle and ribbon emitters from `clock` to one 60 Hz frame behind `elapsed` (both ms since the
 * effect started), posing the model at each step's own time, and returns the new clock.
 * Natively a 50/s emitter has no particle two frames after it starts, a 60/s one has one, and a squirt keyed at
 * frame 33 has not fired by 33.3 ms.
 */
export function advanceEmitters(renderer: EmitterRenderer, intervals: readonly { Interval: ArrayLike<number> }[], sequences: readonly AnimationSequence[], animation: SavedAnimation, kind: "effect" | "unit", clock: number, elapsed: number): number {
  const emitted = elapsed - STEP_MS;
  while (clock < emitted) {
    const delta = Math.min(STEP_MS, emitted - clock);
    const at = animationSample(sequences, { ...animation, elapsed: (clock + delta) / 1000 }, kind);
    if (at.sequence >= 0) {
      const data = renderer.rendererData;
      data.animation = at.sequence; data.animationInfo = intervals[at.sequence] ?? data.animationInfo;
      // update() adds delta before it poses nodes and emits, so the step runs at its own time.
      data.frame = at.frame - delta;
    }
    renderer.update(delta);
    clock += delta;
  }
  return clock;
}
