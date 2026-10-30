import { expect, test } from "bun:test";
import { culpritRun, failingTests, redIssueBody } from "../host/checks/mainRed";

test("[invariant] a red main issue names each failing cargo test and the lane that landed the first failing commit", () => {
  const log = [
    "window\tRun cargo test --release --locked\t2026-10-30T23:05:28.0915504Z test render::gpu_tests::blend_is_source_alpha_over_with_no_depth_write ... FAILED\r",
    "window\tRun cargo test --release --locked\t2026-10-30T23:05:28.0915504Z test render::gpu_tests::modulate_twice_doubles_the_product ... ok",
    "window\tRun cargo test --release --locked\t2026-10-30T23:05:28.5268240Z test result: FAILED. 86 passed; 1 failed; 0 ignored",
  ].join("\n");
  expect(failingTests(log)).toEqual(["cargo: render::gpu_tests::blend_is_source_alpha_over_with_no_depth_write"]);

  const run = (databaseId: number, headSha: string, conclusion: string) => ({ databaseId, headSha, conclusion, status: "completed", url: `https://x/${databaseId}` });
  const runs = [run(3, "c".repeat(40), "failure"), run(2, "b".repeat(40), "failure"), run(1, "a".repeat(40), "success")];
  expect(culpritRun(runs)?.headSha).toBe("b".repeat(40));
  const body = redIssueBody("main", failingTests(log), runs, "o/r", "claude/land-lane-0123456789ab");
  expect(body).toContain(`First failing commit: ${"b".repeat(40)}`);
  expect(body).toContain("Culprit lane: claude/land-lane-0123456789ab");
});
