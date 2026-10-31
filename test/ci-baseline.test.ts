import { expect, test } from "bun:test";
import { failedTestNames, judgeJobs } from "../host/checks/ciBaseline";

const job = (name: string, ...tests: string[]) => ({ name, url: `https://x/${name}`, tests });

test("[invariant] a candidate's failed CI job is main's own when main failed that job and names no test the candidate adds, and new when main passed it or the candidate fails another test", () => {
  const crash = job("ci / window-windows");
  const mainCrashed = [[job("window-windows")], [], [job("window-windows", "post::a")]];
  expect(judgeJobs([crash], mainCrashed).known).toEqual([crash]);
  expect(judgeJobs([crash], [[], []]).fresh).toEqual([crash]);

  const named = job("ci / window", "post::a");
  expect(judgeJobs([named], mainCrashed.map((run) => run.map((entry) => ({ ...entry, name: "window" })))).known).toEqual([named]);
  const extra = job("ci / window", "post::a", "render::b");
  expect(judgeJobs([extra], [[job("window", "post::a")]]).fresh).toEqual([extra]);
  expect(judgeJobs([job("ci / knip")], [[job("window-windows")]]).fresh).toEqual([job("ci / knip")]);
});

test("[invariant] failed test names come from cargo FAILED lines and bun (fail) lines of a raw job log, once each", () => {
  const log = [
    "﻿2026-10-31T00:05:28.0915504Z test render::gpu_tests::blend ... FAILED\r",
    "2026-10-31T00:05:28.1Z test render::gpu_tests::blend ... FAILED",
    "2026-10-31T00:05:28.2Z test render::gpu_tests::add ... ok",
    "2026-10-31T00:05:28.3Z (fail) tests > a thing [12.00ms]",
  ].join("\n");
  expect(failedTestNames(log)).toEqual(["render::gpu_tests::blend", "tests > a thing"]);
});
