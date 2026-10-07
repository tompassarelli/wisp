import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect, Exit } from "effect";
import { expect, test } from "bun:test";
import { ensureLua, packageEntries, runProcess, stageMap, verifyToolchain, withFileIo, writeHeader } from "../scripts/wisp/mapBuild";
import { abilityData, encodeObjectData } from "../scripts/objectData";
import { composeScript, typescriptBase } from "../scripts/mapScript";

const project = join(import.meta.dir, "..");
const baseMapScript = "function main()\nInitBlizzard()\nRunInitializationTriggers()\nend\n\nfunction config()\nSetPlayers(1)\nend\n";
const bundle = { text: "return { start = function() end }", key: "1-2" };

test("the installed TypeScript toolchain matches typescript-toolchain.lock", async () => {
  await Effect.runPromise(verifyToolchain(join(project, "typescript-toolchain.lock"), project));
});

test("a declared import absent from the container is packaged and generated files keep precedence", async () => {
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
  await Effect.runPromise(packageEntries((item) => Effect.sync(() => {
    const contents = sources.get(item.source);
    if (contents === undefined) throw new Error(`missing source ${item.source}`);
    archive.set(item.entry, contents);
  }), assets, files));
  expect(archive.get("war3mapImported\\Nordrassil.tga")).toBe("declared import");
  expect(archive.get("war3mapImported\\Card.tga")).toBe("generated art");
});

test("a TypeScript-only map starts the TypeScript entry with its own config, before and after a rebuild", () => {
  const base = typescriptBase(baseMapScript, "function mapConfig()\n    SetPlayers(4)\nend\n");
  expect(base).not.toMatch(/^RunInitializationTriggers\(\)$/m);
  for (const candidate of [bundle, { ...bundle, key: "3-4" }]) {
    const script = composeScript(base, candidate);
    expect(script).toContain(`function main()\n    baseMain()\n    wispTs.start("${candidate.key}")\nend`);
    expect(script).toContain("function config()\n    mapConfig()\nend");
  }
  expect(() => composeScript(base, undefined)).toThrow();
});

test("a failed map step removes the staged copy and keeps the previous map", async () => {
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

test("a map stages in a file of its own process, writable even from a read-only source", async () => {
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

test("interrupting a map step stops its child process", async () => {
  const directory = mkdtempSync(join(tmpdir(), "wisp-process-"));
  const pidFile = join(directory, "pid");
  const exit = await Effect.runPromiseExit(
    runProcess("sleep", directory, ["sh", "-c", `echo $$ > ${pidFile}; exec sleep 30`]).pipe(Effect.timeout("200 millis")),
  );
  expect(Exit.isFailure(exit)).toBe(true);
  const pid = Number(readFileSync(pidFile, "utf8"));
  await Bun.sleep(50);
  expect(() => process.kill(pid, 0)).toThrow();
});

test("a map without its own war3map.w3a gets FileIO's 64-level ability, and one with it keeps its own", () => {
  const ability = abilityData();
  const view = new DataView(ability.buffer, ability.byteOffset, ability.byteLength);
  expect([view.getInt32(0, true), view.getInt32(4, true), view.getInt32(8, true)]).toEqual([2, 0, 1]);
  expect(new TextDecoder().decode(ability.subarray(12, 20))).toBe("ANcl$wsl");
  expect(view.getInt32(20, true)).toBe(65);
  // One alev level count, then a one-space tooltip for each level 1-64.
  expect(ability.length).toBe(12 + 12 + 24 + 64 * 22);
  const last = ability.subarray(ability.length - 22);
  expect(new TextDecoder().decode(last.subarray(0, 4))).toBe("atp1");
  expect(new DataView(last.buffer, last.byteOffset).getInt32(8, true)).toBe(64);
  expect([...last.subarray(16, 18)]).toEqual([0x20, 0]);

  const units = { entry: "war3map.w3u", contents: encodeObjectData([], false) };
  expect(withFileIo([units])).toEqual([units, { entry: "war3map.w3a", contents: ability }]);
  const own = { entry: "war3map.w3a", contents: abilityData([{ base: "AHbz", id: 0x41303030, modifications: [] }]) };
  expect(withFileIo([own])).toEqual([own]);
});

test("the map header replaces an existing one or goes in front of an archive saved without one", async () => {
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

test("an installed Lua compiler is used as it is, without running nix", async () => {
  const directory = join(mkdtempSync(join(tmpdir(), "wisp-lua-")), "lua");
  mkdirSync(join(directory, "bin"), { recursive: true });
  writeFileSync(join(directory, "bin/luac"), "installed");
  await Effect.runPromise(ensureLua(directory));
  expect(readFileSync(join(directory, "bin/luac"), "utf8")).toBe("installed");
});
