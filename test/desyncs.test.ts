import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "bun:test";
import { Deferred, Effect, Exit, Layer } from "effect";
import { TestClock } from "effect/testing";
import { runHotWatch } from "../scripts/wisp/commands/hot";
import { type DesyncReport, Desyncs, PARTNER_WAIT_MILLIS, decodeDesyncSummary, divergedValues, formatDesync } from "../scripts/wisp/desyncs";
import { GameFiles, type StoredFile } from "../scripts/wisp/gameFiles";

// The observed Desync.txt grammar, without the machine description around it.
// Values are those of a native reload desync: one client allocated one more handle.
const report = (birthTag: string, tempest: string, closed = true) => [
  "<Application>Warcraft III",
  "<Exception.BuildNumber>24268",
  "",
  "<Exception.Summary:>",
  "Network desync on turn 12585 in game W3-00000000-0000-0000-0000-000000000000",
  "<:Exception.Summary>",
  "<Exception.Assertion:>",
  "War3 build 7000",
  `War3 next presence tag 04406 next birth tag ${birthTag}`,
  `War3 tempest checksum ${tempest}`,
  "War3 net checksum 76e87acc",
  "War3 rand checksum 4dd420d8",
  "War3 custom unit checksum 571c6fc3",
  "",
  ...(closed ? ["<:Exception.Assertion>", "<Exception.HashBlock:>", "Network desync on turn 12585 in game W3-00000000-0000-0000-0000-000000000000", "<:Exception.HashBlock>", "", "<PlayerCount> 2", ""] : []),
].join("\r\n");
const A = report("08102", "cb35df6c");
const B = report("08103", "cbb742b8");

const decode = (text: string) => Effect.runPromise(decodeDesyncSummary("Desync.txt", text));

test("Warcraft desync summaries name each diverged engine value with every client's value", async () => {
  const [a, b] = [await decode(A), await decode(B)];
  expect(a?.turn).toBe(12585);
  expect(a?.values).toContainEqual(["custom unit checksum", "571c6fc3"]);
  expect(divergedValues(a === undefined || b === undefined ? [] : [a, b])).toEqual([
    { name: "next birth tag", values: ["08102", "08103"] },
    { name: "tempest checksum", values: ["cb35df6c", "cbb742b8"] },
  ]);
  expect(divergedValues(a === undefined ? [] : [a, a])).toEqual([]);
  expect(await decode(report("08102", "cb35df6c", false))).toBeUndefined();
  const malformed = await Effect.runPromiseExit(decodeDesyncSummary("Desync.txt", A.replaceAll("on turn 12585", "on turn x")));
  expect(Exit.isFailure(malformed)).toBe(true);
});

/** In-memory client folders: list returns the names directly inside a directory. */
function memoryFiles(storage: Map<string, StoredFile>) {
  return GameFiles.of({
    read: (path) => Effect.sync(() => storage.get(path)),
    list: (directory) => Effect.sync(() => [...new Set([...storage.keys()].filter((path) => path.startsWith(`${directory}/`)).map((path) => path.slice(directory.length + 1).split("/")[0] ?? ""))]),
    write: () => Effect.void, replace: () => Effect.void, remove: () => Effect.void, installMap: () => Effect.void,
  });
}

const directories = ["/a/CustomMapData", "/b/CustomMapData"];
const watcher = (storage: Map<string, StoredFile>) => Desyncs.layer(directories).pipe(Layer.provide(Layer.succeed(GameFiles, memoryFiles(storage))));

test("desync watcher ignores earlier and crash reports, waits for every client's whole report and reports once", async () => {
  const storage = new Map<string, StoredFile>();
  storage.set("/a/Errors/2026-10-04 12.47.05 a95cce0c/Desync.txt", { text: report("05227", "a13a7f1c"), modified: 0 });
  const result = await Effect.runPromise(Effect.gen(function*() {
    const desyncs = yield* Desyncs;
    expect(yield* desyncs.changed).toBeUndefined();
    storage.set("/b/Errors/2026-10-05 12.04.00 0000000b/Crash.txt", { text: "crash", modified: 0 });
    storage.set("/a/Errors/2026-10-05 12.05.09 98599828/Desync.txt", { text: report("08102", "cb35df6c", false), modified: 0 });
    expect(yield* desyncs.changed).toBeUndefined();
    storage.set("/a/Errors/2026-10-05 12.05.09 98599828/Desync.txt", { text: A, modified: 0 });
    expect(yield* desyncs.changed).toBeUndefined();
    storage.set("/b/Errors/2026-10-05 12.05.09 983fad00/Desync.txt", { text: B, modified: 0 });
    const found = yield* desyncs.changed;
    expect(yield* desyncs.changed).toBeUndefined();
    return found;
  }).pipe(Effect.provide(Layer.merge(watcher(storage), TestClock.layer()))));
  expect(result).toMatchObject({ clients: [0, 1], turns: [12585, 12585], missing: [] });
  expect(result === undefined ? "" : formatDesync(result)).toStartWith(
    "Warcraft desync on turn 12585, diverged: next birth tag (client 0: 08102, client 1: 08103), tempest checksum (client 0: cb35df6c, client 1: cbb742b8); 0 ms after the game wrote its report\n/a/Errors/",
  );
});

test("desync watcher reports a lone client's desync once its partner has had time to write", async () => {
  const storage = new Map<string, StoredFile>();
  const result = await Effect.runPromise(Effect.gen(function*() {
    const desyncs = yield* Desyncs;
    storage.set("/b/Errors/2026-10-05 12.05.09 983fad00/Desync.txt", { text: B, modified: 0 });
    expect(yield* desyncs.changed).toBeUndefined();
    yield* TestClock.adjust(PARTNER_WAIT_MILLIS - 1);
    expect(yield* desyncs.changed).toBeUndefined();
    yield* TestClock.adjust(1);
    return yield* desyncs.changed;
  }).pipe(Effect.provide(Layer.merge(watcher(storage), TestClock.layer()))));
  expect(result === undefined ? "" : formatDesync(result)).toStartWith(`Warcraft desync on turn 12585, client 0 wrote no desync report within ${PARTNER_WAIT_MILLIS} ms;`);
});

test("hot watch prints a desync's diverged subsystem, turn and both clients' values within 1 s of the game writing it", async () => {
  const root = mkdtempSync(join(tmpdir(), "wisp-desync-"));
  const data = ["a", "b"].map((client) => join(root, client, "CustomMapData"));
  for (const directory of [...data, join(root, "source")]) mkdirSync(directory, { recursive: true });
  const write = (client: string, folder: string, text: string) => {
    mkdirSync(join(root, client, "Errors", folder), { recursive: true });
    writeFileSync(join(root, client, "Errors", folder, "Desync.txt"), text);
  };
  write("a", "2026-10-04 12.47.05 a95cce0c", report("05227", "a13a7f1c"));
  const printed = await Effect.runPromise(Effect.gen(function*() {
    const desyncs = yield* Desyncs;
    const done = yield* Deferred.make<{ readonly report: DesyncReport; readonly at: number }>();
    let written = 0;
    const poll = Effect.gen(function*() {
      const found = yield* desyncs.changed;
      if (found !== undefined) yield* Deferred.succeed(done, { report: found, at: performance.now() });
    });
    const game = Effect.promise(async () => {
      await Bun.sleep(120);
      write("a", "2026-10-05 12.05.09 98599828", A);
      await Bun.sleep(3);
      write("b", "2026-10-05 12.05.09 983fad00", B);
      written = performance.now();
    });
    yield* Effect.forkChild(game);
    yield* runHotWatch(join(root, "source"), Effect.void, poll, Deferred.await(done).pipe(Effect.asVoid, Effect.timeout("3 seconds"), Effect.ignore));
    const { report: found, at } = yield* Deferred.await(done).pipe(Effect.timeout("1 millis"));
    return { text: formatDesync(found), latency: found.latency, elapsed: at - written };
  }).pipe(Effect.provide(Desyncs.layer(data).pipe(Layer.provide(GameFiles.layer())))));
  expect(printed.text).toStartWith("Warcraft desync on turn 12585, diverged: next birth tag (client 0: 08102, client 1: 08103), tempest checksum (client 0: cb35df6c, client 1: cbb742b8);");
  expect(printed.text).toContain(join(root, "b", "Errors", "2026-10-05 12.05.09 983fad00", "Desync.txt"));
  expect(printed.elapsed).toBeLessThan(1000);
  expect(printed.latency).toBeLessThan(1000);
});
