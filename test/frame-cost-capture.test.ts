import { expect, test } from "bun:test";
import { captureDistribution, parseFrameCostCapture } from "../scripts/wisp/frameCostCapture";
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
