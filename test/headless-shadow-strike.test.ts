import { afterAll, expect, test } from "bun:test";
import { join } from "node:path";
import { installHeadless } from "../scripts/wisp/headless";
import { mapCompiler, report } from "../scripts/compiler";
import { farmTest } from "../scripts/wisp/farmTest";
import { SHADOW_CONFIGS, SHADOW_JOURNEY } from "./shadow-strike94/configs";
import { SHADOW_HEADLESS } from "./shadow-strike94/headless-config";
import { NATIVE_ROWS } from "./shadow-strike94/native-rows";
import { install, start } from "./shadow-strike94/main";

const runtime = installHeadless(SHADOW_HEADLESS);
afterAll(runtime.restore);

test("[native #94] Shadow Strike initial damage and exclusive-duration ticks match all nine Classic rows per client", () => {
  const clients = runtime.clients({ install, start });
  clients.start();
  clients.frames(SHADOW_JOURNEY.frames);
  expect(clients.firstDivergence()).toBeUndefined();
  for (const client of clients.clients) {
    expect(client.errors).toEqual([]);
    expect(client.missingNatives).toEqual([]);
    for (let index = 0; index < SHADOW_CONFIGS.length; index++) expect(client.files.get(`shadow-strike94-${SHADOW_CONFIGS[index]?.name}-p${client.slot}.txt`)).toEqual(NATIVE_ROWS[index]);
  }
});

farmTest("[native #94] the same nine Shadow Strike damage rows match in emitted 32-bit Lua", () => {
  for (const config of ["test/shadow-strike94/tsconfig.json", "test/shadow-strike94/tsconfig.headless.json"]) expect(report(mapCompiler(join(import.meta.dir, "..", config))())).toBe("");
  const run = Bun.spawnSync([process.env.LUA ?? "lua", "build/shadow-strike94/headless/headless.lua", "build/shadow-strike94/map.lua", "src/natives/warcraft.d.ts"], { stdout: "pipe", stderr: "pipe" });
  expect({ code: run.exitCode, stderr: run.stderr.toString() }).toEqual({ code: 0, stderr: "" });
  expect(run.stdout.toString().trimEnd().split("\n")).toEqual([0, 1].flatMap(slot => NATIVE_ROWS.flatMap(rows => rows.map(row => `p${slot} ${row}`))));
});
