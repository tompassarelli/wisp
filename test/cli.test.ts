import { Effect } from "effect";
import { expect, test } from "bun:test";
import { runCli } from "../scripts/wisp/cli";
import { UsageFailure } from "../scripts/wisp/command";
import { MapBuildFailure } from "../scripts/wisp/mapBuild";

const commands = {
  ok: { usage: "", load: async () => () => Effect.void },
  usage: { usage: "--needed VALUE", load: async () => () => Effect.fail(new UsageFailure({ problem: "missing --needed" })) },
  fails: { usage: "", load: async () => () => Effect.fail(new MapBuildFailure({ operation: "build", path: "map.w3x", cause: "broken" })) },
};

test("a project program exits 0, 2 with usage, or 1 with the failure's message", async () => {
  const run = async (argv: readonly string[]) => {
    const lines: string[] = [];
    const code = await runCli("bun sample.ts", commands, argv, (line) => lines.push(line));
    return { code, last: lines.at(-1) ?? "" };
  };
  expect((await run(["ok"])).code).toBe(0);
  expect(await run([])).toEqual({ code: 2, last: "usage: bun sample.ts COMMAND\n  ok\n  usage --needed VALUE\n  fails" });
  expect(await run(["usage"])).toEqual({ code: 2, last: "missing --needed\nusage: bun sample.ts usage --needed VALUE" });
  expect(await run(["fails"])).toEqual({ code: 1, last: "build failed for map.w3x: broken" });
});
