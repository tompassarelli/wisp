import { readFileSync } from "node:fs";
import { payloadKey } from "../src/runtime/gameFiles";
import { checksum } from "../src/runtime/payload";
import { longBrackets } from "./lua";
import { keepSourceMap } from "./sourceMaps";

export interface Bundle {
  readonly text: string;

  readonly key: string;
}

export function loadBundle(path: string, sourceMapDirectory: string): Bundle {
  const bytes = readFileSync(path);
  const key = payloadKey(checksum(bytes.length, (index) => bytes[index] ?? 0));
  keepSourceMap(path, key, sourceMapDirectory);
  return { text: new TextDecoder().decode(bytes), key };
}

function renameOnly(script: string, from: string, to: string): string {
  const declaration = new RegExp(`^function ${from}\\(\\)`, "gm");
  const count = script.match(declaration)?.length ?? 0;
  if (count !== 1) throw new Error(`base map script must define ${from}() once, not ${count} times`);
  return script.replace(declaration, `function ${to}()`);
}

export function typescriptBase(baseMapScript: string, mapConfig: string): string {
  const script = renameOnly(renameOnly(baseMapScript, "main", "baseMain"), "config", "baseConfig");
  const initialization = /^RunInitializationTriggers\(\)$/gm;
  const count = script.match(initialization)?.length ?? 0;
  if (count !== 1) throw new Error(`base map script must run its initialization triggers once, not ${count} times`);

  return `${script.replace(initialization, "-- Suppressed default melee initialization for the custom map.")}\n${mapConfig}`;
}

export function composeScript(base: string, bundle: Bundle | undefined, entryGlobal = "wispTs"): string {
  if (bundle === undefined) throw new Error("a map needs the TypeScript bundle");
  if (!/^function mapConfig\(\)/m.test(base)) throw new Error("base script does not define mapConfig()");
  const [open, close] = longBrackets(bundle.text);
  // Lua drops the newline right after an opening long bracket.
  const typescript = `\n${entryGlobal} = assert(load(${open}\n${bundle.text}${close}, "=map-${bundle.key}"))()\n`;
  return `${base}${typescript}
function main()
    baseMain()
    ${entryGlobal}.start("${bundle.key}")
end

function config()
    mapConfig()
end
`;
}
