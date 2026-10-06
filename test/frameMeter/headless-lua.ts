// The frame meter of the fixture map (entry.ts) in two simulated clients in
// 32-bit Lua: one player shows the overlay, the other doesn't see it; a hot
// reload during heavier frames makes every client write its report. Prints
// what the host reads: the overlay's text, each client's report, then the
// journey measured by runLuaPerf.
// Usage: lua meter.lua MAP_LUA WARCRAFT_D_TS
import { luaLockstep, readFile } from "../../src/headless/lua";
import { runLuaPerf } from "../../src/headless/luaPerf";
import { frameCostFile } from "../../src/runtime/frameCost";

declare const arg: Readonly<Record<number, string | undefined>>;

const bundlePath = arg[1];
const declarationsPath = arg[2];
if (bundlePath === undefined || declarationsPath === undefined) throw new Error("usage: lua meter.lua MAP_LUA WARCRAFT_D_TS");
const MAP = { filePrefix: "meter" };

const clients = luaLockstep(MAP, readFile(bundlePath), readFile(declarationsPath));
clients.start();
clients.frames(130);
clients.chat(0, "-perf");
clients.chat(0, "-stall 5");
clients.frames(30);
for (const client of clients.clients) print(`p${client.slot} overlay: ${client.frames.shownText().join("\n").split("\n").join(" | ")}`);
clients.chat(1, "-work 20");
clients.reload();
clients.frames(10);
for (const client of clients.clients) print(`p${client.slot} applied: ${client.files.get(`meter-hot-ack-p${client.slot}.txt`)?.[0] ?? "nothing"}`);
clients.frames(125);
for (const client of clients.clients) {
  for (const line of client.files.get(frameCostFile(client.slot, MAP.filePrefix)) ?? ["no report"]) print(`p${client.slot} report: ${line}`);
  for (const error of client.errors) print(`p${client.slot} error: ${error}`);
}
print(`desync: ${clients.firstDivergence() ?? "none"}`);
runLuaPerf(MAP, { frames: 120, events: [{ frame: 60, player: 0, chat: "-work 20" }] }, bundlePath, declarationsPath);
