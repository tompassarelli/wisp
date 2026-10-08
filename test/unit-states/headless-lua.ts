import { luaLockstep, readFile } from "../../src/headless/lua";
import { UNIT_FIXTURE } from "./cases";

declare const arg: Readonly<Record<number, string | undefined>>;
const bundle = arg[1];
const declarations = arg[2];
if (bundle === undefined || declarations === undefined) throw new Error("usage: lua headless.lua MAP_LUA WARCRAFT_D_TS");
const clients = luaLockstep({ filePrefix: "unit-states", unitStates: UNIT_FIXTURE }, readFile(bundle), readFile(declarations));
clients.start();
clients.frames(80);
for (const client of clients.clients) {
  for (const row of client.files.get(`unit-states-p${client.slot}.txt`) ?? []) print(`p${client.slot} ${row}`);
}
if (clients.firstDivergence() !== undefined) throw new Error(clients.firstDivergence());
