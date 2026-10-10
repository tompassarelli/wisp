import { describe, expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Effect } from "effect";
import { readRepro, replayInClients } from "../scripts/wisp/commands/repro";
import { writtenPreloadFile } from "../scripts/wisp/headlessInput";
import { lineTokens, recordTokens, tokenLines } from "../src/runtime/recordText";
import { REPRO_LINE_WIDTH, assertReproLands, reproLines } from "../src/runtime/repro";
import { registeredTests } from "../src/runtime/testing";
import { replayRepro } from "./fixtures/repro/replay";

const registered = registeredTests.length;
await import("../src/runtime/recordText.tests");
const contracts = registeredTests.splice(registered);
describe("record text and repro contracts", () => {
  for (const contract of contracts) test(contract.name, contract.run);
});

const MAP = { filePrefix: "fixture", globalPrefixes: ["__fixture"] };
const directory = join(import.meta.dir, "../build/repro-tests");

function writeReproFile(checksum: string): string {
  const state = tokenLines(recordTokens({ total: 5 }) ?? [], REPRO_LINE_WIDTH);
  const lines = reproLines({ build: "fixture-dev", frame: 3, checksum }, [...state, "add 1", "add 2", "add 3"]);
  mkdirSync(directory, { recursive: true });
  const file = join(directory, `fixture-repro-p0-f3-${checksum}.txt`);
  writeFileSync(file, writtenPreloadFile(lines));
  return file;
}

test("[invariant] every simulated client lands on the recorded checksum", async () => {
  rmSync(directory, { recursive: true, force: true });
  const file = writeReproFile("total-11");
  const { repro, lines } = await Effect.runPromise(readRepro(file));
  expect(lineTokens(repro.lines.slice(0, 1))).toEqual(["total=5"]);
  const results = replayInClients(MAP, replayRepro, repro);
  expect(results).toEqual([0, 1].map(() => ({ checksum: "total-11", frames: 3, problems: [] })));
  assertReproLands(lines, replayRepro);
});
