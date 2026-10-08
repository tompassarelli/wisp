import { luaLockstep, readFile } from "../../src/headless/lua";
import { EFFECT_NOOPS } from "./cases";
import { EFFECT_DEATHS, deathTimeline } from "./deaths";

declare const arg: Readonly<Record<number, string | undefined>>;
const bundle = arg[1];
const declarations = arg[2];
if (bundle === undefined || declarations === undefined) throw new Error("usage: lua headless.lua MAP_LUA WARCRAFT_D_TS");
const clients = luaLockstep({ filePrefix: "effects", intentionalNoops: EFFECT_NOOPS, effectDeaths: EFFECT_DEATHS }, readFile(bundle), readFile(declarations));
const timeline = deathTimeline(clients);
for (const client of clients.clients) {
  for (const row of client.files.get(`effects-p${client.slot}.txt`) ?? []) print(`p${client.slot} ${row}`);
}
for (const line of timeline) print(line);
if (clients.firstDivergence() !== undefined) throw new Error(clients.firstDivergence());
