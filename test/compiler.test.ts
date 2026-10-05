import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "bun:test";
import { SourceMapConsumer } from "source-map";
import { transpileProject } from "typescript-to-lua";
import { type Phase, mapCompiler, report } from "../scripts/compiler";

test("cached module requires keep the same bundle and source map as full compilation", () => {
  const build = join(import.meta.dir, "../build");
  mkdirSync(build, { recursive: true });
  const directory = mkdtempSync(join(build, "compiler-"));
  mkdirSync(join(directory, "src"));
  const config = join(directory, "tsconfig.json");
  const entry = join(directory, "src/main.ts");
  writeFileSync(join(directory, "src/value.ts"), "export const value = 5;\n");
  writeFileSync(config, JSON.stringify({
    compilerOptions: {
      target: "ESNext", module: "ESNext", moduleResolution: "Bundler", strict: true,
      types: [], skipLibCheck: true, rootDir: "src", outDir: "out", sourceMap: true,
    },
    include: ["src/**/*.ts"],
    tstl: { luaTarget: "5.3", luaBundle: "map.lua", luaBundleEntry: "src/main.ts", noHeader: true },
  }));
  const compile = mapCompiler(config);
  const bundle = join(directory, "out/map.lua");
  const output = () => [readFileSync(bundle, "utf8"), readFileSync(`${bundle}.map`, "utf8")];
  for (const offset of [1, 22, 333]) {
    writeFileSync(entry, `import { value } from "./value";\nexport const result = value + ${offset};\n`);
    expect(report(compile())).toBe("");
    const incremental = output();
    // An unchanged compile must also reuse the original dependency paths.
    expect(report(compile())).toBe("");
    expect(output()).toEqual(incremental);
    expect(report(transpileProject(config).diagnostics)).toBe("");
    expect(output()).toEqual(incremental);
  }
  // A module added, then removed: unchanged modules keep their resolved requires only while the program's files stay.
  for (const main of ["import { value } from \"./value\";\nimport { extra } from \"./extra\";\nexport const result = value + extra;\n", "import { value } from \"./value\";\nexport const result = value;\n"]) {
    if (main.includes("extra")) writeFileSync(join(directory, "src/extra.ts"), "import { value } from \"./value\";\nexport const extra = value * 2;\n");
    else rmSync(join(directory, "src/extra.ts"));
    writeFileSync(entry, main);
    expect(report(compile())).toBe("");
    const incremental = output();
    expect(report(transpileProject(config).diagnostics)).toBe("");
    expect(output()).toEqual(incremental);
  }
});

test("each module's hot-reload chunk is its bundle code and maps its lines as the bundle maps them", async () => {
  const build = join(import.meta.dir, "../build");
  mkdirSync(build, { recursive: true });
  const directory = mkdtempSync(join(build, "compiler-modules-"));
  mkdirSync(join(directory, "src"));
  const config = join(directory, "tsconfig.json");
  writeFileSync(join(directory, "src/value.ts"), "export const values = [5, 6].map((value) => value * 2);\n\nexport function first(): number {\n  return values[0] ?? 0;\n}\n");
  writeFileSync(join(directory, "src/main.ts"), "import { first, values } from \"./value\";\nexport const result = [...values, first()].join(\",\");\n");
  writeFileSync(config, JSON.stringify({
    compilerOptions: {
      target: "ESNext", module: "ESNext", moduleResolution: "Bundler", strict: true,
      types: [], skipLibCheck: true, rootDir: "src", outDir: "out", sourceMap: true,
    },
    include: ["src/**/*.ts"],
    tstl: { luaTarget: "5.3", luaBundle: "map.lua", luaBundleEntry: "src/main.ts", noHeader: true },
  }));
  const compile = mapCompiler(config);
  expect(report(compile())).toBe("");
  const bundled = compile.modules();
  expect(bundled?.entry).toBe("main");
  expect(bundled?.modules.map(({ name }) => name)).toEqual(["lualib_bundle", "value", "main"]);
  const bundle = readFileSync(join(directory, "out/map.lua"), "utf8");
  const mappings = async (map: string, from: number, to: number, offset: number) => {
    const consumer = await new SourceMapConsumer(JSON.parse(map));
    const found: string[] = [];
    consumer.eachMapping((m) => {
      if (m.generatedLine >= from && m.generatedLine < to) found.push(`${m.generatedLine - offset}:${m.generatedColumn} ${m.source}:${m.originalLine}:${m.originalColumn} ${m.name}`);
    });
    consumer.destroy();
    return found;
  };
  for (const module of bundled?.modules ?? []) {
    const entry = `["${module.name}"] = function(...) \n${module.code} end,\n`;
    const at = bundle.indexOf(entry);
    expect(at).toBeGreaterThan(0);
    // The chunk's head and the entry's head are each one line, so the code starts on the same line of each.
    const firstLine = bundle.slice(0, at).split("\n").length;
    const lines = entry.split("\n").length - 1;
    const own = await mappings(module.sourceMap(), 1, lines + 1, 0);
    expect(own).toEqual(await mappings(readFileSync(join(directory, "out/map.lua.map"), "utf8"), firstLine, firstLine + lines, firstLine - 1));
    if (module.name !== "lualib_bundle") expect(own.length).toBeGreaterThan(0);
  }
});

test("a compile reports its phases to the caller's hook, and signatures are primed only on the first", () => {
  const build = join(import.meta.dir, "../build");
  mkdirSync(build, { recursive: true });
  const directory = mkdtempSync(join(build, "compiler-phases-"));
  mkdirSync(join(directory, "src"));
  const config = join(directory, "tsconfig.json");
  writeFileSync(join(directory, "src/main.ts"), "export const result = 1;\n");
  writeFileSync(config, JSON.stringify({
    compilerOptions: { target: "ESNext", module: "ESNext", moduleResolution: "Bundler", strict: true, types: [], skipLibCheck: true, rootDir: "src", outDir: "out" },
    include: ["src/**/*.ts"],
    tstl: { luaTarget: "5.3", luaBundle: "map.lua", luaBundleEntry: "src/main.ts", noHeader: true },
  }));
  const compile = mapCompiler(config);
  const phases: string[] = [];
  const phase: Phase = (name, run) => {
    phases.push(name);
    return run();
  };
  expect(report(compile(phase))).toBe("");
  expect(phases).toEqual(["read config", "create program", "type-check", "declaration signatures", "transpile", "bundle"]);
  phases.length = 0;
  writeFileSync(join(directory, "src/main.ts"), "export const result = 2;\n");
  expect(report(compile(phase))).toBe("");
  expect(phases).toEqual(["read config", "create program", "type-check", "transpile", "bundle"]);
});
