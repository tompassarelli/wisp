import { Effect } from "effect";
import { expect, test } from "bun:test";
import { runCli } from "../scripts/wisp/cli";
import { UsageFailure, flagValues } from "../scripts/wisp/command";
import { makeMenus } from "../scripts/wisp/commands/menus";
import { MapBuildFailure } from "../scripts/wisp/mapBuild";

const commands = {
  ok: { usage: "", load: async () => () => Effect.void },
  usage: { usage: "--needed VALUE", load: async () => () => Effect.fail(new UsageFailure({ problem: "missing --needed" })) },
  fails: { usage: "", load: async () => () => Effect.fail(new MapBuildFailure({ operation: "build", path: "map.w3x", cause: "broken" })) },
};

test("menu dispatch rejects a missing password before the following port flag", async () => {
  const lines: string[] = [];
  for (const action of ["host", "join"]) {
    const code = await runCli("wisp", { menus: { usage: "ACTION OPTIONS", load: async () => makeMenus() } },
      ["menus", action, "--folder", "00-Wisp", "--map", "Wisp Sample.w3x", "--name", "wisp 1", "--password", "--port", "47123"],
      (line) => lines.push(line));
    expect(code).toBe(2);
  }
  expect(lines.some((line) => line.includes("menus found"))).toBe(false);
});

test("explicit empty and repeated equals values survive command dispatch", async () => {
  let values: string[] = [];
  const code = await runCli("wisp", { join: { usage: "--password VALUE", load: async () => (args) => Effect.sync(() => { values = flagValues(args, "password"); }) } },
    ["join", "--password=", "--port", "47123", "--password", "pw", "--password=a=b", "--password", "--port", "47124"], () => {});
  expect(code).toBe(0);
  expect(values).toEqual(["", "pw", "a=b"]);
});

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
