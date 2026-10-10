import { type AnimationSequence, animationSample, type SavedAnimation } from "../../../src/headless/animation";
import { FRAME_MS } from "../../../src/headless/frameRate";

const STEP_MS = FRAME_MS;

export interface EmitterRenderer {
  update(delta: number): void;
  rendererData: { frame: number; animation: number; animationInfo: { Interval: ArrayLike<number> } };
}

export function advanceEmitters(renderer: EmitterRenderer, intervals: readonly { Interval: ArrayLike<number> }[], sequences: readonly AnimationSequence[], animation: SavedAnimation, kind: "effect" | "unit", clock: number, elapsed: number): number {
  const emitted = elapsed - STEP_MS;
  while (clock < emitted) {
    const delta = Math.min(STEP_MS, emitted - clock);
    const at = animationSample(sequences, { ...animation, elapsed: (clock + delta) / 1000 }, kind);
    if (at.sequence >= 0) {
      const data = renderer.rendererData;
      data.animation = at.sequence; data.animationInfo = intervals[at.sequence] ?? data.animationInfo;

      data.frame = at.frame - delta;
    }
    renderer.update(delta);
    clock += delta;
  }
  return clock;
}
