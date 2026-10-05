// Plays the sample's headless journey in 32-bit Lua, with the compiled map
// bundle in two simulated clients.
// Usage: lua build/headless/headless.lua build/map.lua WARCRAFT_D_TS
import { runLuaJourney } from "wisp/src/headless/lua";
import { SAMPLE_JOURNEY, SAMPLE_MAP } from "./journey";

declare const arg: Readonly<Record<number, string | undefined>>;

const bundle = arg[1];
const declarations = arg[2];
if (bundle === undefined || declarations === undefined) throw new Error("usage: lua headless.lua MAP_LUA WARCRAFT_D_TS");
if (runLuaJourney(SAMPLE_MAP, SAMPLE_JOURNEY, bundle, declarations) > 0) os.exit(1);
