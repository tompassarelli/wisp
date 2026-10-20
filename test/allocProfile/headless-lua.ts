import { luaLockstep, readFile } from "../../src/headless/lua";
import { allocationSampler } from "../../src/headless/luaPerf";

declare const arg: Readonly<Record<number, string | undefined>>;

const [bundle, declarations] = [arg[1], arg[2]];
if (bundle === undefined || declarations === undefined) throw new Error("usage: lua headless.lua MAP_LUA WARCRAFT_D_TS");
const sampler = allocationSampler();
const charged = new Map<number, [number, number]>();
collectgarbage("stop");
const clients = luaLockstep({ filePrefix: "alloc" }, readFile(bundle), readFile(declarations), { enter: () => sampler.start(charged), leave: () => sampler.stop() });
clients.start();
clients.frames(60);
for (const [line, [self, inclusive]] of charged) print(`alloc ${line} ${self} ${inclusive}`);
