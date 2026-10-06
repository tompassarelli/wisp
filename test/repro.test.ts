// `wisp repro`: a moment a map saved replays in two simulated clients, which
// must land on the recorded checksum, and --test writes a test that replays it.
// The record text and repro contracts also run in 32-bit Lua (runtime.test.ts).
import { describe, expect, test } from "bun:test";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Effect, Exit } from "effect";
import { makeRepro, readRepro, replayInClients, reproReport } from "../scripts/wisp/commands/repro";
import { writtenPreloadFile } from "../scripts/wisp/headlessInput";
import { lineTokens, recordTokens, tokenLines } from "../src/runtime/recordText";
import { REPRO_LINE_WIDTH, assertReproLands, reproLines } from "../src/runtime/repro";
import { registeredTests } from "../src/runtime/testing";
import { replayRepro } from "./fixtures/repro/replay";

// Taken out of the shared registry, which other files of this process count.
const registered = registeredTests.length;
await import("../src/runtime/recordText.tests");
const contracts = registeredTests.splice(registered);
describe("record text and repro contracts", () => {
  for (const contract of contracts) test(contract.name, contract.run);
});

const MAP = { filePrefix: "fixture", globalPrefixes: ["__fixture"] };
const directory = join(import.meta.dir, "../build/repro-tests");

/** A repro file as Warcraft writes it: total 5, then three frames adding 1, 2 and 3. */
function writeReproFile(checksum: string): string {
  const state = tokenLines(recordTokens({ total: 5 }) ?? [], REPRO_LINE_WIDTH);
  const lines = reproLines({ build: "fixture-dev", frame: 3, checksum }, [...state, "add 1", "add 2", "add 3"]);
  mkdirSync(directory, { recursive: true });
  const file = join(directory, `fixture-repro-p0-f3-${checksum}.txt`);
  writeFileSync(file, writtenPreloadFile(lines));
  return file;
}

const project = { map: MAP, replay: join(import.meta.dir, "fixtures/repro/replay.ts"), tests: join(directory, "tests") };

test("every simulated client lands on the recorded checksum, and --test writes a test of the moment", async () => {
  rmSync(directory, { recursive: true, force: true });
  const file = writeReproFile("total-11");
  const { repro, lines } = await Effect.runPromise(readRepro(file));
  expect(lineTokens(repro.lines.slice(0, 1))).toEqual(["total=5"]);
  const results = replayInClients(MAP, replayRepro, repro);
  expect(results).toEqual([0, 1].map(() => ({ checksum: "total-11", frames: 3, problems: [] })));
  expect(reproReport(file, repro, results).lines.at(-1)).toBe("every client lands on the recorded checksum total-11 at frame 3");
  assertReproLands(lines, replayRepro);
  const exit = await Effect.runPromiseExit(makeRepro(async () => project)([file, "--test", "fixture-moment"]));
  expect(Exit.isSuccess(exit)).toBe(true);
  const source = readFileSync(join(project.tests, "fixture-moment.tests.ts"), "utf8");
  expect(source).toContain(`import { replayRepro } from "../../../test/fixtures/repro/replay";`);
  expect(source).toContain(`test("repro fixture-moment", () => assertReproLands(LINES, replayRepro));`);
  for (const line of lines) expect(source).toContain(`  ${JSON.stringify(line)},`);
});

test("a replay that misses the recorded checksum fails and writes no test; a file cut short is refused", async () => {
  const missed = writeReproFile("total-12");
  const exit = await Effect.runPromiseExit(makeRepro(async () => project)([missed, "--test", "missed"]));
  expect(Exit.isFailure(exit)).toBe(true);
  expect(() => readFileSync(join(project.tests, "missed.tests.ts"))).toThrow();
  const cut = join(directory, "cut.txt");
  writeFileSync(cut, writtenPreloadFile(["wisp-repro 1", "build fixture-dev", "frame 3", "checksum total-11", "add 1"]));
  const read = await Effect.runPromiseExit(readRepro(cut));
  expect(Exit.isFailure(read) ? String(read.cause) : "").toContain("cut short");
});
