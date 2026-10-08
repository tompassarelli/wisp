import { Effect } from "effect";
import { expect, test } from "bun:test";
import { runCli } from "../scripts/wisp/cli";
import { flagValues } from "../scripts/wisp/command";
import { makeMenus } from "../scripts/wisp/commands/menus";

test("[repro 82410d8] menu dispatch rejects a missing password before the following port flag", async () => {
  const lines: string[] = [];
  for (const action of ["host", "join"]) {
    const code = await runCli("wisp", { menus: { usage: "ACTION OPTIONS", load: async () => makeMenus() } },
      ["menus", action, "--folder", "00-Wisp", "--map", "Wisp Sample.w3x", "--name", "wisp 1", "--password", "--port", "47123"],
      (line) => lines.push(line));
    expect(code).toBe(2);
  }
  expect(lines.some((line) => line.includes("menus found"))).toBe(false);
});

test("[repro 82410d8] explicit empty and repeated equals values survive command dispatch", async () => {
  let values: string[] = [];
  const code = await runCli("wisp", { join: { usage: "--password VALUE", load: async () => (args) => Effect.sync(() => { values = flagValues(args, "password"); }) } },
    ["join", "--password=", "--port", "47123", "--password", "pw", "--password=a=b", "--password", "--port", "47124"], () => {});
  expect(code).toBe(0);
  expect(values).toEqual(["", "pw", "a=b"]);
});
