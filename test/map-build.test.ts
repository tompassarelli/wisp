import { chmodSync, existsSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect, Exit } from "effect";
import { expect, test } from "bun:test";
import { baseMapEntryNames, runProcess, stageMap, writeHeader } from "../scripts/wisp/mapBuild";

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

test("[invariant] a failed map step removes the staged copy and keeps the previous map", async () => {
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
});

test("[repro dafb85c] a map stages in a file of its own process, writable even from a read-only source", async () => {
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
});

test("[invariant] interrupting a map step stops its child process", async () => {
  const directory = mkdtempSync(join(tmpdir(), "wisp-process-"));
  const pidFile = join(directory, "pid");

  const started = Effect.promise(async () => {
    while (!existsSync(pidFile) || readFileSync(pidFile, "utf8").trim() === "") await Bun.sleep(10);
  });
  const exit = await Effect.runPromiseExit(
    runProcess("sleep", directory, ["sh", "-c", `echo $$ > ${pidFile}; exec sleep 600`]).pipe(Effect.raceFirst(started.pipe(Effect.andThen(Effect.fail("started" as const))))),
  );
  expect(Exit.isFailure(exit)).toBe(true);
  const pid = Number(readFileSync(pidFile, "utf8"));
  expect(() => process.kill(pid, 0)).toThrow();
});

test("[invariant] the map header replaces an existing one or goes in front of an archive saved without one", async () => {
  const directory = mkdtempSync(join(tmpdir(), "wisp-header-"));
  const header = new Uint8Array(512).fill(7);
  header.set(new TextEncoder().encode("HM3W"));
  const archive = new TextEncoder().encode("MPQ\x1a archive bytes");
  const bare = join(directory, "bare.w3m");
  writeFileSync(bare, archive);
  await Effect.runPromise(writeHeader(bare, header));
  expect(readFileSync(bare)).toEqual(Buffer.concat([header, archive]));
  const replacement = new Uint8Array(512).fill(9);
  replacement.set(new TextEncoder().encode("HM3W"));
  await Effect.runPromise(writeHeader(bare, replacement));
  expect(readFileSync(bare)).toEqual(Buffer.concat([replacement, archive]));
  const other = join(directory, "other.w3m");
  writeFileSync(other, "not a map");
  expect(Exit.isFailure(await Effect.runPromiseExit(writeHeader(other, header)))).toBe(true);
  expect(readFileSync(other, "utf8")).toBe("not a map");
});
