import { runLuaPerf } from "../../src/headless/luaPerf";

declare const arg: Readonly<Record<number, string | undefined>>;

const [bundle, declarations] = [arg[1], arg[2]];
if (bundle === undefined || declarations === undefined) throw new Error("usage: lua headless.lua MAP_LUA WARCRAFT_D_TS");
if (runLuaPerf({ filePrefix: "phase" }, { frames: 60, events: [] }, bundle, declarations) > 0) os.exit(1);
