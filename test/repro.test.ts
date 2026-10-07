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
import { diffReproStates } from "../scripts/wisp/reproInspection";

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

test("inspection writes exact state and a previous-frame diff without changing the saved repro", async () => {
  const file = writeReproFile("total-11");
  const saved = readFileSync(file, "utf8");
  const out = join(directory, "inspection.json");
  await Effect.runPromise(makeRepro(async () => project)([file, "--frame", "3", "--diff-frame", "previous", "--out", out]));
  expect(JSON.parse(readFileSync(out, "utf8"))).toEqual({
    build: "fixture-dev", frame: 3, checksum: "total-11", state: "Fixture|total=11", fields: [{ path: "total", value: "11" }],
    diff: { from: 2, to: 3, fields: [{ path: "total", before: "8", after: "11" }] },
  });
  expect(readFileSync(file, "utf8")).toBe(saved);
  for (const frame of ["-1", "1.5", "NaN", "4"]) {
    expect(Exit.isFailure(await Effect.runPromiseExit(makeRepro(async () => project)([file, "--frame", frame, "--out", join(directory, `invalid-${frame}.json`)])))).toBe(true);
  }
  expect(Exit.isFailure(await Effect.runPromiseExit(makeRepro(async () => project)([file, "--frame", "1", "--out", file])))).toBe(true);
  expect(Exit.isFailure(await Effect.runPromiseExit(makeRepro(async () => project)([file, "--frame", "1"])))).toBe(true);
  const missed = writeReproFile("total-12");
  expect(Exit.isFailure(await Effect.runPromiseExit(makeRepro(async () => project)([missed, "--frame", "1", "--out", join(directory, "missed.json")])))).toBe(true);
  expect(() => readFileSync(join(directory, "missed.json"))).toThrow();
});

test("field diffs sort paths and distinguish added and removed canonical fields", () => {
  const frame = { frame: 0, checksum: "x", state: "x", fields: [{ path: "z", value: "1" }, { path: "a", value: "2" }] };
  expect(diffReproStates(frame, { ...frame, fields: [{ path: "z", value: "3" }, { path: "b", value: "4" }] })).toEqual([
    { path: "a", before: "2", after: null }, { path: "b", before: null, after: "4" }, { path: "z", before: "1", after: "3" },
  ]);
});

test("repro --json emits client results and a final summary on checksum failure", async () => {
  const lines: string[] = [];
  const log = console.log;
  console.log = (line: string) => void lines.push(line);
  try {
    const file = writeReproFile("total-12");
    const exit = await Effect.runPromiseExit(makeRepro(async () => project)([file, "--json"]));
    expect(Exit.isFailure(exit)).toBe(true);
    const rows = lines.map(line => JSON.parse(line));
    expect(rows.slice(0, 2).map(row => [row.type, row.kind, row.frame, row.client, row.repro])).toEqual([0, 1].map(client => ["result", "desync", 3, client, file]));
    expect(rows.at(-1)).toMatchObject({ schema: 1, command: "repro", type: "summary", ok: false, counts: { results: 2, failures: 2 } });
    expect(rows.at(-1).elapsedMs).toBeGreaterThanOrEqual(0);
  } finally { console.log = log; }
});
