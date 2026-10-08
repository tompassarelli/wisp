// The soak (wisp:docs/soak.md) on a test map whose policies switch faults on:
// a clean match finds nothing and repeats from its seed, each fault is found
// by its detector, a repro file plays the match again, and the command runs
// matches in worker processes and writes a repro file per finding.
import { afterAll, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Console, Effect, Exit } from "effect";
import { makeSoak, typingStallsLine } from "../scripts/wisp/commands/soak";
import { installHeadless } from "../scripts/wisp/headless";
import type { Lockstep } from "../src/headless/lockstep";
import { type SceneReport, bodyProblems } from "../scripts/wisp/scene";
import { RealtimeClients } from "../scripts/wisp/headlessInput";
import { type SoakMatch, SoakMonitor, fuzzedInputs, helperRecorder, planSoak, playSoakMatch, readSoakRepro, soakRepro } from "../scripts/wisp/soak";
import { MEASURED_BATTLE_NET, syncDelivery } from "../src/headless/syncChannel";
import { timingsLayer } from "../scripts/wisp/timings";
import { timingTest } from "../scripts/wisp/timingTest";
import game from "./soak/game";
import project from "./soak/project";

const runtime = installHeadless(project.map);
afterAll(runtime.restore);

const match = (policies: readonly string[], seed = 7): SoakMatch => ({ index: 0, seed, fighters: ["a", "b"], stage: "flat", policies, frames: 600 });
const play = (policies: readonly string[], setup = project) => playSoakMatch(runtime, game, setup, match(policies));

timingTest("a clean match plays more than five times faster than real time", () => {
  const started = performance.now();
  const match = play(["fuzz", "fuzz"]);
  const elapsed = performance.now() - started;
  console.info(`soak match: ${match.wallMs.toFixed(0)} ms of play in ${elapsed.toFixed(0)} ms`);
  expect(match.wallMs).toBeGreaterThan(elapsed * 5);
});

test("a clean match ends with no findings and repeats from its seed", () => {
  const first = play(["fuzz", "fuzz"]);
  expect(first.findings).toEqual([]);
  expect(first.over).toBe(true);
  expect(first.inputs.edges.length).toBeGreaterThan(20);
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
  // The game's own detector, reported once per client though it finds the loop on every frame after.
  expect(kinds(["fuzz", "loop"])).toEqual(["game: loop: tick 200 repeats tick 150", "game: loop: tick 200 repeats tick 150"]);
  const heavy = kinds(["fuzz", "heavy"], { ...project, limits: { costScale: 100, warmUpFrames: 0 } });
  expect(heavy.some((finding) => finding.startsWith("catch-up: the game fell"))).toBe(true);
  expect(heavy.some((finding) => finding.startsWith("cost: "))).toBe(true);
  // Warcraft's edit-box stall (nativeCost.ts): 600 characters typed at once stop the game 180 ms, a typing finding.
  const typing = kinds(["fuzz", "typing"], { ...project, limits: { warmUpFrames: 0 } });
  expect(typing).toEqual([
    expect.stringMatching(/^typing: p1's frame \d+ has a recovery typing stall of 180\.0 ms, over the 16\.7 ms budget of what its input helper may type at once$/),
  ]);
  // Within the budget the game declares, such as its helper's, a typing stall is no finding, but it is counted.
  const within = play(["fuzz", "typing"], { ...project, limits: { warmUpFrames: 0, typingMs: 200 } });
  expect(within.findings.filter(({ kind }) => kind === "typing")).toEqual([]);
  expect(within.typingStallsMs.length).toBeGreaterThan(2);
  expect(within.typingStallsMs.every((ms) => ms === 180)).toBe(true);
  expect(typingStallsLine(within.typingStallsMs, 200)).toBe(`recovery typing stalls: ${within.typingStallsMs.length} client frames over 1/60 s, worst 180.0 ms, p95 180.0 ms; budget 200.0 ms, none over it`);
  expect(typingStallsLine([20, 30, 40], 32.768)).toBe("recovery typing stalls: 3 client frames over 1/60 s, worst 40.0 ms, p95 40.0 ms; budget 32.8 ms, 1 over it");
});

test("a repro file plays its match again with the same inputs, calls and findings", () => {
  const found = play(["fuzz", "freeze"]);
  const repro = readSoakRepro(JSON.stringify(soakRepro(project.name, found)));
  const again = playSoakMatch(runtime, game, project, repro.match, repro.inputs);
  expect(again.checksums).toEqual(found.checksums);
  expect(again.findings).toEqual(found.findings);
  const looped = play(["fuzz", "loop"]);
  expect(readSoakRepro(JSON.stringify(soakRepro(project.name, looped))).findings).toEqual(looped.findings);
});

test("a match played through input helpers replays what they typed, not their pads' edges, such as a stick inside its dead zone", () => {
  const helperMatch: SoakMatch = { ...match(["fuzz", "cpu"]), typed: true };
  // wc3-journal's pad: a full-scale stick, here held inside its 0.28 dead zone (9175), which reached the map only as typed text.
  const inputs = {
    edges: [[11, 0, { axis: 1, value: -9083 }], [12, 0, { axis: 1, value: 7396 }], [13, 0, { axis: 0, value: 752 }]] as const,
    silences: [], hitches: [], slow: [],
    typed: [[20, 0, "aa"], [40, 1, "a"]] as const,
    files: [[30, 1, "soaktest-note.txt", ["noted"]]] as const,
  };
  const played = playSoakMatch(runtime, game, project, helperMatch, inputs);
  expect(played.findings).toEqual([]);
  const replayed = playSoakMatch(runtime, game, project, readSoakRepro(JSON.stringify(soakRepro(project.name, played))).match, played.inputs);
  expect(replayed.checksums).toEqual(played.checksums);
  expect(replayed.findings).toEqual([]);
  // The pads' edges never reach the game; the typed A's do, in both clients.
  expect(playSoakMatch(runtime, game, project, helperMatch, { ...inputs, edges: [] }).checksums).toEqual(played.checksums);
  expect(playSoakMatch(runtime, game, project, helperMatch, { ...inputs, typed: [] }).checksums).not.toEqual(played.checksums);
});

test("a real-time run through input helpers, recorded with helperRecorder, replays onto the same native calls", () => {
  const helperMatch: SoakMatch = { ...match(["fuzz", "cpu"]), typed: true };
  // Each helper types at wall-clock frames of its own, as a program appending to its typed file does.
  const typing = new Map([[0, [[25, "aa"], [90, "a"]]], [1, [[60, "a"]]]] as const);
  let now = 0;
  let monitor: SoakMonitor | undefined;
  const recorder = helperRecorder(() => (monitor === undefined ? 0 : monitor.frame + 1));
  const helper = (slot: number) => {
    const pending = [...(typing.get(slot) ?? [])];
    return recorder.input(slot, { read: () => pending.splice(0, pending.filter(([frame]) => (frame * 1000) / 60 <= now).length).map(([, text]) => text), close: () => undefined });
  };
  const clients = runtime.clients(game.entry, [0, 1], { delivery: syncDelivery(MEASURED_BATTLE_NET, helperMatch.seed), keepCalls: 64 });
  const realtime = new RealtimeClients(clients, new Map([[0, helper(0)], [1, helper(1)]]), () => now, () => monitor?.afterFrame(now, new Set()));
  realtime.start();
  monitor = new SoakMonitor(clients, game.begin(clients, helperMatch));
  while (!monitor.done) {
    now += 1000 / 60;
    realtime.advance();
  }
  const inputs = recorder.recorded({ edges: [], silences: [], hitches: [], slow: [] });
  // Typed by wall-clock frame 25, it reaches the client before frame 25 runs.
  expect(inputs.typed).toEqual([[25, 0, "aa"], [60, 1, "a"], [90, 0, "a"]]);
  const replayed = playSoakMatch(runtime, game, project, helperMatch, inputs);
  expect(replayed.findings).toEqual([]);
  expect(replayed.checksums).toEqual(clients.clients.map((client) => client.checksum()));
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
  expect(files.filter((file) => file.endsWith(".json"))).toEqual(Array.from({ length: 6 }, (_, index) => [`match-${index}.json`, `match-${index}.original.json`]).flat());
  // The game's repro of the moment of each match's first finding, as its repro key saves one.
  expect(files).toContain("match-0-p1.txt");
  expect(readFileSync(join(out, "match-0-p1.txt"), "utf8")).toContain("wisp-repro 1");
  expect(lines.join("\n")).toContain("6 matches, ");
  const repro = readSoakRepro(readFileSync(join(out, "match-0.json"), "utf8"));
  expect(repro.findings.map(({ kind }) => kind)).toEqual(["stall", "unfinished"]);
  const original = readSoakRepro(readFileSync(join(out, "match-0.original.json"), "utf8"));
  expect(original.inputs.edges.length).toBeGreaterThan(0);
  expect(repro.inputs.edges).toEqual([]);
  lines.length = 0;
  const replayed = await run(["--repro", join(out, "match-0.json")]);
  expect(Exit.isFailure(replayed)).toBe(true);
  expect(lines.join("\n")).toContain("native call checksums equal the recorded ones");
  const unshrunk = mkdtempSync(join(tmpdir(), "wisp-soak-unshrunk-"));
  await run(["--matches", "1", "--workers", "1", "--policy", "freeze", "--out", unshrunk, "--no-shrink"]);
  expect(readdirSync(unshrunk)).not.toContain("match-0.original.json");
  expect(readSoakRepro(readFileSync(join(unshrunk, "match-0.json"), "utf8")).inputs.edges.length).toBeGreaterThan(0);
  expect(Exit.isFailure(await run(["--workers", "5"]))).toBe(true);
});

test("a lag spike's catch-up after a usual backlog's rise is no spiral; input left further behind each second is", () => {
  /** The catch-up findings of a match whose one client reports `backlog(frame)` frames of input not yet played, on a clock that keeps real time. */
  const catchUps = (backlog: (frame: number) => number, frames: number) => {
    let frame = 0;
    const client = { slot: 0, errors: [], thrown: [], files: new Map(), run: (body: () => void) => body() };
    const clients = { clients: [client], costs: [0], firstDivergence: () => undefined } as unknown as Lockstep;
    const monitor = new SoakMonitor(clients, { input: () => {}, observe: () => ({ progress: frame, over: false, backlog: backlog(frame) }) });
    for (frame = 1; frame <= frames; frame++) monitor.afterFrame((frame * 1000) / 60, new Set());
    return monitor.findings.filter(({ kind }) => kind === "catch-up").map(({ text }) => text);
  };
  // Smashcraft's soak, match 96 (6 October): a usual backlog of 11, 17 and 23 frames a second apart, then a
  // 1.5 s spike that leaves 105 frames, played within 42 frames.
  const spike = (frame: number) => (frame < 120 ? 11 : frame < 180 ? 17 : frame < 235 ? 23 : frame < 280 ? 105 - (frame - 235) * 2 : 20);
  expect(catchUps(spike, 600)).toEqual([]);
  const spiral = (frame: number) => 50 + Math.floor(frame / 10);
  expect(catchUps(spiral, 600)).toContain("catch-up spiral: input not yet played grew for 3 s to 80 frames");
});
