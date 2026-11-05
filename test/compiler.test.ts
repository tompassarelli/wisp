import { mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect } from "bun:test";
import { mapCompiler, report } from "../host/toolchain/compiler";
import { farmTest } from "../host/farm/farmTest";

farmTest("[invariant] an edited file's declaration error is reported on every compile until fixed and never publishes", () => {
  const build = join(import.meta.dir, "../build");
  mkdirSync(build, { recursive: true });
  const directory = mkdtempSync(join(build, "compiler-declaration-"));
  mkdirSync(join(directory, "src"));
  const config = join(directory, "tsconfig.json");
  const entry = join(directory, "src/main.ts");
  writeFileSync(join(directory, "src/value.ts"), "export const value = 5;\n");
  writeFileSync(config, JSON.stringify({
    compilerOptions: {
      target: "ESNext", lib: ["ES2015"], module: "ESNext", moduleResolution: "Bundler", strict: true,
      types: [], skipLibCheck: true, rootDir: "src", outDir: "out", sourceMap: true, noEmitOnError: true,
    },
    include: ["src/**/*.ts"],
    tstl: { luaTarget: "5.3", luaBundle: "map.lua", luaBundleEntry: "src/main.ts", noHeader: true },
  }));
  const valid = "import { value } from \"./value\";\nexport const result = value + 1;\n";
  writeFileSync(entry, valid);
  const compile = mapCompiler(config);
  const bundle = join(directory, "out/map.lua");
  expect(report(compile())).toBe("");
  const published = readFileSync(bundle, "utf8");

  writeFileSync(entry, `${valid}export const probe = class { private hidden = 1; };\n`);
  for (let attempt = 0; attempt < 2; attempt++) {
    expect(compile().map((diagnostic) => diagnostic.code)).toContain(4094);
    expect(readFileSync(bundle, "utf8")).toBe(published);
  }
  writeFileSync(entry, valid);
  expect(report(compile())).toBe("");
  expect(readFileSync(bundle, "utf8")).toBe(published);
});

farmTest("[invariant] a disk cache is reused exactly while every module a project plugin loads, across packages, is unchanged", () => {
  const build = join(import.meta.dir, "../build");
  mkdirSync(build, { recursive: true });
  const cache = mkdtempSync(join(build, "compile-cache-plugin-"));
  const checkout = (stamp: string, unused: string, lock: string, wasm: string) => {
    const directory = mkdtempSync(join(build, "compiler-plugin-"));
    mkdirSync(join(directory, "src"));
    mkdirSync(join(directory, "plugins"));
    mkdirSync(join(directory, "node_modules/stamp-text"), { recursive: true });
    mkdirSync(join(directory, "node_modules/source-map/lib"), { recursive: true });
    writeFileSync(join(directory, "bun.lock"), `${lock}\n`);
    writeFileSync(join(directory, "node_modules/stamp-text/package.json"), JSON.stringify({ name: "stamp-text", version: "1.0.0", main: "index.js" }));
    writeFileSync(join(directory, "node_modules/stamp-text/index.js"), 'exports.STAMP = require("./stamp.json").stamp;\n');
    writeFileSync(join(directory, "node_modules/stamp-text/stamp.json"), JSON.stringify({ stamp }));
    writeFileSync(join(directory, "node_modules/stamp-text/unused.js"), `exports.UNUSED = "${unused}";\n`);
    writeFileSync(join(directory, "node_modules/source-map/package.json"), JSON.stringify({ name: "source-map", version: "1.0.0", main: "index.js" }));
    writeFileSync(join(directory, "node_modules/source-map/index.js"), "exports.READY = true;\n");
    writeFileSync(join(directory, "node_modules/source-map/lib/mappings.wasm"), wasm);
    writeFileSync(join(directory, "plugins/stampText.ts"), 'import "source-map";\nexport { STAMP } from "stamp-text";\n');
    writeFileSync(join(directory, "plugins/stamp.ts"), [
      'import ts from "typescript";',
      'import * as tstl from "typescript-to-lua";',
      'import { STAMP } from "./stampText";',
      "const plugin: tstl.Plugin = { visitors: { [ts.SyntaxKind.StringLiteral]: (node) => tstl.createStringLiteral(STAMP, node) } };",
      "export default plugin;",
      "",
    ].join("\n"));
    writeFileSync(join(directory, "src/main.ts"), 'export const label = "source";\n');
    writeFileSync(join(directory, "tsconfig.json"), JSON.stringify({
      compilerOptions: {
        target: "ESNext", lib: ["ES2015"], module: "ESNext", moduleResolution: "Bundler", strict: true,
        types: [], skipLibCheck: true, rootDir: "src", outDir: "out", sourceMap: true,
      },
      include: ["src/**/*.ts"],
      tstl: { luaTarget: "5.3", luaBundle: "map.lua", luaBundleEntry: "src/main.ts", noHeader: true, luaPlugins: [{ name: "./plugins/stamp" }] },
    }));
    return { config: join(directory, "tsconfig.json"), bundle: () => readFileSync(join(directory, "out/map.lua"), "utf8") };
  };
  const stores = () => readdirSync(cache).filter((name) => /^[0-9a-f]{64}$/.test(name)).length;
  const first = checkout("first", "unused", "lock one", "wasm");
  expect(report(mapCompiler(first.config, undefined, cache)())).toBe("");
  expect(first.bundle()).toContain('"first"');
  const relocked = checkout("first", "changed", "lock two", "wasm");
  expect(report(mapCompiler(relocked.config, undefined, cache)())).toBe("");
  expect(relocked.bundle()).toContain('"first"');
  expect(stores()).toBe(1);
  const second = checkout("second", "changed", "lock two", "wasm");
  expect(report(mapCompiler(second.config, undefined, cache)())).toBe("");
  expect(second.bundle()).toContain('"second"');
  expect(second.bundle()).not.toContain('"first"');
  expect(stores()).toBe(2);
  const patched = checkout("second", "changed", "lock two", "patched wasm");
  expect(report(mapCompiler(patched.config, undefined, cache)())).toBe("");
  expect(stores()).toBe(3);
});
