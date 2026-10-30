import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { transpileProject } from "typescript-to-lua";
import { report } from "../host/toolchain/compiler";
import * as native from "../src/game/native/effects";
import { bindWorld } from "../src/game/native/world";
import { HeadlessClient } from "../src/headless/client";
import { readNativeDeclarations } from "../host/headless/headless";
import { parseTemplate } from "../src/game/warcraft/lowering";
import { effects } from "../src/game/warcraft/effects";

const root = join(import.meta.dir, "..");

function compile(source: string): { readonly diagnostics: string; readonly lua: string } {
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

const wrap = (body: string) => `export function run(model: string, owner: player): void {\n${body}\n}\n`;

test("a lowered call compiles to the native call it replaced, byte for byte", () => {
  const lowered = compile(`import { createEffect, setEffectScale, setEffectTeamColor, createBeam, destroyBeam } from "../../src/game/effects";\n` + wrap(`
  const effect = createEffect(model, 1.5, 2);
  setEffectScale(effect, 2.0);
  setEffectTeamColor(effect, owner);
  const beam = createBeam("LEAS", 0, 0, 1, 2, 3, 4);
  destroyBeam(beam);`));
  const raw = compile(wrap(`
  const effect = AddSpecialEffect(model, 1.5, 2);
  BlzSetSpecialEffectScale(effect, 2.0);
  BlzSetSpecialEffectColorByPlayer(effect, owner);
  const beam = AddLightningEx("LEAS", false, 0, 0, 1, 2, 3, 4);
  DestroyLightning(beam);`));
  expect(lowered.diagnostics).toBe("");
  expect(raw.diagnostics).toBe("");
  expect(lowered.lua).toBe(raw.lua);
  expect(lowered.lua).toContain("BlzSetSpecialEffectScale(effect, 2.0)");
  expect(lowered.lua).not.toContain("effects");
});

test("an API function used as a value is rejected, since Lua has no function to pass", () => {
  const { diagnostics } = compile(`import { setEffectScale } from "../../src/game/effects";\n` + wrap(`  const apply = setEffectScale;\n  void apply;`));
  expect(diagnostics).toContain("setEffectScale");
  expect(diagnostics).toContain("9310");
});

test("every lowering row names a declared native with the arity of its Wisp function and an implemented backend call", () => {
  const declared = new Map(readNativeDeclarations().functions.map(([name, , parameters]) => [name, parameters] as const));
  const dts = readFileSync(join(root, "src/game/effects.d.ts"), "utf8");
  const exported = [...dts.matchAll(/export declare function (\w+)\(([^)]*)\)/g)].map(match => [match[1]!, (match[2] ?? "").trim() === "" ? 0 : (match[2] ?? "").split(",").length] as const);
  expect(exported.map(([name]) => name).sort()).toEqual(Object.keys(effects).sort());
  expect(Object.keys(native).sort()).toEqual(Object.keys(effects).sort());
  for (const [name, parameters] of exported) {
    const template = parseTemplate(effects[name] ?? "");
    expect(declared.get(template.native)).toBe(template.args.length);
    expect(template.args.filter(part => "arg" in part).length).toBe(parameters);
  }
});

test("the native backend logs the native call of its lowering row and keeps each client's effects apart", () => {
  const declarations = readNativeDeclarations();
  const make = (slot: number) => new HeadlessClient({ slot, humans: [0, 1], declarations, filePrefix: "game-api", localNatives: { BlzGetLocalSpecialEffectX: "local" }, network: [] });
  const [first, second] = [make(0), make(1)];
  bindWorld(first.world);
  const a = native.createEffect("a.mdx", 1, 2);
  native.setEffectScale(a, 2);
  native.effectX(a);
  bindWorld(second.world);
  native.createEffect("b.mdx", 3, 4);
  native.createEffect("c.mdx", 5, 6);
  bindWorld(undefined);
  expect(first.effectPoses().map(pose => pose.model)).toEqual(["a.mdx"]);
  expect(second.effectPoses().map(pose => pose.model)).toEqual(["b.mdx", "c.mdx"]);
  expect(first.log.map(call => call.name)).toEqual(["AddSpecialEffect", "BlzSetSpecialEffectScale"]);
  expect(second.log.map(call => call.name)).toEqual(["AddSpecialEffect", "AddSpecialEffect"]);
  expect(first.effectPoses()[0]?.scale).toBe(2);
  expect([...first.emulatedCalls.keys(), ...second.emulatedCalls.keys()]).toEqual([]);
  const natives = first.natives as Record<string, (...args: unknown[]) => unknown>;
  natives.BlzSetSpecialEffectScale?.(first.effectPoses()[0]?.handle, 3);
  natives.BlzGetLocalSpecialEffectX?.(first.effectPoses()[0]?.handle);
  expect(Object.fromEntries(first.emulatedCalls)).toEqual({ BlzSetSpecialEffectScale: 1, BlzGetLocalSpecialEffectX: 1 });
});

test("the native backend refuses to run with no world bound", () => {
  expect(() => native.createEffect("x.mdx", 0, 0)).toThrow("no world bound");
});
