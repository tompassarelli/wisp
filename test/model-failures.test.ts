import { expect, test } from "bun:test";
import { Effect } from "effect";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { modelFailureBridge } from "../scripts/wisp/modelFailures";
import { GameFiles } from "../scripts/wisp/gameFiles";
import { hostPath, preloadLines } from "../scripts/wisp/boundary";
import { modelFailureFile } from "../src/runtime/gameFiles";

test("native model failure lines reach the requesting map, including stock paths and later failures [spec smashcraft#365]", async () => {
  const requestTime = new Date(2026, 0, 1, 0, 0, 1).getTime();
  const directory = mkdtempSync(join(tmpdir(), "wisp-model-failures-"));
  const data = join(directory, "CustomMapData");
  const log = join(directory, "Logs/War3Log.txt");
  const request = join(data, "wisp-model-load-p0.txt");
  mkdirSync(data);
  mkdirSync(join(directory, "Logs"));
  writeFileSync(request, 'function PreloadFiles takes nothing returns nothing\ncall Preload( "0-456" )\nendfunction');
  writeFileSync(log, "1/1 00:00:00.000 GameMain Started\n1/1 00:00:01.001 model creation failed - Abilities\\Missing.mdx\n1/1 00:00:01.002 model creation failed - war3mapImported/Other.mdx");
  utimesSync(request, requestTime / 1000, requestTime / 1000);
  utimesSync(log, requestTime / 1000 + 1, requestTime / 1000 + 1);
  try {
    await Effect.runPromise(GameFiles.use(files => modelFailureBridge(files)([data])).pipe(Effect.provide(GameFiles.layer())));
    for (const [ordinal, path] of [[1, "Abilities/Missing.mdx"], [2, "war3mapImported/Other.mdx"]] as const) {
      expect(readFileSync(hostPath(data, modelFailureFile("0-456", ordinal)), "utf8")).toContain(`"${path}"`);
    }
    expect(preloadLines(readFileSync(request, "utf8"))).toEqual(["0-456"]);
  } finally {
    rmSync(directory, { recursive: true });
  }
});
