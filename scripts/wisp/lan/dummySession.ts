import { copyFileSync, mkdirSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import * as BunServices from "@effect/platform-bun/BunServices";
import * as BunRuntime from "@effect/platform-bun/BunRuntime";
import { Effect } from "effect";
import { connectMenus, menuAddress } from "../menus";
import { checkDummy } from "./dummy";
import { joinLanGame } from "./join";
import { loadLanPlugin } from "./plugin";
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
const output = join(pairDirectory(pair), "dummy", new Date().toISOString().replace(/[:.]/g, "-"));
BunRuntime.runMain(Effect.scoped(Effect.gen(function*() {
  const map = yield* readMapFacts(mapFile, packager, inGame);
  const lan = yield* loadLanPlugin;
  const version = lan.version(exeOf(name));
  console.log(`dummy lobby: Warcraft ${version}; evidence ${output}`);
  const menus = yield* connectMenus(yield* menuAddress(reportPort(pair, "a"), 10));
  const result = yield* checkDummy({ program, map, count: Number(countText), output, nativeVersion: version, announcePorts: [16000],
    joinNative: (_host, gameName) => Effect.gen(function*() {
      yield* lan.enableLan(nativePid, exeOf(name), menus, console.log);
      yield* joinLanGame(menus, gameName);
    }),
  });
  console.log(JSON.stringify({ ...result, version, output }));
})).pipe(Effect.provide(BunServices.layer)));
