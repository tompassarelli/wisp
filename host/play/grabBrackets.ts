import type { Frame } from "../contract/services";

const CHANNEL_STEP = 40;
export const MIN_CHANGED = 300;
const SKIPPED_FRAME = 1.5;
const HARNESS_PAUSE_MS = 2;
export const SIM_FRAME_MS = 1000 / 60;
const FOLLOW_GRABS = 10;

export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** One screen grab. The compositor answers a grab with the next frame it draws, so `afterNs` stamps that frame to within the time grim takes to hand it over. */
export interface Sample {
  readonly frame: Frame;
  readonly beforeNs: number;
  readonly afterNs: number;
}

export interface AnswerGrab {
  readonly overheadMs: number;
  readonly waitMs: number;
}

export interface GrabCost {
  readonly count: number;
  readonly overheadP50Ms: number;
  readonly overheadMaxMs: number;
  readonly waitP50Ms: number;
  readonly twoFrameGaps: number;
}

export interface FollowRow {
  readonly threshold: number;
  readonly flashGrab: number;
  readonly pressMs: number | undefined;
  readonly framesAfterFlash: number | undefined;
  readonly changedByGrab: readonly number[];
}

/** Pixels in `rect` whose largest channel step between the two frames exceeds `CHANNEL_STEP`. */
export function changedPixels(reference: Frame, frame: Frame, rect: Rect): number {
  let count = 0;
  for (let row = rect.y; row < Math.min(rect.y + rect.height, reference.height); row++) {
    for (let column = rect.x; column < Math.min(rect.x + rect.width, reference.width); column++) {
      const index = (row * reference.width + column) * 3;
      const step = Math.max(
        Math.abs(reference.rgb[index]! - frame.rgb[index]!),
        Math.abs(reference.rgb[index + 1]! - frame.rgb[index + 1]!),
        Math.abs(reference.rgb[index + 2]! - frame.rgb[index + 2]!),
      );
      if (step > CHANNEL_STEP) count++;
    }
  }
  return count;
}

export interface Response {
  readonly reference: number;
  readonly index: number;
  readonly changed: number;
  readonly lowerMs: number;
  readonly upperMs: number;
  readonly bracketMs: number;
}

/**
 * The first grab after the press whose `region` passes `threshold` changed pixels, against the last grab drawn before the press.
 * The change appeared in a frame after the previous grab's and no later than this grab's, so it lies between their stamps:
 * a bracket one display frame wide when the grabs caught consecutive frames, wider when the harness missed some.
 */
export function response(samples: readonly Sample[], region: Rect, threshold: number, pressNs: number): Response | undefined {
  const reference = samples.findLastIndex((sample) => sample.afterNs <= pressNs);
  if (reference < 0) return undefined;
  for (let index = reference + 1; index < samples.length; index++) {
    const sample = samples[index]!;
    const changed = changedPixels(samples[reference]!.frame, sample.frame, region);
    if (changed <= threshold) continue;
    const previous = samples[index - 1]!;
    return {
      reference, index, changed,
      lowerMs: Math.max(0, previous.afterNs - pressNs) / 1e6,
      upperMs: (sample.afterNs - pressNs) / 1e6,
      bracketMs: (sample.afterNs - previous.afterNs) / 1e6,
    };
  }
  return undefined;
}


export interface Shown {
  readonly lowerMs: number;
  readonly upperMs: number;
  readonly skippedVblanks: number;
}

export function shown(samples: readonly Sample[], found: Response, frameMs: number): Shown | undefined {
  if (found.bracketMs < SKIPPED_FRAME * frameMs) return { lowerMs: found.lowerMs, upperMs: found.upperMs, skippedVblanks: 0 };
  if ((samples[found.index]!.beforeNs - samples[found.index - 1]!.afterNs) / 1e6 > HARNESS_PAUSE_MS) return undefined;
  return { lowerMs: Math.max(0, found.upperMs - frameMs), upperMs: found.upperMs, skippedVblanks: Math.max(1, Math.round(found.bracketMs / frameMs) - 1) };
}

export function displayFrameMs(samples: readonly Sample[]): number {
  const gaps = samples.slice(1).map((sample, index) => (sample.afterNs - samples[index]!.afterNs) / 1e6);
  const single = gaps.filter((gap) => gap < SKIPPED_FRAME * SIM_FRAME_MS);
  return percentile(single.length > 0 ? single : gaps, 0.5);
}

export function followRow(samples: readonly Sample[], follow: Rect, flash: Response, pressNs: number, frameMs: number, threshold: number): FollowRow {
  const reference = samples[flash.reference]!.frame;
  const changedByGrab = samples.slice(flash.reference + 1, flash.reference + 1 + FOLLOW_GRABS).map((sample) => changedPixels(reference, sample.frame, follow));
  const found = response(samples, follow, threshold, pressNs);
  const seen = found === undefined ? undefined : shown(samples, found, frameMs);
  return {
    threshold,
    flashGrab: flash.index - flash.reference,
    pressMs: seen === undefined ? undefined : (seen.lowerMs + seen.upperMs) / 2,
    framesAfterFlash: found !== undefined && seen !== undefined ? Math.round((samples[found.index]!.afterNs - samples[flash.index]!.afterNs) / 1e6 / frameMs) : undefined,
    changedByGrab,
  };
}

export const percentile = (values: readonly number[], fraction: number) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(fraction * sorted.length) - 1))] ?? Number.NaN;
};

export function changeWatch(rect: Rect, threshold: number) {
  let checked = 0;
  let seen = false;
  return (samples: readonly Sample[], pressNs: number | undefined) => {
    if (seen || pressNs === undefined) return seen;
    const reference = samples.findLastIndex((sample) => sample.afterNs <= pressNs);
    if (reference < 0) return false;
    for (let index = Math.max(checked, reference + 1); index < samples.length && !seen; index++) seen = changedPixels(samples[reference]!.frame, samples[index]!.frame, rect) > threshold;
    checked = samples.length;
    return seen;
  };
}

export const answerGrab = (samples: readonly Sample[], index: number): AnswerGrab => ({
  overheadMs: (samples[index]!.beforeNs - samples[index - 1]!.afterNs) / 1e6,
  waitMs: (samples[index]!.afterNs - samples[index]!.beforeNs) / 1e6,
});

export function grabCost(samples: readonly Sample[], frameMs: number): GrabCost {
  const overheads = samples.slice(1).map((sample, index) => (sample.beforeNs - samples[index]!.afterNs) / 1e6);
  const gaps = samples.slice(1).map((sample, index) => (sample.afterNs - samples[index]!.afterNs) / 1e6);
  return {
    count: samples.length,
    overheadP50Ms: percentile(overheads, 0.5), overheadMaxMs: Math.max(...overheads),
    waitP50Ms: percentile(samples.map((sample) => (sample.afterNs - sample.beforeNs) / 1e6), 0.5),
    twoFrameGaps: gaps.filter((gap) => gap > SKIPPED_FRAME * Math.min(frameMs, SIM_FRAME_MS)).length,
  };
}
