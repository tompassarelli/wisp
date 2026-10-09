import { luaLockstep, readFile } from "../../src/headless/lua";
import { SHADOW_CONFIGS, SHADOW_JOURNEY } from "./configs";
import { SHADOW_HEADLESS } from "./headless-config";
import { NATIVE_ROWS } from "./native-rows";

declare const arg: Readonly<Record<number, string | undefined>>;
const bundle = arg[1];
const declarations = arg[2];
if (bundle === undefined || declarations === undefined) throw new Error("usage: lua headless.lua MAP_LUA WARCRAFT_D_TS");
const clients = luaLockstep(SHADOW_HEADLESS, readFile(bundle), readFile(declarations));
clients.start();
clients.frames(SHADOW_JOURNEY.frames);
for (const client of clients.clients) {
  for (let index = 0; index < SHADOW_CONFIGS.length; index++) {
    const config = SHADOW_CONFIGS[index];
    const expected = NATIVE_ROWS[index];
    if (config === undefined || expected === undefined) throw new Error("missing native configuration");
    const file = `shadow-strike94-${config.name}-p${client.slot}.txt`;
    const rows = client.files.get(file);
    if (rows === undefined) throw new Error(`missing Shadow Strike observation: ${file}`);
    for (const row of rows) print(`p${client.slot} ${row}`);
    if (rows.length !== expected.length || rows.some((row, index) => row !== expected[index])) throw new Error(`Shadow Strike native mismatch: ${file}`);
  }
  if (client.errors.length > 0 || client.missingNatives.length > 0) throw new Error("Shadow Strike journey needs modeled stock spell behavior; see #94");
}
if (clients.firstDivergence() !== undefined) throw new Error(clients.firstDivergence());
