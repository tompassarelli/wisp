import { luaLockstep, readFile } from "../../src/headless/lua";
import { weaponRangeHeadless } from "./headless-config";

declare const arg: Readonly<Record<number, string | undefined>>;
const bundle = arg[1];
const declarations = arg[2];
if (bundle === undefined || declarations === undefined) throw new Error("usage: lua headless.lua MAP_LUA WARCRAFT_D_TS");
const clients = luaLockstep(weaponRangeHeadless, readFile(bundle), readFile(declarations));
clients.start();
clients.frames(1500);
for (const client of clients.clients) {
  for (const missing of client.missingNatives) print(`p${client.slot} unmodeled ${missing.native} (weapon-range93: UNIT_WEAPON_RF_ATTACK_RANGE readback and attack reach)`);
  for (const row of client.files.get(`weapon-range93-p${client.slot}.txt`) ?? []) print(`p${client.slot} ${row}`);
}
if (clients.firstDivergence() !== undefined) throw new Error(clients.firstDivergence());
