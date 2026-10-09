



import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "bun:test";
import { farmTest } from "../scripts/wisp/farmTest";
import { mapCompiler, report } from "../scripts/compiler";
import { moduleChunk, moduleHashText, moduleIndex, modulePayload, textChecksum } from "../src/runtime/modules";

const root = join(import.meta.dir, "..");

const MAIN = (labelModule: string) => `import { configureRuntime } from "../../../src/runtime/config";
import { installDispatch, on, trampoline } from "../../../src/platform/dispatch";
import { installHotReload, startHotReload } from "../../../src/platform/hotReload";
import { step } from "./counter";
import { label } from "./${labelModule}";

declare global {
  var __modsFixture: { frames: number; unit: unit } | undefined;
}

export function install(): void {
  configureRuntime({ filePrefix: "mods", readyPrefix: "MD_HRR", globalPrefix: "__mods" });
  installDispatch();
  installHotReload();
  on("mods.tick", () => {
    const state = globalThis.__modsFixture;
    if (state === undefined) return;
    state.frames = step(state.frames);
    SetUnitX(state.unit, state.frames);
    BlzSetUnitName(state.unit, label(state.frames));
  });
}

export function start(): void {
  install();
  globalThis.__modsFixture = { frames: 0, unit: CreateUnit(Player(0), 0x68666f6f, 0, 0, 0) };
  startHotReload();
  TimerStart(CreateTimer(), 0.125, true, trampoline("mods.tick"));
}
`;

farmTest("[invariant] full and incremental module reloads end in the same modules, state and native calls in two Lua32 clients; damaged and broken versions are refused everywhere", () => {
  mkdirSync(join(root, "build"), { recursive: true });
  const directory = mkdtempSync(join(root, "build/modules-"));
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
    const compile = mapCompiler(join(directory, "tsconfig.json"));

    const version = (name: string) => {
      expect(report(compile())).toBe("");
      const bundled = compile.modules();
      if (bundled === undefined) throw new Error("the compiler kept no modules");
      const modules = bundled.modules.map((module) => ({ name: module.name, text: Buffer.from(moduleChunk(module.code), "utf8").toString("latin1") }));
      const index = moduleIndex(bundled.entry, modules.map(({ name, text }) => [name, textChecksum(moduleHashText(name, text))] as const));
      const path = join(directory, `${name}.payload`);
      writeFileSync(path, Buffer.from(modulePayload(index, modules), "latin1"));
      return path;
    };
    writeFileSync(join(src, "main.ts"), MAIN("label"));
    writeFileSync(join(src, "counter.ts"), "export const step = (frames: number): number => frames + 1;\n");
    writeFileSync(join(src, "label.ts"), "import { suffix } from \"./extra\";\n\nexport const label = (frames: number): string => `frame ${frames}${suffix}`;\n");
    writeFileSync(join(src, "extra.ts"), "export const suffix = \"!\";\n");
    const v1 = version("v1");

    const bundle = join(directory, "map.lua");
    copyFileSync(join(directory, "out/map.lua"), bundle);
    writeFileSync(join(src, "counter.ts"), "export const step = (frames: number): number => frames + 2;\n");
    const v2 = version("v2");
    rmSync(join(src, "label.ts"));
    rmSync(join(src, "extra.ts"));
    writeFileSync(join(src, "caption.ts"), "export const label = (frames: number): string => `frame ${frames}?`;\n");
    writeFileSync(join(src, "main.ts"), MAIN("caption"));
    const v3 = version("v3");

    expect(report(mapCompiler(join(import.meta.dir, "tsconfig.modules.json"))())).toBe("");
    const run = Bun.spawnSync([
      process.env.LUA ?? "lua", join(root, "build/modules-tests/modules.lua"),
      bundle, join(root, "src/natives/warcraft.d.ts"), v1, v2, v3,
    ], { stdout: "pipe", stderr: "pipe" });
    const output = run.stdout.toString();
    expect({ code: run.exitCode, stderr: run.stderr.toString() }).toEqual({ code: 0, stderr: "" });
    expect(output).toContain("module reload contract passed");

    const [, fullBytes, deltaBytes, changed] = /full payload (\d+) bytes; a changed module's delta (\d+) bytes \(([^)]*)\)/.exec(output) ?? [];
    expect(changed).toEndWith("src.counter");
    expect(Number(deltaBytes)).toBeLessThan(Number(fullBytes) / 4);
    const [, renamed] = /renamed and deleted modules' delta \d+ bytes \(([^)]*)\)/.exec(output) ?? [];
    expect(renamed?.split(", ").map((name) => name.slice(name.lastIndexOf(".") + 1)).sort()).toEqual(["caption", "main"]);
  } finally {
    rmSync(directory, { recursive: true });
  }
}, 120_000);
