import { dirname, join } from "node:path";
import { Effect } from "effect";
import { logLines, logTime, modelFailurePaths, sessionText, war3LogPath } from "../warcraft/war3Log";
import { FILE_SLOTS, modelFailureFile, modelFailureRequestFile, modelFailureTokenFile } from "../../src/runtime/gameFiles";
import { hostPath, linePreloadFile, preloadLines } from "./preloadRecord";
import { GameFiles } from "./gameFiles";

export function modelFailureBridge(files: GameFiles["Service"], filePrefix = "wisp") {
  const sent = new Map<string, number>();
  return (directories: readonly string[]) => Effect.gen(function*() {
    for (const directory of directories) {
      const log = yield* files.read(war3LogPath(dirname(directory)));
      if (log === undefined) continue;
      for (let slot = 0; slot < FILE_SLOTS; slot++) {
        const request = yield* files.read(join(directory, modelFailureRequestFile(slot, filePrefix)));
        if (request === undefined) continue;
        const token = preloadLines(request.text)?.[0];
        if (token === undefined || !/^\d+-\d+$/.test(token)) continue;
        const ordinal = Number(token.split("-")[1]);
        const marker = hostPath(directory, modelFailureTokenFile(slot, ordinal, filePrefix));
        if ((yield* files.read(marker)) === undefined) yield* files.write(marker, linePreloadFile(token));
        const current = logLines(sessionText(log.text)).filter(line => logTime(line.at, log.modified) >= request.modified);
        const paths = current.flatMap(line => modelFailurePaths(`1/1 00:00:00.000 ${line.text}`));
        const key = `${directory}:${token}`;
        const before = sent.get(key) ?? 0;
        for (let index = before; index < paths.length; index++) {
          const path = paths[index];
          if (path === undefined) continue;
          yield* files.write(hostPath(directory, modelFailureFile(token, index + 1, filePrefix)), linePreloadFile(path.replace(/\\/g, "/").replace(/"/g, "")));
        }
        sent.set(key, paths.length);
      }
    }
  });
}
