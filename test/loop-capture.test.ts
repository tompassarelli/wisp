import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { transpileProject } from "typescript-to-lua";
import { mapCompiler, report } from "../scripts/compiler";

const source = `
export function run(): string {
  const saved: (() => number)[] = [];
  for (let index = 0; index < 13; index++) saved.push(() => index);
  const controls: (() => number)[] = [];
  for (let index = 0; index < 5; index++) {
    controls.push(() => index);
    if (index === 0) { index = 1; continue; }
    if (index === 3) break;
  }
  const conditions: (() => number)[] = [], updates: (() => number)[] = [], bodies: (() => number)[] = [];
  for (let index = 0; (conditions.push(() => index), index < 3); (updates.push(() => index), index++)) bodies.push(() => index);
  let initial: () => number = () => -1;
  for (let index: number = (initial = () => index, 0); index < 2; index++) {}
  const multiple: (() => number)[] = [], destructured: (() => number)[] = [], nested: (() => number)[] = [];
  for (let i = 0, j = 10; i < 3; i++, j += 2) multiple.push(() => i + j);
  for (let [i, j] = [0, 10]; i < 3; i++, j++) destructured.push(() => i + j);
  for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) nested.push(() => 10 * i + j);
  const shared: (() => number)[] = [];
  let index = 0;
  for (; index < 3; index++) shared.push(() => index);
  return [saved, controls, conditions, updates, bodies, multiple, destructured, nested, shared].map(group => group.map(read => read()).join(",")).join("|") + "|" + initial();
}
`;

test("captured for-let bindings match Bun through mutation, continue, break and all loop phases", async () => {
  const root = join(import.meta.dir, "..");
  mkdirSync(join(root, "build"), { recursive: true });
  const directory = mkdtempSync(join(root, "build/loop-capture-"));
  const entry = join(directory, "main.ts");
  writeFileSync(entry, source);
  const config = join(directory, "tsconfig.json");
  writeFileSync(config, JSON.stringify({
    compilerOptions: { target: "ESNext", module: "ESNext", moduleResolution: "Bundler", strict: true, types: [], skipLibCheck: true, rootDir: ".", outDir: "out" },
    files: ["main.ts"],
    tstl: { luaTarget: "5.3", luaBundle: "map.lua", luaBundleEntry: "main.ts", noImplicitSelf: true, noHeader: true, luaPlugins: [{ name: "../../plugins/warcraft-numbers.ts" }] },
  }));
  try {
    const host = await import(entry) as { run: () => string };
    expect(report(transpileProject(config).diagnostics)).toBe("");
    const bundle = join(directory, "out/map.lua");
    const full = readFileSync(bundle, "utf8");
    const compile = mapCompiler(config);
    expect(report(compile())).toBe("");
    expect(readFileSync(bundle, "utf8")).toBe(full);
    expect(report(compile())).toBe("");
    expect(readFileSync(bundle, "utf8")).toBe(full);
    writeFileSync(join(directory, "run.lua"), "local entry = dofile(arg[1]); print(entry.run())\n");
    const lua = process.env.LUA ?? "lua";
    const result = Bun.spawnSync([lua, join(directory, "run.lua"), bundle], { stdout: "pipe", stderr: "pipe" });
    expect(result.stderr.toString()).toBe("");
    expect(result.exitCode).toBe(0);
    expect(result.stdout.toString().trim()).toBe(host.run());
  } finally {
    rmSync(directory, { recursive: true });
  }
});
