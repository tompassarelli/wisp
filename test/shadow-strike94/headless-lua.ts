import { luaLockstep, readFile } from "../../src/headless/lua";
import { SHADOW_CONFIGS, SHADOW_JOURNEY, SUBJECT_ID } from "./configs";

declare const arg: Readonly<Record<number, string | undefined>>;
const bundle = arg[1];
const declarations = arg[2];
if (bundle === undefined || declarations === undefined) throw new Error("usage: lua headless.lua MAP_LUA WARCRAFT_D_TS");
const clients = luaLockstep({
  filePrefix: "shadow-strike94",
  unitStates: { [SUBJECT_ID]: { life: 1000, maxLife: 1000, mana: 0, maxMana: 0 } },
}, readFile(bundle), readFile(declarations));
clients.start();
clients.frames(SHADOW_JOURNEY.frames);
for (const client of clients.clients) {
  for (const config of SHADOW_CONFIGS) {
    const file = `shadow-strike94-${config.name}-p${client.slot}.txt`;
    const rows = client.files.get(file);
    if (rows === undefined) throw new Error(`missing Shadow Strike observation: ${file}`);
    for (const row of rows) print(`p${client.slot} ${row}`);
  }
  if (client.errors.length > 0 || client.missingNatives.length > 0) throw new Error("Shadow Strike journey needs modeled stock spell behavior; see #94");
}
if (clients.firstDivergence() !== undefined) throw new Error(clients.firstDivergence());
