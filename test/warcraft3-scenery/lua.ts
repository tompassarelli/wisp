import { readFile } from "../../src/headless/lua";
import { parseNativeDeclarations } from "../../src/headless/declarations";
import { sceneryFixture } from "./fixture";
declare const arg: Readonly<Record<number, string | undefined>>;
const path = arg[1];
if (path === undefined) throw new Error("usage: lua scenery.lua WARCRAFT_D_TS");
print(`scenery ${sceneryFixture(parseNativeDeclarations(readFile(path)))} natives passed`);
