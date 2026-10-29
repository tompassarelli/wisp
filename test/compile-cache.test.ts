import { mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "bun:test";
import type ts from "typescript";
import { compileCache } from "../host/toolchain/compileCache";

test("[invariant] a restored compile cache keeps its modules when a concurrent save deletes their files before they are used", () => {
  const root = mkdtempSync(join(tmpdir(), "wisp-compile-cache-"));
  const config = join(root, "tsconfig.json");
  writeFileSync(config, "{}");
  const cache = compileCache(join(root, "cache"), config, {}, []);
  cache.save("build-info", [{ fileName: join(root, "a.ts"), code: "return 1" } as never]);
  const restored = cache.restore();
  expect(restored).toBeDefined();
  const store = join(root, "cache", readdirSync(join(root, "cache"))[0] ?? "");
  for (const name of readdirSync(store)) if (name !== "index.json") rmSync(join(store, name));
  const modules = restored?.modules({ getSourceFile: () => undefined } as unknown as ts.Program) ?? [];
  expect(modules.map((module) => module.code)).toEqual(["return 1"]);
  expect(cache.restore()).toBeUndefined();
});
