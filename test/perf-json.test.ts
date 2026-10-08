import { expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Console, Effect, Exit } from "effect";
import { makePerf } from "../scripts/wisp/commands/perf";
import { PERF_METRICS } from "../scripts/wisp/perf";
import { predictedOverlay } from "../scripts/wisp/nativeFit";
import { WARCRAFT_COST } from "../src/headless/nativeCost";

const root = join(import.meta.dir, "..");
const command = makePerf({
  map: { config: join(import.meta.dir, "tsconfig.meter-map.json"), bundle: join(root, "build/meter-tests/map.lua") },
  program: { config: join(import.meta.dir, "tsconfig.perf-json.json"), bundle: join(root, "build/meter-tests/perf.lua") },
});

async function run(args: readonly string[]) {
  const lines: string[] = [];
  const output: Console.Console = Object.assign(Object.create(console), { log: (...values: readonly unknown[]) => { lines.push(values.join(" ")); } });
  const exit = await Effect.runPromiseExit(command(args).pipe(Effect.provideService(Console.Console, output)));
  return { exit, lines };
}

function json(lines: readonly string[], name: string, ok: boolean, results: number) {
  const objects = lines.map((line) => JSON.parse(line));
  for (const object of objects) expect(object).toMatchObject({ schema: 1, command: name });
  expect(objects.at(-1)).toMatchObject({ type: "summary", ok, counts: { results, failures: ok ? 0 : 1 }, elapsedMs: expect.any(Number) });
  return objects;
}

const perfText = (mean: number) => [
  "frames 120 step 100 problems 0", "collector us=4 kb=2",
  ...PERF_METRICS.map((metric) => `p0 ${metric} start=0 total=120 median=1 p95=1 mean=${metric === "instructions" ? mean : 1} max=1`),
].join("\n");

const temporary = async (body: (directory: string) => Promise<void>) => {
  const directory = mkdtempSync(join(tmpdir(), "wisp-perf-json-"));
  try { await body(directory); } finally { rmSync(directory, { recursive: true }); }
};

test("perf --json plays the compiled map, keeps samples in --out, and ends with a summary", async () => {
  await temporary(async (directory) => {
    const out = join(directory, "samples.perf");
    const result = await run(["--json", "--frames", "30", "--samples", "--out", out]);
    if (Exit.isFailure(result.exit)) throw new Error(result.lines.join("\n"));
    expect(Exit.isSuccess(result.exit)).toBe(true);
    const objects = json(result.lines, "perf", true, 1);
    expect(objects[0]).toMatchObject({ type: "result", name: "journey", frames: 30, problems: 0 });
    expect(objects[0].clients.length).toBe(2);
    expect(objects[0].clients[0]).toMatchObject({ client: 0, metrics: { instructions: { mean: expect.any(Number) } } });
    expect(await Bun.file(out).text()).toContain("frame 1 p0 instructions=");
  });
}, 120_000);

test("perf compare --json reports success and budget failures; text stays readable", async () => {
  await temporary(async (directory) => {
    const a = join(directory, "a.perf");
    const b = join(directory, "b.perf");
    writeFileSync(a, perfText(1));
    writeFileSync(b, perfText(2));
    const passed = await run(["compare", a, a, "--json"]);
    expect(Exit.isSuccess(passed.exit)).toBe(true);
    expect(json(passed.lines, "perf compare", true, 1)[0]).toMatchObject({ threshold: 0.05, regressions: [] });
    const failed = await run(["compare", a, b, "--json"]);
    expect(Exit.isFailure(failed.exit)).toBe(true);
    expect(json(failed.lines, "perf compare", false, 1)[1]).toMatchObject({ type: "failure", kind: "budget", frame: null, client: null, message: expect.stringContaining("B is worse") });
    const human = await run(["compare", a, a]);
    expect(human.lines[0]).toStartWith("A: 120 frames");
    expect(human.lines.at(-1)).toBe("B is no worse than A beyond 5%");
  });
});

test("perf native and fit --json report native measurements and fitted cases", async () => {
  await temporary(async (directory) => {
    const samples = join(directory, "samples.perf");
    const readings = join(directory, "readings.json");
    const frames = Array.from({ length: 120 }, () => ({ instructions: 1000, natives: 100, allocatedKb: 1, typedCharacters: 0 }));
    const predicted = predictedOverlay(WARCRAFT_COST, frames, 0.001);
    writeFileSync(samples, frames.map((_, index) => `frame ${index + 1} p0 instructions=1000 lua-us=2 natives=100 alloc-bytes=1024 typed=0`).join("\n"));
    writeFileSync(readings, JSON.stringify({ clockStepMs: 0.001, windows: [predicted] }));
    const native = await run(["native", readings, "--samples", samples, "--json"]);
    expect(Exit.isSuccess(native.exit)).toBe(true);
    expect(json(native.lines, "perf native", true, 1)[0]).toMatchObject({ type: "result", passed: true, native: { windows: 1 }, predicted: { windows: 1 } });
    const fit = await run(["fit", `${samples}=${readings}`, `${samples}=${readings}`, "--json"]);
    expect(Exit.isSuccess(fit.exit)).toBe(true);
    const fitted = json(fit.lines, "perf fit", true, 4);
    expect(fitted.slice(0, 4).map((item) => item.fit)).toEqual(["all", "all", "held-out", "held-out"]);
    writeFileSync(readings, JSON.stringify({ windows: [{ median: 100, p95: 100, max: 100 }] }));
    const failed = await run(["native", readings, "--samples", samples, "--json"]);
    expect(Exit.isFailure(failed.exit)).toBe(true);
    expect(json(failed.lines, "perf native", false, 1)[1]).toMatchObject({ type: "failure", kind: "check-fail" });
  });
});

test("perf --json ends malformed arguments and missing inputs with failure and summary", async () => {
  for (const args of [["--frames", "0"], ["compare", "/no/such/a", "/no/such/b"], ["fit", "/no/such/a=/no/such/b"]]) {
    const result = await run([...args, "--json"]);
    expect(Exit.isFailure(result.exit)).toBe(true);
    const name = args[0] === "compare" || args[0] === "fit" ? `perf ${args[0]}` : "perf";
    expect(json(result.lines, name, false, 0)[0]).toMatchObject({ type: "failure", kind: "error", frame: null, client: null, message: expect.any(String) });
  }
});
