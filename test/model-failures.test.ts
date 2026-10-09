import { expect, test } from "bun:test";
import { Effect } from "effect";
import { modelFailureBridge } from "../scripts/wisp/modelFailures";
import { GameFiles } from "../scripts/wisp/gameFiles";
import { hostPath, preloadLines } from "../scripts/wisp/boundary";
import { modelFailureFile } from "../src/runtime/gameFiles";

test("native model failure lines reach the requesting map, including stock paths and later failures [spec smashcraft#365]", async () => {
  const requestTime = new Date(2026, 0, 1, 0, 0, 1).getTime();
  const stored = new Map<string, { text: string; modified: number }>([
    ["/client/CustomMapData/wisp-model-load-p0.txt", { text: 'function PreloadFiles takes nothing returns nothing\ncall Preload( "0-456" )\nendfunction', modified: requestTime }],
    ["/client/Logs/War3Log.txt", { text: "1/1 00:00:00.000 GameMain Started\n1/1 00:00:01.001 model creation failed - Abilities\\Missing.mdx\n1/1 00:00:01.002 model creation failed - war3mapImported/Other.mdx", modified: requestTime + 1000 }],
  ]);
  const files = GameFiles.of({
    read: path => Effect.succeed(stored.get(path)),
    write: (path, text) => Effect.sync(() => { stored.set(path, { text: String(text), modified: requestTime + 1000 }); }),
    replace: () => Effect.void, list: () => Effect.succeed([]), remove: () => Effect.void, installMap: () => Effect.void,
  });
  const bridge = modelFailureBridge(files);
  await Effect.runPromise(bridge(["/client/CustomMapData"]));
  for (const [ordinal, path] of [[1, "Abilities/Missing.mdx"], [2, "war3mapImported/Other.mdx"]] as const) {
    const text = stored.get(hostPath("/client/CustomMapData", modelFailureFile("0-456", ordinal)))?.text;
    expect(text).toContain(`"${path}"`);
  }
  expect(preloadLines(stored.get("/client/CustomMapData/wisp-model-load-p0.txt")?.text ?? "")).toEqual(["0-456"]);
});
