// The soak (wisp:docs/soak.md) on a test map whose policies switch faults on:
// a clean match finds nothing and repeats from its seed, each fault is found
// by its detector, a repro file plays the match again, and the command runs
// matches in worker processes and writes a repro file per finding.
import { afterAll, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Console, Effect, Exit } from "effect";
import { makeSoak } from "../scripts/wisp/commands/soak";
import { installHeadless } from "../scripts/wisp/headless";
import { type SceneReport, bodyProblems } from "../scripts/wisp/scene";
import { type SoakMatch, fuzzedInputs, planSoak, playSoakMatch, readSoakRepro, soakRepro } from "../scripts/wisp/soak";
import { timingsLayer } from "../scripts/wisp/timings";
import game from "./soak/game";
import project from "./soak/project";

const runtime = installHeadless(project.map);
afterAll(runtime.restore);

const match = (policies: readonly string[], seed = 7): SoakMatch => ({ index: 0, seed, fighters: ["a", "b"], stage: "flat", policies, frames: 600 });
const play = (policies: readonly string[], setup = project) => playSoakMatch(runtime, game, setup, match(policies));

test("a clean match ends with no findings, faster than real time, and repeats from its seed", () => {
  const started = performance.now();
  const first = play(["fuzz", "fuzz"]);
  const elapsed = performance.now() - started;
  expect(first.findings).toEqual([]);
  expect(first.over).toBe(true);
  expect(first.inputs.edges.length).toBeGreaterThan(20);
  expect(first.wallMs).toBeGreaterThan(elapsed * 5);
  const second = play(["fuzz", "fuzz"]);
  expect(second.checksums).toEqual(first.checksums);
  expect(second.inputs).toEqual(first.inputs);
});

test("each fault is found by its detector", () => {
  const kinds = (policies: readonly string[], setup = project) => play(policies, setup).findings.map(({ kind, text }) => `${kind}: ${text.split("\n")[0]}`);
  expect(kinds(["fuzz", "freeze"])).toEqual([
    "stall: the match froze at confirmed frame 90: no progress for 3.0 s and no player is told why",
    "unfinished: the match didn't end in 600 frames",
  ]);
  const desync = kinds(["fuzz", "desync"]);
  expect(desync.length).toBe(1);
  expect(desync[0]).toStartWith("desync: native calls differ after frame 120");
  const error = kinds(["fuzz", "throw"]);
  expect(error.length).toBe(2);
  expect(error[0]).toContain("tick 150 failed");
  const heavy = kinds(["fuzz", "heavy"], { ...project, limits: { costScale: 100, warmUpFrames: 0 } });
  expect(heavy.some((finding) => finding.startsWith("catch-up: the game fell"))).toBe(true);
  expect(heavy.some((finding) => finding.startsWith("cost: "))).toBe(true);
});

test("a repro file plays its match again with the same inputs, calls and findings", () => {
  const found = play(["fuzz", "freeze"]);
  const repro = readSoakRepro(JSON.stringify(soakRepro(project.name, found)));
  const again = playSoakMatch(runtime, game, project, repro.match, repro.inputs);
  expect(again.checksums).toEqual(found.checksums);
  expect(again.findings).toEqual(found.findings);
});

test("the fuzzer makes edges in one frame, holds, chords and stick flicks, and presses a toggle twice", () => {
  const source = fuzzedInputs(match(["fuzz", "cpu"], 11), project.controller);
  for (let frame = 1; frame <= 3600; frame++) source.frame(frame);
  const { edges, silences, hitches } = source.recorded();
  expect(edges.every(([, slot]) => slot === 0)).toBe(true);
  const byFrame = Map.groupBy(edges, ([frame]) => frame);
  const sameFrameTap = [...byFrame.values()].some((list) => list.some(([, , a]) => "button" in a && a.down && list.some(([, , b]) => "button" in b && b.button === a.button && !b.down)));
  expect(sameFrameTap).toBe(true);
  expect(edges.some(([, , edge]) => "axis" in edge && Math.abs(edge.value) === 127)).toBe(true);
  expect(edges.some(([, , edge]) => "axis" in edge && edge.value !== 0 && Math.abs(edge.value) <= 20)).toBe(true);
  const toggles = edges.flatMap(([frame, , edge]) => ("button" in edge && edge.button === 2 && edge.down ? [frame] : []));
  expect(toggles.some((frame, index) => index > 0 && frame - (toggles[index - 1] ?? 0) >= 10 && frame - (toggles[index - 1] ?? 0) <= 120)).toBe(true);
  expect(silences.length + hitches.length).toBeGreaterThan(0);
});

test("a plan has every ordered fighter pair on every stage before it repeats", () => {
  const plan = planSoak({ fighters: ["a", "b", "c"], stages: ["x", "y"], policies: [["fuzz", "cpu"], ["cpu", "cpu"]] }, 20, 1, 600);
  expect(new Set(plan.slice(0, 18).map(({ fighters, stage }) => `${fighters.join("-")}@${stage}`)).size).toBe(18);
  expect(plan[18]?.policies).toEqual(["cpu", "cpu"]);
  expect(new Set(plan.map(({ seed }) => seed)).size).toBe(20);
});

test("a fighter in play with nothing of it drawn with geometry is an invisible fighter", () => {
  const report = (drawn: number): SceneReport => ({
    serial: 1, frame: 600, effects: 3,
    models: [{ model: "Clip0.mdx", live: 2, inView: 2, drawn, created: 0, age: 10, longest: 10, destroyed: 0 }],
  });
  const bodies = [{ name: "Illidan (Player 1)", models: ["Clip0.mdx"] }, { name: "Illidan (Player 2)", models: ["Clip0.mdx"] }];
  const solid = { "Clip0.mdx": { geosets: 1, triangles: 100, lights: 0, emitters: [] } };
  expect(bodyProblems(report(2), bodies, solid)).toEqual([]);
  expect(bodyProblems(report(1), bodies, solid).map(({ seen }) => seen)).toEqual([
    "invisible fighter: Illidan (Player 1) and Illidan (Player 2) are in play, but only 1 of them is drawn with geometry",
  ]);
  const empty = { "Clip0.mdx": { geosets: 1, triangles: 0, lights: 0, emitters: [] } };
  expect(bodyProblems(report(2), bodies, empty)[0]?.evidence).toBe("drawn without triangles: Clip0.mdx (2)");
});

test("the command plays matches in worker processes and keeps a repro file for each finding", async () => {
  const out = mkdtempSync(join(tmpdir(), "wisp-soak-"));
  const lines: string[] = [];
  const soak = makeSoak({ project: join(import.meta.dir, "soak/project.ts"), out });
  const run = (args: readonly string[]) => Effect.runPromiseExit(soak(args).pipe(Effect.provide(timingsLayer(() => undefined)), Effect.provideService(Console.Console, {
    ...console, log: (...text: unknown[]) => lines.push(text.join(" ")),
  })));
  const exit = await run(["--matches", "6", "--workers", "2", "--policy", "freeze", "--out", out]);
  expect(Exit.isFailure(exit)).toBe(true);
  const files = readdirSync(out).sort();
  expect(files.filter((file) => file.endsWith(".json"))).toEqual(["match-0.json", "match-1.json", "match-2.json", "match-3.json", "match-4.json", "match-5.json"]);
  // The game's repro of the moment of each match's first finding, as its repro key saves one.
  expect(files).toContain("match-0-p1.txt");
  expect(readFileSync(join(out, "match-0-p1.txt"), "utf8")).toContain("wisp-repro 1");
  expect(lines.join("\n")).toContain("6 matches, ");
  const repro = readSoakRepro(readFileSync(join(out, "match-0.json"), "utf8"));
  expect(repro.findings.map(({ kind }) => kind)).toEqual(["stall", "unfinished"]);
  lines.length = 0;
  const replayed = await run(["--repro", join(out, "match-0.json")]);
  expect(Exit.isFailure(replayed)).toBe(true);
  expect(lines.join("\n")).toContain("native call checksums equal the recorded ones");
  expect(Exit.isFailure(await run(["--workers", "5"]))).toBe(true);
});
