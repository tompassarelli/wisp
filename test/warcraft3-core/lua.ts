import { allWarcraft3Fixtures } from "./all";
import { parseNativeDeclarations } from "../../src/headless/declarations";
import { readFile } from "../../src/headless/lua";
declare const arg: Readonly<Record<number, string | undefined>>;
const path = arg[1];
if (path === undefined) throw new Error("native declarations path required");
print(`Warcraft 3: ${allWarcraft3Fixtures(parseNativeDeclarations(readFile(path)))} natives, 0 unmodelled`);
