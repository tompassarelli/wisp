import { expect, test } from "bun:test";
import { PERF_METRICS, comparePerfRuns, parsePerfRun } from "../host/perf/perf";

test("[k4 reference makgora run 38723431856] perf compare gates the mean on the run total: a whole-KB rounding step moves no verdict, a rise over the threshold fails", () => {
  const run = (total: number, mean: number) => parsePerfRun([
    "frames 1800 step 100 problems 0",
    ...PERF_METRICS.map((metric) => metric === "alloc-kb"
      ? `p0 alloc-kb start=72585 total=${total} median=11 p95=25 mean=${mean} max=275 top=68`
      : `p0 ${metric} start=0 total=0 median=0 p95=0 mean=0 max=0 top=0`),
  ].join("\n"));
  const before = run(22411, 12);
  expect(comparePerfRuns(before, run(23478, 13)).regressions).toEqual([]);
  expect(comparePerfRuns(before, run(23600, 13)).regressions).toEqual(["p0 allocated KB mean +5.3%"]);
});
