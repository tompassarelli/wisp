


import { runLuaPerf } from "wisp/src/headless/luaPerf";

declare const arg: Readonly<Record<number, string | undefined>>;

const [bundle, declarations] = [arg[1], arg[2]];
if (bundle === undefined || declarations === undefined) throw new Error("usage: lua perf.lua MAP_LUA WARCRAFT_D_TS");
if (runLuaPerf({ filePrefix: "fixture" }, { frames: 30, events: [{ frame: 10, reload: true }] }, bundle, declarations) > 0) os.exit(1);
