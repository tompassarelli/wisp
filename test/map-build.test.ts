import { chmodSync, existsSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect, Exit } from "effect";
import { expect, test } from "bun:test";
import { packageEntries, runProcess, stageMap, verifyToolchain, withFileIo, writeHeader } from "../scripts/wisp/mapBuild";
import { abilityData, encodeObjectData } from "../scripts/objectData";

const project = join(import.meta.dir, "..");

test("[spec AGENTS.md] the installed TypeScript toolchain matches typescript-toolchain.lock", async () => {
  await Effect.runPromise(verifyToolchain(join(project, "typescript-toolchain.lock"), project));
});

test("[spec docs/asset-ingestion.md] a declared import absent from the container is packaged and generated files keep precedence", async () => {
  const archive = new Map([ ["war3mapImported\\Card.tga", "old container art"] ]);
  const sources = new Map([
    ["private/card.tga", "declared import"],
    ["generated/card.tga", "generated art"],
  ]);
  const assets = [
    { entry: "war3mapImported\\Nordrassil.tga", source: "private/card.tga" },
    { entry: "war3mapImported\\Card.tga", source: "private/card.tga" },
  ];
  const files = [{ entry: "war3mapImported\\Card.tga", source: "generated/card.tga" }];
  await Effect.runPromise(packageEntries((entries) => Effect.sync(() => {
    for (const item of entries) {
      const contents = sources.get(item.source);
      if (contents === undefined) throw new Error(`missing source ${item.source}`);
      archive.set(item.entry, contents);
    }
  }), assets, files));
  expect(archive.get("war3mapImported\\Nordrassil.tga")).toBe("declared import");
  expect(archive.get("war3mapImported\\Card.tga")).toBe("generated art");
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
  expect(staged[0]).toBe(`${map}.${process.pid}.next`);
  expect(readFileSync(map, "utf8")).toBe("built");
  expect(readdirSync(directory).sort()).toEqual(["input.w3x", "map.w3x"]);
});

test("[invariant] interrupting a map step stops its child process", async () => {
  const directory = mkdtempSync(join(tmpdir(), "wisp-process-"));
  const pidFile = join(directory, "pid");
  // Interrupted once the child has started, however long that takes.
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

test("[spec docs/hot-reload.md] a map without its own war3map.w3a gets FileIO's 64-level ability, and one with it keeps its own", () => {
  const ability = abilityData();
  const units = { entry: "war3map.w3u", contents: encodeObjectData([], false) };
  expect(withFileIo([units])).toEqual([units, { entry: "war3map.w3a", contents: ability }]);
  const own = { entry: "war3map.w3a", contents: abilityData([{ base: "AHbz", id: 0x41303030, modifications: [] }]) };
  expect(withFileIo([own])).toEqual([own]);
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
