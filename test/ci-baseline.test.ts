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
