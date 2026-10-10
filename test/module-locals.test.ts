import { expect } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { transpileProject } from "typescript-to-lua";
import { report } from "../scripts/compiler";
import { farmTest } from "../scripts/wisp/farmTest";

const names = (count: number, prefix: string) => Array.from({ length: count }, (_, index) => `${prefix}${index}`);

function project(files: Readonly<Record<string, string>>): { readonly directory: string; readonly config: string } {
  const root = join(import.meta.dir, "..");
  mkdirSync(join(root, "build"), { recursive: true });
  const directory = mkdtempSync(join(root, "build/module-locals-"));
  mkdirSync(join(directory, "src"));
  for (const [name, text] of Object.entries(files)) {
    mkdirSync(dirname(join(directory, "src", name)), { recursive: true });
    writeFileSync(join(directory, "src", name), text);
  }
  const config = join(directory, "tsconfig.json");
  writeFileSync(config, JSON.stringify({
    compilerOptions: { target: "ESNext", lib: ["ES2015"], module: "ESNext", moduleResolution: "Bundler", strict: true, types: [], skipLibCheck: true, rootDir: "src", outDir: "out" },
    include: ["src/**/*.ts"],
    tstl: { luaTarget: "5.3", luaBundle: "map.lua", luaBundleEntry: "src/main.ts", noImplicitSelf: true, noHeader: true, luaPlugins: [{ name: "../../plugins/warcraft-numbers.ts" }] },
  }));
  return { directory, config };
}

const locals = (count: number) => `${names(count, "value").map((name, index) => `const ${name} = ${index};`).join("\n")}\nexport const sum = ${names(count, "value").join(" + ")};\n`;

farmTest("[reference] named imports read the module table: 230 imports compile, load and match Bun in Lua32", async () => {
  const exported = names(230, "item");
  const { directory, config } = project({
    "items.ts": `${exported.map((name, index) => `export const ${name} = ${index};`).join("\n")}\nexport function twice(value: number): number { return value * 2; }\n`,
    "main.ts": `import { ${exported.join(", ")}, twice } from "./items";\nimport * as all from "./items";\nexport const run = (): number => twice(${exported.join(" + ")}) + all.item1;\n`,
  });
  try {
    expect(report(transpileProject(config).diagnostics)).toBe("");
    const bundle = join(directory, "out/map.lua");
    const text = readFileSync(bundle, "utf8");
    expect(text).not.toMatch(/^local item\d+ = ____items\./m);
    expect(text).toContain("____items.item229");
    const host = await import(join(directory, "src/main.ts")) as { run: () => number };
    writeFileSync(join(directory, "run.lua"), "print(dofile(arg[1]).run())\n");
    const result = Bun.spawnSync([process.env.LUA ?? "lua", join(directory, "run.lua"), bundle], { stdout: "pipe", stderr: "pipe" });
    expect(result.stderr.toString()).toBe("");
    expect(result.stdout.toString().trim()).toBe(String(host.run()));
  } finally {
    rmSync(directory, { recursive: true });
  }
});
