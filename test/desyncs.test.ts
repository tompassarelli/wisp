import { expect, test } from "bun:test";
import { Clock, Effect, Layer } from "effect";
import { Desyncs, firstDesync, formatDesync, parseDesyncLog } from "../scripts/waygate/desyncs";
import { GameFiles, type StoredFile } from "../scripts/waygate/gameFiles";

// The observed native grammar, with small authored values: newest turn first.
const log = (value: string) => [
  "=======================================================================",
  "[Desync - 1918987876 - Turn(00000042) = 19]",
  "\t#0#: 0x00000001",
  "\t#1#",
  `\t\t#7#: ${value}`,
  "=======================================================================",
  "[Desync - 1918987876 - Turn(00000041) = 18]",
  "\t#0#: 0x00000001",
  "",
].join("\r\n");

test("native desync comparison identifies subsystem, first divergent turn and nested client values", () => {
  const difference = firstDesync([parseDesyncLog(log("0x00000011")), parseDesyncLog(log("0x00000012"))]);
  expect(difference).toEqual({ subsystem: "rand", turn: 42, field: "#1#/#7#", values: ["0x00000011", "0x00000012"], checksums: ["19", "19"] });
  expect(firstDesync([parseDesyncLog(log("0x00000011")), parseDesyncLog(log("0x00000011"))])).toBeUndefined();
  expect(firstDesync([parseDesyncLog(log("0x00000011")), parseDesyncLog(log("0x00000012").replaceAll("00000042", "00000043"))])).toBeUndefined();
});

test("desync watcher ignores old reports, waits for both stable logs and reports a new pair once", async () => {
  const storage = new Map<string, StoredFile>();
  const directories = ["/a/CustomMapData", "/b/CustomMapData"];
  storage.set("/a/Logs/old_Desync.log", { text: log("0x00000010"), modified: 1 });
  const files = GameFiles.of({
    read: (path) => Effect.sync(() => storage.get(path)),
    list: (directory) => Effect.sync(() => [...storage.keys()].filter((path) => path.startsWith(`${directory}/`)).map((path) => path.slice(directory.length + 1))),
    write: () => Effect.void, replace: () => Effect.void, remove: () => Effect.void, installMap: () => Effect.void,
  });
  const result = await Effect.runPromise(Effect.gen(function*() {
    const desyncs = yield* Desyncs;
    expect(yield* desyncs.changed).toBeUndefined();
    const now = yield* Clock.currentTimeMillis;
    storage.set("/a/Logs/first_Desync.log", { text: log("0x00000011"), modified: now });
    expect(yield* desyncs.changed).toBeUndefined();
    storage.set("/b/Logs/second_Desync.log", { text: log("0x00000012").slice(0, -2), modified: now });
    expect(yield* desyncs.changed).toBeUndefined();
    storage.set("/b/Logs/second_Desync.log", { text: log("0x00000012"), modified: now });
    expect(yield* desyncs.changed).toBeUndefined();
    const report = yield* desyncs.changed;
    expect(yield* desyncs.changed).toBeUndefined();
    return report;
  }).pipe(Effect.provide(Desyncs.layer(directories).pipe(Layer.provide(Layer.succeed(GameFiles, files))))));
  expect(result?.subsystem).toBe("rand");
  expect(result?.turn).toBe(42);
  expect(result?.latency).toBeLessThan(1000);
  expect(result === undefined ? "" : formatDesync(result)).toContain("client 0: 0x00000011, client 1: 0x00000012");
});
