import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect, Exit } from "effect";
import { expect, test } from "bun:test";
import { runProcess, stageMap, verifyToolchain } from "../scripts/waygate/mapBuild";
import { composeScript, typescriptBase } from "../scripts/mapScript";

const project = join(import.meta.dir, "..");
const baseMapScript = "function main()\nInitBlizzard()\nRunInitializationTriggers()\nend\n\nfunction config()\nSetPlayers(1)\nend\n";
const bundle = { text: "return { start = function() end }", key: "1-2" };

test("the installed TypeScript toolchain matches typescript-toolchain.lock", async () => {
  await Effect.runPromise(verifyToolchain(join(project, "typescript-toolchain.lock"), project));
});

test("a TypeScript-only map starts the TypeScript entry with its own config, before and after a rebuild", () => {
  const base = typescriptBase(baseMapScript, "function mapConfig()\n    SetPlayers(4)\nend\n");
  expect(base).not.toMatch(/^RunInitializationTriggers\(\)$/m);
  for (const candidate of [bundle, { ...bundle, key: "3-4" }]) {
    const script = composeScript(base, candidate);
    expect(script).toContain(`function main()\n    baseMain()\n    waygateTs.start("${candidate.key}")\nend`);
    expect(script).toContain("function config()\n    mapConfig()\nend");
  }
  expect(() => composeScript(base, undefined)).toThrow();
});

test("a failed map step removes the staged copy and keeps the previous map", async () => {
  const directory = mkdtempSync(join(tmpdir(), "waygate-stage-"));
  const map = join(directory, "map.w3x");
  writeFileSync(map, "previous");
  const exit = await Effect.runPromiseExit(stageMap(map, map, (staged) => Effect.gen(function*() {
    writeFileSync(staged, "partial");
    yield* runProcess("replace war3map.lua", staged, ["false"]);
  })));
  expect(Exit.isFailure(exit)).toBe(true);
  expect(readFileSync(map, "utf8")).toBe("previous");
  expect(existsSync(`${map}.next`)).toBe(false);
});

test("interrupting a map step stops its child process", async () => {
  const directory = mkdtempSync(join(tmpdir(), "waygate-process-"));
  const pidFile = join(directory, "pid");
  const exit = await Effect.runPromiseExit(
    runProcess("sleep", directory, ["sh", "-c", `echo $$ > ${pidFile}; exec sleep 30`]).pipe(Effect.timeout("200 millis")),
  );
  expect(Exit.isFailure(exit)).toBe(true);
  const pid = Number(readFileSync(pidFile, "utf8"));
  await Bun.sleep(50);
  expect(() => process.kill(pid, 0)).toThrow();
});
