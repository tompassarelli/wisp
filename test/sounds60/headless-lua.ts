import { luaLockstep, readFile } from "../../src/headless/lua";
import { SOUND_NATIVES } from "./cases";

declare const arg: Readonly<Record<number, string | undefined>>;
const bundle = arg[1];
const declarations = arg[2];
if (bundle === undefined || declarations === undefined) throw new Error("usage: lua headless.lua MAP_LUA WARCRAFT_D_TS");
const clients = luaLockstep({ filePrefix: "sounds60", natives: SOUND_NATIVES }, readFile(bundle), readFile(declarations));
clients.start();
clients.frames(240);
for (const client of clients.clients) {
  for (const row of client.files.get(`sounds60-p${client.slot}.txt`) ?? []) print(`p${client.slot} ${row}`);
}
if (clients.firstDivergence() !== undefined) throw new Error(clients.firstDivergence());
