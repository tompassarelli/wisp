import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { transpileProject } from "typescript-to-lua";
import { report } from "../host/toolchain/compiler";

export const root = join(import.meta.dir, "..");

export function compile(source: string): { readonly diagnostics: string; readonly lua: string } {
  mkdirSync(join(root, "build"), { recursive: true });
  const directory = mkdtempSync(join(root, "build/game-api-"));
  try {
    writeFileSync(join(directory, "main.ts"), source);
    const config = join(directory, "tsconfig.json");
    writeFileSync(config, JSON.stringify({
      compilerOptions: { target: "ESNext", module: "ESNext", moduleResolution: "Bundler", strict: true, types: [], skipLibCheck: true, rootDir: "../..", outDir: "out" },
      files: ["main.ts", "../../src/natives/warcraft.d.ts"],
      tstl: { luaTarget: "5.3", luaBundle: "map.lua", luaBundleEntry: "main.ts", noImplicitSelf: true, noHeader: true,
        luaPlugins: [{ name: "../../plugins/warcraft-numbers.ts" }, { name: "../../plugins/game-api.ts" }] },
    }));
    const result = transpileProject(config);
    const diagnostics = report(result.diagnostics);
    return { diagnostics, lua: diagnostics === "" ? readFileSync(join(directory, "out/map.lua"), "utf8").replaceAll(basename(directory), "fixture") : "" };
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

export const wrap = (body: string) => `export function run(model: string, owner: player): void {\n${body}\n}\n`;
