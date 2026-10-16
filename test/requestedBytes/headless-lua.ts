import { runLuaPerf } from "../../src/headless/luaPerf";

declare const arg: Readonly<Record<number, string | undefined>>;

const [bundle, declarations] = [arg[1], arg[2]];
if (bundle === undefined || declarations === undefined) throw new Error("usage: lua headless.lua MAP_LUA WARCRAFT_D_TS");
if (runLuaPerf({ filePrefix: "requested" }, { frames: 120, events: [] }, bundle, declarations, { samples: true }) > 0) os.exit(1);
