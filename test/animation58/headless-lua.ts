import { luaLockstep, readFile } from "../../src/headless/lua";
import { ANIMATION_NOOPS } from "./cases";
import { CAPTURE_FRAME, RULER, RULER_DEATH_SECONDS } from "./layout";
import { animationRows } from "./rows";

declare const arg: Readonly<Record<number, string | undefined>>;
const bundle = arg[1];
const declarations = arg[2];
if (bundle === undefined || declarations === undefined) throw new Error("usage: lua headless.lua MAP_LUA WARCRAFT_D_TS");
const effectDeaths = (model: string) => (model === RULER ? RULER_DEATH_SECONDS : undefined);
const clients = luaLockstep({ filePrefix: "animation", intentionalNoops: ANIMATION_NOOPS, effectDeaths }, readFile(bundle), readFile(declarations));
clients.start();
clients.frames(CAPTURE_FRAME);
for (const client of clients.clients) {
  for (const row of client.files.get(`animation-p${client.slot}.txt`) ?? []) print(`p${client.slot} ${row}`);
  for (const row of animationRows(client.effectPoses(), client.unitPoses())) print(`p${client.slot} ${row}`);
}
if (clients.firstDivergence() !== undefined) throw new Error(clients.firstDivergence());
