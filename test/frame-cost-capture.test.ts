import { expect, test } from "bun:test";
import { captureDistribution, captureReceipt, parseFrameCostCapture, sectionTable } from "../host/perf/frameCostCapture";
import { writtenPreloadFile } from "../host/headless/headlessInput";
import { frameCostCaptureHeading, frameCostCaptureSample } from "../src/runtime/frameCostCapture";

const recording = (times: readonly number[], changed = false) => writtenPreloadFile([
  frameCostCaptureHeading(1, times.length, 0, 1, 300000, changed, []),
  ...times.map((time, index) => frameCostCaptureSample(index + 1, time, 200, 1, undefined, [])),
]);

test("[reference] a five-minute raw capture keeps every callback; full-run median and nearest-rank p95 and p99", () => {
  const times = Array.from({ length: 18000 }, (_, index) => index + 1);
  const capture = parseFrameCostCapture(recording(times));
  expect(capture.elapsedMs).toBe(300000);
  expect(captureDistribution(capture)).toEqual({ frames: 18000, median: 9000.5, p95: 17100, p99: 17820, max: 18000 });
  expect(capture.samples[17999]).toEqual({ luaUs: 18000, natives: 200, catchUp: 1, gcKb: undefined, sectionsUs: [] });
});

test("[spec] the section table reports each section, the rest of the frame and the worst 1% of frames' shares from a receipt or a perf run's capture lines", () => {
  const lines = [
    frameCostCaptureHeading(1, 200, 0, 1, 3333, false, ["step", "render"]),
    ...Array.from({ length: 200 }, (_, index) => index < 198
      ? frameCostCaptureSample(index + 1, 1000, 200, 1, index % 2 === 0 ? 1.5 : -0.25, [400, 500])
      : frameCostCaptureSample(index + 1, 10000, 200, 1, 8, [9000, 500])),
  ];
  const table = sectionTable(parseFrameCostCapture(captureReceipt(lines.map((line) => `p1 capture: ${line}`).join("\n"), 1)));
  expect(sectionTable(parseFrameCostCapture(writtenPreloadFile(lines)))).toEqual(table);
  expect(table.worstFrames).toBe(2);
  expect(table.rows.map(({ name, median, p99, max, worstShare }) => [name, median, p99, max, worstShare])).toEqual([
    ["step", 400, 400, 9000, 0.9], ["render", 500, 500, 500, 0.05], ["other", 100, 100, 500, 0.05], ["total", 1000, 1000, 10000, 1],
  ]);
  expect(table.gcKb).toEqual({ median: 1.5, p95: 1.5, p99: 1.5, max: 8 });
  expect(() => parseFrameCostCapture(writtenPreloadFile([lines[0] ?? "", ...lines.slice(1).map((line) => line.replace("sections-us=400,500", "sections-us=400"))]))).toThrow("invalid frame capture sample 1");
});
