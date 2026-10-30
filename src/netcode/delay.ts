import { floorDiv } from "../sim/intMath";

// Integer milliseconds and frames only, so Bun and both Lua32 modes decide alike.

export const DEFAULT_DELAY = 2;
export const ROLLBACK_BUDGET = 4;
export const HIGH_DELAY_FRAMES = 8;
export const TIME_SYNC_INTERVAL = 60;

export interface DelayPolicy {
  readonly floor: number;
  readonly ceiling: number;
  readonly window: number;
  readonly budget: number;
}

export function delayPolicy(window: number, ceiling: number, budget: number = ROLLBACK_BUDGET, floor: number = DEFAULT_DELAY): DelayPolicy {
  return { floor, ceiling: Math.max(floor, ceiling), window, budget: Math.min(budget, window - 1) };
}

export interface RttEstimate {
  samples: number;
  smoothed8: number;
}

export const rttEstimate = (): RttEstimate => ({ samples: 0, smoothed8: 0 });

export function resetRtt(estimate: RttEstimate): void {
  estimate.samples = 0;
  estimate.smoothed8 = 0;
}

export function observeRtt(estimate: RttEstimate, rttMs: number): void {
  const sample = Math.max(0, Math.min(10000, Math.floor(rttMs)));
  estimate.smoothed8 = estimate.samples === 0 ? sample * 8 : estimate.smoothed8 + sample - floorDiv(estimate.smoothed8, 8);
  estimate.samples = Math.min(estimate.samples + 1, 1000000);
}

export const smoothedRttMs = (estimate: Readonly<RttEstimate>): number => floorDiv(estimate.smoothed8, 8);

export const oneWayFrames = (rttMs: number): number => Math.max(0, floorDiv(rttMs * 3 + 99, 100));

const clampDelay = (policy: DelayPolicy, delay: number): number => Math.min(policy.ceiling, Math.max(policy.floor, delay));

const delayForRtt = (policy: DelayPolicy, rttMs: number): number => clampDelay(policy, oneWayFrames(rttMs) - policy.budget);

export function autoDelay(policy: DelayPolicy, estimate: Readonly<RttEstimate>): number {
  return estimate.samples === 0 ? policy.floor : delayForRtt(policy, smoothedRttMs(estimate));
}

export function nextDelay(policy: DelayPolicy, estimate: Readonly<RttEstimate>, current: number): number {
  const target = autoDelay(policy, estimate);
  if (target >= current) return target;
  const lowered = estimate.samples === 0 ? target : delayForRtt(policy, smoothedRttMs(estimate) + 34);
  return lowered < current ? lowered : clampDelay(policy, current);
}

export function connectionPoor(policy: DelayPolicy, estimate: Readonly<RttEstimate>, delay: number): boolean {
  return estimate.samples > 0 && oneWayFrames(smoothedRttMs(estimate)) > policy.budget + delay;
}

export const highDelay = (delay: number): boolean => delay >= HIGH_DELAY_FRAMES;

export function agreedDelay(requests: readonly number[], fallback: number = DEFAULT_DELAY): number {
  let agreed = -1;
  for (const request of requests) agreed = Math.max(agreed, request);
  return agreed < 0 ? fallback : agreed;
}

export const AUTO_DELAY = -1;

export const chosenDelay = (requests: readonly number[], manual: number): number => manual === AUTO_DELAY ? agreedDelay(requests) : manual;

export function stepManualDelay(policy: DelayPolicy, manual: number, auto: number, direction: -1 | 1): number {
  const from = manual === AUTO_DELAY ? auto : manual;
  return Math.min(policy.ceiling, Math.max(0, from + direction));
}

export function timeSyncWait(localAdvantage: number, remoteAdvantage: number, framesSinceWait: number): boolean {
  return framesSinceWait >= TIME_SYNC_INTERVAL && localAdvantage - remoteAdvantage >= 2;
}

export const HELD_ERROR_CALLBACKS = 2;
export const DEEP_ERROR_PERCENT = 50;
export const CLEAN_DEEP_PERCENT = 5;
export const ERROR_WINDOW_SECONDS = 5;
export const ERROR_SECONDS = 3;
export const CLEAN_SECONDS = 30;

export interface DelayCorrection {
  value: number;
  windowSeconds: number;
  errorSeconds: number;
  cleanSeconds: number;
}

export interface MatchSecond {
  readonly held: number;
  readonly arrivals: number;
  readonly deep: number;
}

export const delayCorrection = (policy: DelayPolicy): DelayCorrection => ({ value: policy.floor, windowSeconds: 0, errorSeconds: 0, cleanSeconds: 0 });

export const erroredSecond = (second: MatchSecond): boolean =>
  second.held >= HELD_ERROR_CALLBACKS || second.deep * 100 > second.arrivals * DEEP_ERROR_PERCENT;

export const cleanSecond = (second: MatchSecond): boolean =>
  second.held === 0 && second.arrivals > 0 && second.deep * 100 <= second.arrivals * CLEAN_DEEP_PERCENT;

export function correctDelay(policy: DelayPolicy, correction: DelayCorrection, delay: number, second: MatchSecond): void {
  const errored = erroredSecond(second);
  correction.windowSeconds++;
  if (errored) correction.errorSeconds++;
  if (correction.windowSeconds >= ERROR_WINDOW_SECONDS) {
    if (correction.errorSeconds >= ERROR_SECONDS) correction.value = clampDelay(policy, Math.max(correction.value, delay) + 1);
    correction.windowSeconds = 0;
    correction.errorSeconds = 0;
  }
  correction.cleanSeconds = cleanSecond(second) ? correction.cleanSeconds + 1 : 0;
  if (correction.cleanSeconds < CLEAN_SECONDS) return;
  correction.cleanSeconds = 0;
  correction.value = clampDelay(policy, Math.min(correction.value, delay) - 1);
}

export const correctedDelay = (policy: DelayPolicy, correction: Readonly<DelayCorrection>, pingDelay: number): number =>
  clampDelay(policy, Math.max(pingDelay, correction.value));
