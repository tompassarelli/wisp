import { expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Console, Effect, Exit } from "effect";
import type { Command } from "../scripts/wisp/command";
import { makeHeadless } from "../scripts/wisp/commands/headless";
import { makeSoak } from "../scripts/wisp/commands/soak";
import { timingsLayer } from "../scripts/wisp/timings";

async function capture(command: Command, args: readonly string[]) {
  const lines: string[] = [];
  const exit = await Effect.runPromiseExit(command([...args, "--json"]).pipe(
    Effect.provide(timingsLayer(() => undefined)),
    Effect.provideService(Console.Console, { ...console, log: (...text: unknown[]) => lines.push(text.join(" ")) }),
  ));
  const records = lines.map((line) => JSON.parse(line));
  expect(records.every((record) => record.schema === 1)).toBe(true);
  expect(records.filter((record) => record.type === "summary")).toHaveLength(1);
  const summary = records.at(-1);
  expect(summary).toMatchObject({ type: "summary", ok: Exit.isSuccess(exit), counts: {
    results: records.filter((record) => record.type === "result").length,
    failures: records.filter((record) => record.type === "failure").length,
  } });
  expect(summary.elapsedMs).toBeGreaterThanOrEqual(0);
  return { exit, records, summary };
}

const headless = (frames: number) => makeHeadless(async () => ({
  map: { filePrefix: "fixture", globalPrefixes: ["__fixture"] },
  entry: join(import.meta.dir, "headless/entry.ts"),
  journeys: { seconds: { frames, events: [] } },
}));

test("headless JSON has a clean result, then a summary", async () => {
  const { records, summary } = await capture(headless(30), []);
  expect(records).toHaveLength(2);
  expect(records[0]).toMatchObject({ command: "headless", type: "result", journey: "seconds", ok: true, frames: 30 });
  expect(summary.counts).toEqual({ results: 1, failures: 0 });
});

test("[invariant] scripted frame stepping and fresh fast-forward starts preserve each client's checksum", async () => {
  const normal = await capture(headless(30), []);
  const stepped = await capture(headless(30), ["--step", "1", "--runs", "3"]);
  expect(Exit.isSuccess(stepped.exit)).toBe(true);
  const clients = normal.records.find((record) => record.type === "result").clients;
  for (const result of stepped.records.filter((record) => record.type === "result")) expect(result.clients).toEqual(clients);
  expect(stepped.records.find((record) => record.type === "benchmark")).toMatchObject({ runs: 3, requestedRuns: 3, frames: 90, failures: 0 });
});

test("[invariant] repeated driver runs stop and name a detected desync", async () => {
  const { exit, records } = await capture(headless(180), ["--step", "7", "--runs", "3"]);
  expect(Exit.isFailure(exit)).toBe(true);
  expect(records.find((record) => record.type === "failure")).toMatchObject({ kind: "desync", frame: 60, client: 1 });
  expect(records.find((record) => record.type === "benchmark")).toMatchObject({ runs: 1, requestedRuns: 3, failures: 1 });
});

test("headless JSON identifies the first divergent frame and client", async () => {
  const { exit, records } = await capture(headless(180), []);
  expect(Exit.isFailure(exit)).toBe(true);
  expect(records.find((record) => record.type === "failure")).toMatchObject({ command: "headless", kind: "desync", frame: 60, client: 1 });
});

test("headless JSON reports a project load error before its summary", async () => {
  const { records, summary } = await capture(makeHeadless(async () => { throw new Error("broken project"); }), []);
  expect(records[0]).toMatchObject({ command: "headless", type: "failure", kind: "error", frame: null, client: null });
  expect(records[0].message).toContain("broken project");
  expect(summary.counts).toEqual({ results: 0, failures: 1 });
});

test("soak JSON reports clean matches and a seeded desync with a replayable repro", async () => {
  const out = mkdtempSync(join(tmpdir(), "wisp-soak-json-"));
  const command = makeSoak({ project: join(import.meta.dir, "soak/json-project.ts"), out });
  const clean = await capture(command, ["--matches", "1", "--workers", "1", "--out", out, "--policy", "clean", "--seed", "7"]);
  expect(clean.records[0]).toMatchObject({ type: "result", command: "soak", ok: true });
  expect(clean.summary.counts).toEqual({ results: 1, failures: 0 });
  const failed = await capture(command, ["--matches", "1", "--workers", "1", "--out", out, "--policy", "desync", "--seed", "7"]);
  expect(Exit.isFailure(failed.exit)).toBe(true);
  const finding = failed.records.find((record) => record.type === "failure");
  expect(finding).toMatchObject({ command: "soak", kind: "desync", frame: 120, client: 1 });
  expect(finding.repro).toBe(join(out, "match-0.json"));
  const replayed = await capture(command, ["--repro", finding.repro]);
  expect(replayed.records.find((record) => record.type === "failure")).toMatchObject({ kind: "desync", frame: 120 });
  expect(replayed.summary.counts).toEqual({ results: 1, failures: 1 });
});

test("soak JSON reports a load error with no result", async () => {
  const { records, summary } = await capture(makeSoak({ project: "/missing/wisp-project.ts", out: tmpdir() }), []);
  expect(records[0]).toMatchObject({ command: "soak", type: "failure", kind: "error", frame: null, client: null });
  expect(summary.counts).toEqual({ results: 0, failures: 1 });
});
