


import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "bun:test";
import { farmTest } from "../scripts/wisp/farmTest";
import { Effect, Layer } from "effect";
import { mapCompiler, report } from "../scripts/compiler";
import { servePanel } from "../scripts/wisp/commands/tune";
import { HotReload } from "../scripts/wisp/hotReload";
import { Tune, type Tunable, checkValue, findLiteral, lineDiff, literalText, replaceSpans } from "../scripts/wisp/tune";
import { moduleChunk, moduleHashText, moduleIndex, modulePayload, textChecksum } from "../src/runtime/modules";
import type { BundledModules } from "../scripts/luaBundle";

const root = join(import.meta.dir, "..");

const DECLARATION = `// Tuning.
import { f32 } from "../../../src/sim/f32";

function scaled(units: number): number {
  return f32(units * 0.5);
}

export interface Tuning {
  readonly speed: number;
  readonly steps: number;
}

export const TUNING: Tuning = {
  speed: scaled(0.5),
  steps: 2,
};

export const OFFSET = -1.5;
`;

const TUNABLES: readonly Tunable[] = [
  { name: "speed", file: "src/tuning.ts", path: ["TUNING", "speed"], kind: "f32", min: 0.0, max: 2.0, step: 0.01 },
  { name: "steps", group: "Counts", file: "src/tuning.ts", path: ["TUNING", "steps"], kind: "int", min: 1, max: 8, step: 1 },
];

test("[reference] a tunable's literal is found through objects and a wrapping call, and written as its binary32 or integer value", () => {
  const speed = findLiteral(DECLARATION, ["TUNING", "speed"]);
  expect(typeof speed === "string" ? speed : DECLARATION.slice(speed.start, speed.end)).toBe("0.5");
  const offset = findLiteral(DECLARATION, ["OFFSET"]);
  expect(typeof offset === "string" ? offset : [offset.text, offset.value]).toEqual(["-1.5", -1.5]);
  expect(literalText("f32", 2.2)).toBe("2.200000047683716");
  expect(literalText("f32", 3)).toBe("3.0");
  expect(literalText("f32", -0.25)).toBe("-0.25");
  expect(literalText("int", 4)).toBe("4");

  for (const value of [0.1, 2.2, 1.85, 123.456, 1e-8]) expect(Math.fround(Number(literalText("f32", value)))).toBe(Number(literalText("f32", value)));
  const speedTunable = TUNABLES[0]!;
  expect(checkValue(speedTunable, 0.6)).toBe(Math.fround(0.6));
});

test("[reference] a kept value's diff is its line with three lines of context, as git shows it", () => {
  const literal = findLiteral(DECLARATION, ["TUNING", "steps"]);
  if (typeof literal === "string") throw new Error(literal);
  const after = replaceSpans(DECLARATION, [{ start: literal.start, end: literal.end, text: "3" }]);
  expect(after).toBe(DECLARATION.replace("steps: 2,", "steps: 3,"));
  expect(lineDiff("src/tuning.ts", DECLARATION, after)).toBe([
    "--- a/src/tuning.ts",
    "+++ b/src/tuning.ts",
    "@@ -12,7 +12,7 @@",
    " ",
    " export const TUNING: Tuning = {",
    "   speed: scaled(0.5),",
    "-  steps: 2,",
    "+  steps: 3,",
    " };",
    " ",
    " export const OFFSET = -1.5;",
  ].join("\n"));

  mkdirSync(join(root, "build"), { recursive: true });
  const directory = mkdtempSync(join(root, "build/tune-diff-"));
  try {
    mkdirSync(join(directory, "src"));
    writeFileSync(join(directory, "src/tuning.ts"), DECLARATION);
    writeFileSync(join(directory, "change.diff"), `${lineDiff("src/tuning.ts", DECLARATION, after)}\n`);
    const applied = Bun.spawnSync(["git", "apply", "change.diff"], { cwd: directory, stdout: "pipe", stderr: "pipe" });
    expect({ code: applied.exitCode, stderr: applied.stderr.toString() }).toEqual({ code: 0, stderr: "" });
    expect(readFileSync(join(directory, "src/tuning.ts"), "utf8")).toBe(after);
  } finally {
    rmSync(directory, { recursive: true });
  }
});

const MAIN = `import { configureRuntime } from "../../../src/runtime/config";
import { installDispatch, on, trampoline } from "../../../src/platform/dispatch";
import { installHotReload, startHotReload } from "../../../src/platform/hotReload";
import { f32 } from "../../../src/sim/f32";
import { TUNING } from "./tuning";

declare global {
  var __tuneFixture: { ticks: number; x: number; steps: number[]; installs: number[]; unit: unit } | undefined;
}

export function install(): void {
  configureRuntime({ filePrefix: "tune", readyPrefix: "TN_HRR", globalPrefix: "__tune" });
  installDispatch();
  installHotReload();
  const state = globalThis.__tuneFixture;
  if (state !== undefined) state.installs.push(state.ticks);
  on("tune.tick", () => {
    const fixture = globalThis.__tuneFixture;
    if (fixture === undefined) return;
    const step = f32(TUNING.speed * TUNING.steps);
    fixture.ticks = fixture.ticks + 1;
    fixture.steps.push(step);
    fixture.x = f32(fixture.x + step);
    SetUnitX(fixture.unit, fixture.x);
  });
}

export function start(): void {
  install();
  globalThis.__tuneFixture = { ticks: 0, x: 0.0, steps: [], installs: [], unit: CreateUnit(Player(0), 0x68666f6f, 0.0, 0.0, 0.0) };
  startHotReload();
  TimerStart(CreateTimer(), 0.01666666753590107, true, trampoline("tune.tick"));
}
`;


function payload(bundled: BundledModules): string {
  const modules = bundled.modules.map((module) => ({ name: module.name, text: Buffer.from(moduleChunk(module.code), "utf8").toString("latin1") }));
  const index = moduleIndex(bundled.entry, modules.map(({ name, text }) => [name, textChecksum(moduleHashText(name, text))] as const));
  return modulePayload(index, modules);
}

farmTest("[spec docs/tune.md] a tuned value is compiled in memory, sent as a delta of its module alone and installed by two Lua32 clients on the same tick", async () => {
  mkdirSync(join(root, "build"), { recursive: true });
  const directory = mkdtempSync(join(root, "build/tune-"));
  try {
    const src = join(directory, "src");
    mkdirSync(src);
    writeFileSync(join(directory, "tsconfig.json"), JSON.stringify({
      compilerOptions: {
        target: "ESNext", lib: ["ESNext"], module: "ESNext", moduleResolution: "Bundler", strict: true,
        noUncheckedIndexedAccess: true, exactOptionalPropertyTypes: true, noEmitOnError: true, skipLibCheck: true,
        types: ["lua-types/5.3"], rootDir: "../..", outDir: "out", sourceMap: true,
      },
      include: ["src/**/*.ts", "../../src/natives/warcraft.d.ts"],
      tstl: { luaTarget: "5.3", luaBundle: "map.lua", luaBundleEntry: "src/main.ts", noImplicitSelf: true, noHeader: true, luaPlugins: [{ name: "../../plugins/warcraft-numbers.ts" }] },
    }));
    writeFileSync(join(src, "main.ts"), MAIN);
    writeFileSync(join(src, "tuning.ts"), DECLARATION);
    const replacements = new Map<string, string>();
    const compile = mapCompiler(join(directory, "tsconfig.json"), () => replacements);
    expect(report(compile())).toBe("");
    const untuned = compile.modules();
    if (untuned === undefined) throw new Error("the compiler kept no modules");
    writeFileSync(join(directory, "untuned.payload"), Buffer.from(payload(untuned), "latin1"));
    const bundle = join(directory, "map.lua");
    copyFileSync(join(directory, "out/map.lua"), bundle);
    const written = statSync(join(directory, "out/map.lua")).mtimeMs;


    let tuned: BundledModules | undefined;
    const reload = HotReload.of({
      publish: Effect.sync(() => {
        expect(report(compile())).toBe("");
        tuned = compile.modules();
        return 1;
      }),
    });
    const applied = await Effect.runPromise(Effect.gen(function*() {
      const tune = yield* Tune;
      return yield* tune.apply("speed", 0.6);
    }).pipe(Effect.provide(Tune.layer(directory, TUNABLES, replacements).pipe(Layer.provide(Layer.succeed(HotReload, reload))))));
    expect(applied.version).toBe(1);
    if (tuned === undefined) throw new Error("tune published nothing");
    expect(replacements.get(join(src, "tuning.ts"))).toBe(DECLARATION.replace("scaled(0.5)", "scaled(0.6000000238418579)"));

    expect(readFileSync(join(src, "tuning.ts"), "utf8")).toBe(DECLARATION);
    expect(statSync(join(directory, "out/map.lua")).mtimeMs).toBe(written);
    const changed = tuned.modules.filter((module) => untuned.modules.find(({ name }) => name === module.name)?.code !== module.code).map(({ name }) => name);
    expect(changed.map((name) => name.slice(name.lastIndexOf(".") + 1))).toEqual(["tuning"]);
    writeFileSync(join(directory, "tuned.payload"), Buffer.from(payload(tuned), "latin1"));

    expect(report(mapCompiler(join(import.meta.dir, "tsconfig.tune.json"))())).toBe("");
    const run = Bun.spawnSync([
      process.env.LUA ?? "lua", join(root, "build/tune-tests/tune.lua"),
      bundle, join(root, "src/natives/warcraft.d.ts"), join(directory, "untuned.payload"), join(directory, "tuned.payload"),
    ], { stdout: "pipe", stderr: "pipe" });
    const output = run.stdout.toString();
    expect({ code: run.exitCode, stderr: run.stderr.toString() }).toEqual({ code: 0, stderr: "" });
    expect(output).toContain("tune contract passed");
    expect(output).toMatch(/tuned module \S+\.src\.tuning, delta \d+ of \d+ bytes/);
    const [, before, after] = /step before ([\d.]+), after ([\d.]+)/.exec(output) ?? [];
    expect(Number(before)).toBe(0.5);
    expect(Number(after)).toBeCloseTo(Math.fround(Math.fround(0.6) * 0.5) * 2, 6);
  } finally {
    rmSync(directory, { recursive: true });
  }
}, 120_000);

test("[spec docs/tune.md] the panel refuses another site's requests: a different host, or a form post without a preflight", async () => {
  mkdirSync(join(root, "build"), { recursive: true });
  const directory = mkdtempSync(join(root, "build/tune-panel-"));
  try {
    mkdirSync(join(directory, "src"));
    const file = join(directory, "src/tuning.ts");
    writeFileSync(file, DECLARATION);
    const replacements = new Map<string, string>();
    const published: (string | undefined)[] = [];
    const reload = HotReload.of({ publish: Effect.sync(() => published.push(replacements.get(file))) });
    const layer = Tune.layer(directory, TUNABLES, replacements).pipe(Layer.provide(Layer.succeed(HotReload, reload)));
    await Effect.runPromise(Effect.scoped(Effect.gen(function*() {
      const address = yield* servePanel(0);
      const post = (path: string, body: unknown, headers: Record<string, string> = {}) => Effect.promise(async () => {
        const response = await fetch(new URL(path, address), { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
        return response.status;
      });
      expect(yield* post("/apply", { name: "steps", value: 4 }, { host: "tune.example:80" })).toBe(403);
      expect(yield* post("/apply", { name: "steps", value: 4 }, { "content-type": "text/plain" })).toBe(404);
      expect(published).toEqual([]);
      expect(readFileSync(file, "utf8")).toBe(DECLARATION);
    })).pipe(Effect.provide(layer)));
  } finally {
    rmSync(directory, { recursive: true });
  }
});
