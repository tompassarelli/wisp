import { chmodSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect, Exit } from "effect";
import { expect, test } from "bun:test";
import { baseMapEntryNames, runProcess, stageMap } from "../scripts/wisp/mapBuild";

test("[property seed 85] archive replacement preserves unrelated entries and removes every case alias", () => {
  expect(baseMapEntryNames("war3mapMap.blp\nwar3map.w3i\nwar3map.mmp\n", [
    { entry: "war3mapmap.blp", source: "lineup.blp" },
    { entry: "war3map.w3i", source: "generated-info" },
  ])).toEqual(["war3map.mmp"]);
  let seed = 85;
  for (let count = 1; count <= 32; count++) {
    const list: string[] = [], kept: string[] = [], replacements: { entry: string; source: string }[] = [];
    for (let index = 0; index < count; index++) {
      const entry = `Import-${index}.mdx`;
      list.push(entry);
      seed = Math.imul(seed, 1664525) + 1013904223;
      if ((seed & 4) === 0) kept.push(entry);
      else replacements.push({ entry: entry.toUpperCase(), source: "authored" });
    }
    const actual = baseMapEntryNames(list.join("\r\n"), replacements);
    expect(actual).toEqual(kept);
    expect(baseMapEntryNames(actual.join("\n"), replacements)).toEqual(actual);
  }
});

test("[invariant] a map stages in a file of its own, writable even from a read-only source; a failed step removes the staged copy and keeps the previous map", async () => {
  const directory = mkdtempSync(join(tmpdir(), "wisp-stage-"));
  const map = join(directory, "map.w3x");
  writeFileSync(map, "previous");
  const exit = await Effect.runPromiseExit(stageMap(map, map, (staged) => Effect.gen(function*() {
    writeFileSync(staged, "partial");
    yield* runProcess("replace war3map.lua", staged, ["false"]);
  })));
  expect(Exit.isFailure(exit)).toBe(true);
  expect(readFileSync(map, "utf8")).toBe("previous");
  expect(readdirSync(directory)).toEqual(["map.w3x"]);
  {
    const directory = mkdtempSync(join(tmpdir(), "wisp-stage-"));
    const source = join(directory, "input.w3x");
    writeFileSync(source, "input");
    chmodSync(source, 0o444);
    const map = join(directory, "map.w3x");
    const staged: string[] = [];
    await Effect.runPromise(stageMap(source, map, (path) => Effect.sync(() => {
      staged.push(path);
      writeFileSync(path, "built");
    })));
    expect(staged[0]).not.toBe(source);
    expect(staged[0]).not.toBe(map);
    expect(readFileSync(map, "utf8")).toBe("built");
    expect(readdirSync(directory).sort()).toEqual(["input.w3x", "map.w3x"]);
  }
});
