import { runLuaPerf } from "../../src/headless/luaPerf";

declare const arg: Readonly<Record<number, string | undefined>>;
const bundle = arg[1];
const declarations = arg[2];
if (bundle === undefined || declarations === undefined) throw new Error("expected map and declarations");
if (runLuaPerf({ filePrefix: "meter" }, { frames: tonumber(arg[4] ?? "30") ?? 30, events: [] }, bundle, declarations, { samples: arg[5] === "samples" }) > 0) os.exit(1);
