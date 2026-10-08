import { afterAll, expect, test } from "bun:test";
import { join } from "node:path";
import { mapCompiler, report } from "../scripts/compiler";
import { installHeadless } from "../scripts/wisp/headless";
import { runJourney } from "../src/headless/journey";
import { ANIMATION_NOOPS } from "./animation58/cases";
import { EXPECTED, EXPECTED_FILE } from "./animation58/expected";
import { CAPTURE_FRAME, RULER, RULER_DEATH_SECONDS } from "./animation58/layout";
import { install, start } from "./animation58/main";
import { animationRows } from "./animation58/rows";

const runtime = installHeadless({ filePrefix: "animation", globalPrefixes: ["__animation58"], intentionalNoops: ANIMATION_NOOPS });
afterAll(runtime.restore);
const effectDeaths = (model: string) => (model === RULER ? RULER_DEATH_SECONDS : undefined);

test("#58 and #59 rulers draw the playback and effect lifetime rules alike in two clients", () => {
  const clients = runtime.clients({ install, start }, [0, 1], { effectDeaths });
  const result = runJourney(clients, { frames: CAPTURE_FRAME, events: [] });
  expect(result.divergence).toBeUndefined();
  expect(result.clients.map(client => [client.errors, client.missingNatives])).toEqual([[[], []], [[], []]]);
  for (const client of clients.clients) {
    expect(client.files.get(`animation-p${client.slot}.txt`)).toEqual(EXPECTED_FILE);
    expect(animationRows(client.effectPoses(), client.unitPoses())).toEqual(EXPECTED);
  }
});

test("#58 and #59 rulers draw the same rows in emitted 32-bit Lua", () => {
  for (const config of ["test/animation58/tsconfig.json", "test/animation58/tsconfig.headless.json"]) expect(report(mapCompiler(join(import.meta.dir, "..", config))())).toBe("");
  const run = Bun.spawnSync([process.env.LUA ?? "lua", join(import.meta.dir, "../build/animation58/headless/headless.lua"), join(import.meta.dir, "../build/animation58/map.lua"), join(import.meta.dir, "../src/natives/warcraft.d.ts")], { stdout: "pipe", stderr: "pipe" });
  expect({ code: run.exitCode, stderr: run.stderr.toString() }).toEqual({ code: 0, stderr: "" });
  expect(run.stdout.toString().trimEnd().split("\n")).toEqual([0, 1].flatMap(slot => [...EXPECTED_FILE, ...EXPECTED].map(row => `p${slot} ${row}`)));
}, 60_000);
