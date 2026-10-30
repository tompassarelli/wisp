import { readFileSync } from "node:fs";
import type { NativeDeclarations } from "../../src/headless/declarations";
import type { StandaloneProfile } from "../../src/headless/clientTypes";
import { readNativeDeclarations } from "./headless";

export function standaloneProfile(bundle: string, declarations: NativeDeclarations = readNativeDeclarations()): StandaloneProfile {
  const declared = new Set(declarations.functions.map(([name]) => name));
  const named = new Set<string>();
  for (const [identifier] of bundle.matchAll(/[A-Za-z_][A-Za-z0-9_]*/g)) if (declared.has(identifier)) named.add(identifier);
  return [...named].sort();
}

if (import.meta.main) {
  const [bundlePath] = process.argv.slice(2);
  if (bundlePath === undefined) throw new Error("usage: bun host/headless/standaloneProfile.ts MAP_BUNDLE.lua > PROFILE.json");
  console.log(JSON.stringify(standaloneProfile(readFileSync(bundlePath, "utf8")), null, 2));
}
