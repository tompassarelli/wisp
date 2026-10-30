import { expect, test } from "bun:test";
import { gcPauses, percentile, spread, summed } from "../host/window/stats";

test("[spec docs/native-window-plan.md] percentiles are nearest-rank over unsorted samples", () => {
  const samples = [9, 1, 5, 3, 7, 2, 8, 4, 6, 10];
  expect(percentile(samples, 0.5)).toBe(5);
  expect(percentile(samples, 0.95)).toBe(10);
  expect(percentile([], 0.99)).toBe(0);
  expect(spread(samples)).toEqual({ p50: 5, p95: 10, p99: 10, max: 10 });
});

test("[spec docs/native-window-plan.md] scene time is the encode and the parse of the same frame, to the shorter series", () => {
  expect(summed([1, 2, 3], [10, 20])).toEqual([11, 22]);
});

test("[spec docs/native-window-plan.md] gc pauses are read from finished collections in JavaScriptCore's log", () => {
  const log = [
    "[GC<0x1>: starting 0.012778ms]",
    "[GC<0x1>: START M 576kb => EdenCollection, ca=154kb o=0 b=0 i#1:N<CsMsrShDMsm(0)> tp=0.300000ms 13+0 => 207kb, p=1.217808ms (max 1.217808), cycle 1.210060ms END]",
    "[GC<0x1>: finalize 0.007031ms]",
    "[GC<0x1>: START M 18530kb => EdenCollection => 465kb, p=0.454403ms (max 1.217808), cycle 0.443406ms END]",
    "wisp-window-probe frames end",
  ].join("\n");
  expect(gcPauses(log)).toEqual([1.217808, 0.454403]);
  expect(gcPauses("")).toEqual([]);
});
