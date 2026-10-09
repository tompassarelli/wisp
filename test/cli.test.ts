import { Effect } from "effect";
import { expect, test } from "bun:test";
import { runCli } from "../scripts/wisp/cli";
import { flagValues } from "../scripts/wisp/command";
import { makeMenus } from "../scripts/wisp/commands/menus";

test("[property seed 824108] command dispatch preserves value boundaries, empty values and repetition", async () => {
  const lines: string[] = [];
  for (const action of ["host", "join"]) {
    const code = await runCli("wisp", { menus: { usage: "ACTION OPTIONS", load: async () => makeMenus() } },
      ["menus", action, "--folder", "00-Wisp", "--map", "Wisp Sample.w3x", "--name", "wisp 1", "--password", "--port", "47123"],
      (line) => lines.push(line));
    expect(code).toBe(2);
  }
  expect(lines.some((line) => line.includes("menus found"))).toBe(false);
  let seed = 824108;
  for (let index = 0; index < 32; index++) {
    seed = Math.imul(seed, 1664525) + 1013904223;
    const value = String(seed >>> 0);
    let values: string[] = [];
    const code = await runCli("wisp", { probe: { usage: "--password VALUE", load: async () => args => Effect.sync(() => { values = flagValues(args, "password"); }) } },
      ["probe", "--password=", "--port", "47123", "--password", value, `--password=${value}=suffix`, "--password", "--port", "47124"], () => {});
    expect(code).toBe(0);
    expect(values).toEqual(["", value, `${value}=suffix`]);
  }
});
