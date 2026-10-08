import { luaLockstep, readFile } from "../../src/headless/lua";

declare const arg: Readonly<Record<number, string | undefined>>;
const bundle = arg[1];
const declarations = arg[2];
if (bundle === undefined || declarations === undefined) throw new Error("usage: lua headless.lua MAP_LUA WARCRAFT_D_TS");
const clients = luaLockstep({ filePrefix: "audio80" }, readFile(bundle), readFile(declarations));
clients.start();
clients.frames(48);
for (const client of clients.clients) {
  for (const cue of client.soundLog) {
    if (Math.abs(cue.effectiveVolume * 127 - cue.volume) > 1 / 1024) throw new Error("effective volume differs from map volume");
    print(`p${client.slot} ${cue.frame} ${cue.kind} ${cue.event} ${cue.source} loop=${cue.looping} volume=${cue.volume}`);
  }
}
if (clients.firstDivergence() !== undefined) throw new Error(clients.firstDivergence());
