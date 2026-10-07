// The sample in two simulated clients (wisp:docs/headless.md): its TypeScript
// in Bun, then its compiled bundle in the 32-bit Lua that LUA names. Both
// clients make the same native calls, and the bundle makes the same calls in
// Lua as the TypeScript in Bun.
import { afterAll, expect, test } from "bun:test";
import { join } from "node:path";
import { mapCompiler, report } from "wisp/scripts/compiler";
import { installHeadless } from "wisp/scripts/wisp/headless";
import { journeyLines, runJourney } from "wisp/src/headless/journey";
import { install, start } from "../src/main";
import { SAMPLE_JOURNEY, SAMPLE_MAP } from "./journey";

const headless = installHeadless(SAMPLE_MAP);
afterAll(headless.restore);

const sample = join(import.meta.dir, "..");

function playInBun() {
  const clients = headless.clients({ start, install });
  return { clients, result: runJourney(clients, SAMPLE_JOURNEY) };
}

test("both clients ping, take a hot reload and keep walking, with the same native calls", () => {
  const { clients, result } = playInBun();
  expect(result.divergence).toBeUndefined();
  expect(result.reloads).toEqual([]);
  for (const client of clients.clients) {
    expect(client.errors).toEqual([]);
    expect(client.missingNatives).toEqual([]);
    expect(client.messages).toEqual(["ping 1", "hot reload 1 applied", "ping 2"]);
    // A move every 0.1 s: two units, X and Y, each of 20 moves.
    expect(client.log.filter(({ name }) => name === "SetUnitX" || name === "SetUnitY")).toHaveLength(80);
  }
  const [first, second] = result.clients;
  expect(first?.calls).toBe(second?.calls);
  expect(first?.checksum).toBe(second?.checksum ?? "");
});

test("the compiled bundle in 32-bit Lua makes the same native calls as the TypeScript in Bun", () => {
  expect(report(mapCompiler(join(sample, "tsconfig.map.json"))())).toBe("");
  expect(report(mapCompiler(join(sample, "tsconfig.headless.json"))())).toBe("");
  const run = Bun.spawnSync([
    process.env.LUA ?? "lua", join(sample, "build/headless/headless.lua"),
    join(sample, "build/map.lua"), join(sample, "../../src/natives/warcraft.d.ts"),
  ], { stdout: "pipe", stderr: "pipe" });
  expect({ code: run.exitCode, stderr: run.stderr.toString() }).toEqual({ code: 0, stderr: "" });
  expect(run.stdout.toString().trimEnd().split("\n")).toEqual(journeyLines(playInBun().result));
});
