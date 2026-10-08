import { expect, test } from "bun:test";
import { captureDistribution, parseFrameCostCapture } from "../scripts/wisp/frameCostCapture";
import { frameCostCaptureReadings, parseNativeReadings } from "../scripts/wisp/nativeFit";
import { writtenPreloadFile } from "../scripts/wisp/headlessInput";
import { frameCostCaptureHeading, frameCostCaptureSample } from "../src/runtime/frameCostCapture";

const recording = (times: readonly number[], changed = false) => writtenPreloadFile([
  frameCostCaptureHeading(1, times.length, 0, 1, 300000, changed),
  ...times.map((time, index) => frameCostCaptureSample(index + 1, time, 200, 1)),
]);

test("[reference] a five-minute raw capture keeps every callback; full-run median and nearest-rank p95 and p99", () => {
  const times = Array.from({ length: 18000 }, (_, index) => index + 1);
  const capture = parseFrameCostCapture(recording(times));
  expect(capture.elapsedMs).toBe(300000);
  expect(captureDistribution(capture)).toEqual({ frames: 18000, median: 9000.5, p95: 17100, p99: 17820, max: 18000 });
  expect(capture.samples[17999]).toEqual({ luaUs: 18000, natives: 200, catchUp: 1 });
});

test("[invariant] raw native readings preserve observed times rather than rounding them as predictions", () => {
  const text = recording(Array.from({ length: 240 }, () => 2500));
  const capture = parseFrameCostCapture(text);
  expect(frameCostCaptureReadings(capture).windows).toEqual(Array.from({ length: 5 }, () => ({ median: 2.5, p95: 2.5, max: 2.5 })));
  expect(parseNativeReadings(text)).toEqual(frameCostCaptureReadings(capture));
});

test("[invariant] missing samples, reordered samples, unavailable clocks and code changes cannot produce passing readings", () => {
  const text = recording([1, 2, 3]);
  expect(() => parseFrameCostCapture(text.replace('sample 2 lua-us=2', 'sample 3 lua-us=2'))).toThrow("sample 2");
  expect(() => parseFrameCostCapture(text.replace('frames=3', 'frames=4'))).toThrow("expected 4");
  expect(() => parseFrameCostCapture(text.replace('clock-us=1', 'clock-us=0'))).toThrow("unavailable native clock");
  expect(() => parseFrameCostCapture(recording([1, 2, 3], true))).toThrow("code reload");
  expect(() => parseFrameCostCapture(text.replace('sample 2 lua-us=2', 'sample 2 lua-us=none'))).toThrow("sample 2");
});
