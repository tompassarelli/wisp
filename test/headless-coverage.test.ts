import { expect, test } from "bun:test";
import { join } from "node:path";
import { coverageFixture } from "./coverage/fixture";
import { mapCompiler, report } from "../scripts/compiler";

test("equal defaults fail coverage, modeled and intentional calls pass in Bun", coverageFixture);

test("equal defaults fail coverage, modeled and intentional calls pass in emitted Lua", () => {
  expect(report(mapCompiler(join(import.meta.dir, "tsconfig.coverage.json"))())).toBe("");
  const run = Bun.spawnSync([process.env.LUA ?? "lua", join(import.meta.dir, "../build/coverage-tests/coverage.lua")]);
  expect({ code: run.exitCode, stderr: run.stderr.toString() }).toEqual({ code: 0, stderr: "" });
  expect(run.stdout.toString()).toContain("native coverage contract passed");
});

test("headless JSON names missing native, client and frame and exits nonzero", () => {
  const started = performance.now();
  const run = Bun.spawnSync(["bun", join(import.meta.dir, "coverage/cli.ts"), "headless", "--json"]);
  const records = run.stdout.toString().trim().split("\n").map((line) => JSON.parse(line));
  expect(run.exitCode).toBe(1);
  for (const client of [0, 1]) expect(records.find((record) => record.type === "failure" && record.client === client)).toMatchObject({ kind: "missing-native", native: "GetRandomInt", client, frame: 0 });
  expect(records.at(-1)).toMatchObject({ type: "summary", ok: false, counts: { results: 1, failures: 2 } });
  console.log(`missing-native CLI fixture: ${(performance.now() - started).toFixed(1)} ms`);
});
