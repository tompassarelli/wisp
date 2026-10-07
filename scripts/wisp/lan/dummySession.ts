import { copyFileSync, mkdirSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { Effect } from "effect";
import { readExecutable } from "../engine/memory";
import { connectMenus, menuAddress } from "../menus";
import { checkDummy } from "./dummy";
import { LanFailure, enableLan, joinLanGame } from "./join";
import { readMapFacts } from "./map";
import { isolatedNetworkProblem } from "./offline";
import { clientName, documentsOf, exeOf, pairDirectory, reportPort } from "./pool";

const [pairText, mapFile, program, countText, nativePidText] = process.argv.slice(2);
if (pairText === undefined || mapFile === undefined || program === undefined || countText === undefined || nativePidText === undefined) throw new Error("dummySession requires pair, map, program, count and native PID");
const pair = Number(pairText);
const nativePid = Number(nativePidText);
for (const pid of [process.pid, nativePid]) {
  const problem = isolatedNetworkProblem(pid);
  if (problem !== undefined) throw new Error(problem);
}
const name = clientName(pair, "a");
const inGame = `Maps\\Wisp\\${basename(mapFile)}`;
const target = join(documentsOf(name), "Maps/Wisp", basename(mapFile));
mkdirSync(dirname(target), { recursive: true });
if (target !== mapFile) copyFileSync(mapFile, target);
const packager = join(process.env["XDG_CACHE_HOME"] ?? join(process.env["HOME"] ?? "", ".cache"), "wisp/lan/map-pack");
const map = readMapFacts(mapFile, packager, inGame);
const output = join(pairDirectory(pair), "dummy", new Date().toISOString().replace(/[:.]/g, "-"));
const version = readExecutable(exeOf(name)).version;
console.log(`dummy lobby: Warcraft ${version}; evidence ${output}`);
await Effect.runPromise(Effect.scoped(Effect.gen(function*() {
  const menus = yield* connectMenus(yield* menuAddress(reportPort(pair, "a"), 10));
  const result = yield* Effect.tryPromise({
    try: () => checkDummy({ program, map, count: Number(countText), output, nativeVersion: version, announcePorts: [16000, 16001],
      joinNative: async (_host, gameName) => Effect.runPromise(Effect.gen(function*() {
        yield* enableLan(nativePid, exeOf(name), version, menus, console.log);
        yield* joinLanGame(menus, gameName);
      })),
    }),
    catch: (cause) => new LanFailure({ problem: cause instanceof Error ? cause.message : String(cause) }),
  });
  console.log(JSON.stringify({ ...result, version, output }));
})));
