import { assertEquals, assertFalse, assertLessThan, assertTrue, test } from "../runtime/testing";
import {
  AUTO_DELAY, CLEAN_SECONDS, DEFAULT_DELAY, ERROR_SECONDS, ERROR_WINDOW_SECONDS, type MatchSecond, agreedDelay, autoDelay, chosenDelay, connectionPoor,
  correctDelay, correctedDelay, delayCorrection, delayPolicy, nextDelay, observeRtt, oneWayFrames, rttEstimate, smoothedRttMs, stepManualDelay, timeSyncWait,
} from "./delay";
import { SATURATED_BUSY_MS, machineRate, noteMachineSecond, saturatedSecond, secondFps } from "./rate";

const WINDOW = 7;
const CEILING = 100;

function settledEstimate(rttMs: number) {
  const estimate = rttEstimate();
  for (let sample = 0; sample < 64; sample++) observeRtt(estimate, rttMs);
  return estimate;
}

const settledDelay = (rttMs: number): number => autoDelay(delayPolicy(WINDOW, CEILING), settledEstimate(rttMs));

const quiet: MatchSecond = { held: 0, arrivals: 60, deep: 0 };
const noisy: MatchSecond = { held: 3, arrivals: 60, deep: 0 };

test("input delay covers the trip beyond the 4 frame rollback budget with no ceiling short of the policy's: 100 and 200 ms play at 2 frames, 300 ms at 5, 500 ms at 11, 1000 ms at 26 and 2000 ms at 56", () => {
  assertEquals(delayPolicy(WINDOW, CEILING).budget, 4);
  assertEquals(settledDelay(100), 2);
  assertEquals(settledDelay(200), 2);
  assertEquals(settledDelay(300), 5);
  assertEquals(settledDelay(500), 11);
  assertEquals(settledDelay(1000), 26);
  assertEquals(settledDelay(2000), 56);
  assertLessThan(settledDelay(2000), CEILING);
  assertEquals(settledDelay(100000), CEILING);
});

test("the rollback budget never exceeds the window less one frame, and a policy ceiling never sits under its floor", () => {
  assertEquals(delayPolicy(3, CEILING).budget, 2);
  assertEquals(delayPolicy(7, 0).ceiling, DEFAULT_DELAY);
});

test("the round trip estimate is an integer EWMA in eighths: the first sample sets it, later samples move it by an eighth of the gap, and samples clamp to 0 to 10000 ms", () => {
  const estimate = rttEstimate();
  assertEquals(autoDelay(delayPolicy(WINDOW, CEILING), estimate), DEFAULT_DELAY);
  observeRtt(estimate, 80);
  assertEquals(smoothedRttMs(estimate), 80);
  observeRtt(estimate, 160);
  assertEquals(estimate.smoothed8, 640 + 160 - 80);
  assertEquals(smoothedRttMs(estimate), 90);
  observeRtt(estimate, 999999);
  assertEquals(estimate.samples, 3);
  observeRtt(estimate, -5);
  assertEquals(estimate.samples, 4);
  assertEquals(oneWayFrames(100), 3);
  assertEquals(oneWayFrames(0), 0);
  assertEquals(oneWayFrames(34), 2);
});

test("the delay lowers only once the round trip is 34 ms under the level that holds the current delay, and raises at once", () => {
  const policy = delayPolicy(WINDOW, CEILING);
  const estimate = settledEstimate(500);
  assertEquals(nextDelay(policy, estimate, 2), 11);
  assertEquals(nextDelay(policy, estimate, 11), 11);
  assertEquals(nextDelay(policy, estimate, 12), 12);
  const better = settledEstimate(460);
  assertEquals(autoDelay(policy, better), 10);
  assertEquals(nextDelay(policy, better, 11), 11);
  const clearlyBetter = settledEstimate(430);
  assertEquals(autoDelay(policy, clearlyBetter), 9);
  assertEquals(nextDelay(policy, clearlyBetter, 11), 10);
  assertEquals(nextDelay(policy, rttEstimate(), 6), DEFAULT_DELAY);
  assertTrue(connectionPoor(policy, settledEstimate(500), 2));
  assertFalse(connectionPoor(policy, settledEstimate(100), 2));
  assertFalse(connectionPoor(policy, rttEstimate(), 2));
});

test("the host's delay overrides Auto for everyone, Auto agrees on the highest request, and stepping a manual delay stays within the policy", () => {
  const policy = delayPolicy(WINDOW, CEILING);
  assertEquals(agreedDelay([2, 26, 11]), 26);
  assertEquals(agreedDelay([]), DEFAULT_DELAY);
  assertEquals(chosenDelay([3, 26], AUTO_DELAY), 26);
  for (const manual of [0, 2, 70, CEILING]) assertEquals(chosenDelay([3, 26], manual), manual);
  assertEquals(stepManualDelay(policy, AUTO_DELAY, 26, 1), 27);
  assertEquals(stepManualDelay(policy, 0, 26, -1), 0);
  assertEquals(stepManualDelay(policy, CEILING, 26, 1), CEILING);
});

test("time sync waits only after a full interval with an advantage of two frames or more", () => {
  assertFalse(timeSyncWait(5, 3, 59));
  assertTrue(timeSyncWait(5, 3, 60));
  assertFalse(timeSyncWait(4, 3, 60));
});

test("the correction rises after 3 errored seconds in 5, falls after 30 clean seconds, and holds the ping delay as a floor", () => {
  const policy = delayPolicy(WINDOW, CEILING);
  const correction = delayCorrection(policy);
  for (let second = 0; second < ERROR_WINDOW_SECONDS; second++) correctDelay(policy, correction, 4, second < ERROR_SECONDS ? noisy : quiet);
  assertEquals(correction.value, 5);
  assertEquals(correctedDelay(policy, correction, 3), 5);
  assertEquals(correctedDelay(policy, correction, 9), 9);
  for (let second = 0; second < ERROR_WINDOW_SECONDS; second++) correctDelay(policy, correction, 4, second < ERROR_SECONDS - 1 ? noisy : quiet);
  assertEquals(correction.value, 5);
  const settled = delayCorrection(policy);
  settled.value = 6;
  for (let second = 0; second < CLEAN_SECONDS - 1; second++) correctDelay(policy, settled, 6, quiet);
  assertEquals(settled.value, 6);
  correctDelay(policy, settled, 6, quiet);
  assertEquals(settled.value, 5);
});

test("a machine is slow after 2 saturated seconds under 55 fps and fast again after 2 seconds that are not", () => {
  const rate = machineRate();
  assertEquals(secondFps(0, 0), 60);
  assertEquals(secondFps(300, 5), 60);
  assertEquals(secondFps(109, 2), 55);
  assertTrue(saturatedSecond(54, SATURATED_BUSY_MS));
  assertFalse(saturatedSecond(54, SATURATED_BUSY_MS - 1));
  assertFalse(saturatedSecond(55, SATURATED_BUSY_MS));
  noteMachineSecond(rate, 40, 900);
  assertFalse(rate.slow);
  noteMachineSecond(rate, 40, 900);
  assertTrue(rate.slow);
  assertEquals(rate.fps, 40);
  noteMachineSecond(rate, 60, 100);
  assertTrue(rate.slow);
  noteMachineSecond(rate, 40, 900);
  noteMachineSecond(rate, 60, 100);
  assertTrue(rate.slow);
  noteMachineSecond(rate, 60, 100);
  assertFalse(rate.slow);
});
