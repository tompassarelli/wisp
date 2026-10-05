import { readFileSync, mkdtempSync, statSync, utimesSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Cause, Clock, Effect, Exit, Fiber, Layer, Schema } from "effect";
import { TestClock } from "effect/testing";
import { expect, test } from "bun:test";
import { Acknowledgement, ErrorReport, bytesChecksum, hostPath, linePreloadFile, manifestVersion, payloadFileKey, preloadRecord } from "../scripts/wisp/boundary";
import { hostFile, manifestFile, payloadFile } from "../src/runtime/gameFiles";
import { checksum } from "../src/runtime/payload";
import { validateDataDirectories } from "../scripts/wisp/commands/hot";
import { GameFiles, prepareHotFolders } from "../scripts/wisp/gameFiles";
import { HotReload } from "../scripts/wisp/hotReload";
import { MapBuild, freshBundleAge, type CompiledBundle } from "../scripts/wisp/mapBuild";
import { SourceErrors } from "../scripts/wisp/sourceErrors";
import { SourceMapGenerator } from "source-map";
import { toTypeScript } from "../scripts/sourceMaps";
const fixture = (name: string) => readFileSync(join(import.meta.dir, "fixtures/wisp", name), "utf8");
test("Preload records decode final assignments and hyphenated keys without including their key", async () => {
  const kind = preloadRecord({ head: ["received-mask={mask} frame={frame}"] }, Schema.Struct({ mask: Schema.FiniteFromString, frame: Schema.FiniteFromString }));
  const text = 'function PreloadFiles takes nothing returns nothing\ncall Preload( "received-mask=3 frame=417" )\nendfunction\n';
  expect(await Effect.runPromise(kind.decode("control.txt", text))).toEqual({ mask: 3, frame: 417 });
  const result = await Effect.runPromiseExit(kind.decode("control-malformed.txt", text.replace("frame=417", "frame=nope")));
  expect(Exit.isFailure(result)).toBe(true);
  if (Exit.isFailure(result)) {
    expect(Cause.pretty(result.cause)).toContain("control-malformed.txt: frame:");
  }
});
test("Preload text assignments preserve a multiword reason before the next numeric key", async () => {
  const kind = preloadRecord({ head: ["reason={reason} sequence={sequence} frame={frame}"] }, Schema.Struct({ reason: Schema.NonEmptyString, sequence: Schema.FiniteFromString, frame: Schema.FiniteFromString }));
  const text = 'function PreloadFiles takes nothing returns nothing\ncall Preload( "reason=input submission failed sequence=4 frame=417" )\nendfunction\n';
  expect(await Effect.runPromise(kind.decode("failure.txt", text))).toEqual({ reason: "input submission failed", sequence: 4, frame: 417 });
});
test("framework game-written file kinds decode native Preload fixtures", async () => {
  expect(await Effect.runPromise(Acknowledgement.decode("ack.txt", fixture("acknowledgement.pld")))).toEqual({ version: 42, elapsed: 621.2031 });
  expect(await Effect.runPromise(ErrorReport.decode("error.txt", fixture("error-report.pld")))).toEqual({ count: 3, handler: "OnTrigger", lines: ["attempt to call nil value", "smashcraft-hot-101-24:42: in function 'OnTrigger'"] });
});
test("malformed framework fixtures report their file and typed field", async () => {
  for (const [file, kind, source, field] of [["ack-malformed.txt", Acknowledgement, "acknowledgement-malformed.pld", "version"], ["error-malformed.txt", ErrorReport, "error-report-malformed.pld", "count"]] as const) {
    const result = await Effect.runPromiseExit(kind.decode(file, fixture(source)));
    expect(Exit.isFailure(result)).toBe(true);
    if (Exit.isFailure(result)) { expect(Cause.pretty(result.cause)).toContain(file); expect(Cause.pretty(result.cause)).toContain(field); }
  }
});
test("hot reload gives every client its payload before any manifest and waits for each fake client acknowledgement", async () => {
  const directories = ["/a/CustomMapData", "/b/CustomMapData"] as const;
  const events: string[] = [];
  const acknowledgement = "function PreloadFiles takes nothing returns nothing\ncall Preload( \"applied 1 at 0\" )\nendfunction\n";
  let acknowledgeAt: number | undefined;
  const files = GameFiles.of({
    read: (path) => Effect.gen(function*() {
      const now = yield* Clock.currentTimeMillis;
      if (acknowledgeAt !== undefined && now >= acknowledgeAt && path.endsWith("ack-p0.txt")) {
        events.push(`ack:${path}`);
        return { text: acknowledgement, modified: acknowledgeAt };
      }
      return undefined;
    }),
    write: (path) => Effect.sync(() => events.push(path.endsWith("/host.pld") ? `marker:${path}` : `payload:${path}`)),
    replace: (path) => Effect.gen(function*() {
      events.push(`manifest:${path}`);
      acknowledgeAt = (yield* Clock.currentTimeMillis) + 10;
    }),
    list: () => Effect.succeed([]),
    remove: () => Effect.void,
    installMap: () => Effect.void,
  });
  const bundle = { text: "bundle", bytes: new TextEncoder().encode("bundle"), key: "6-abc", checksum: "6:abc" } satisfies CompiledBundle;
  const mapBuild = MapBuild.of({ compile: Effect.succeed(bundle), build: () => Effect.void, rebuild: () => Effect.void });
  const dependencies = Layer.merge(Layer.succeed(GameFiles, files), Layer.succeed(MapBuild, mapBuild));
  const hotLayer = HotReload.layer(directories, "custom").pipe(Layer.provide(dependencies));
  const program = Effect.gen(function*() {
    const hot = yield* HotReload;
    return yield* hot.publish;
  });

  const clocked = Effect.gen(function*() {
    const fiber = yield* Effect.forkChild(program);
    for (let advance = 0; advance < 4; advance++) {
      yield* Effect.yieldNow;
      yield* TestClock.adjust("5 millis");
    }
    return yield* Fiber.join(fiber);
  }).pipe(Effect.provide(Layer.merge(hotLayer, TestClock.layer())));
  expect(await Effect.runPromise(clocked)).toBe(1);
  // The first client to answer makes every other client load at once.
  const lastPayload = events.findLastIndex((event) => event.startsWith("payload:"));
  const firstManifest = events.findIndex((event) => event.startsWith("manifest:"));
  expect(firstManifest).toBeGreaterThan(lastPayload);
  for (const directory of directories) {
    const marker = events.findIndex((event) => event === `marker:${directory}/custom-hot/host.pld`);
    const payload = events.findIndex((event) => event.startsWith(`payload:${directory}/custom-hot/`));
    const manifest = events.findIndex((event) => event === `manifest:${directory}/custom-hot/manifest-1.pld`);
    const acknowledgementRead = events.findIndex((event) => event === `ack:${directory}/custom-hot-ack-p0.txt`);
    expect(marker).toBeGreaterThanOrEqual(0);
    expect(payload).toBeGreaterThan(marker);
    expect(manifest).toBeGreaterThan(payload);
    expect(acknowledgementRead).toBeGreaterThan(manifest);
  }
});

test("wisp hot creates every client's hot folder marker when it starts, once, before it can publish", async () => {
  const directories = ["/a/CustomMapData", "/b/CustomMapData"] as const;
  const stored = new Map<string, string | Uint8Array>();
  const writes: string[] = [];
  const files = GameFiles.of({
    read: (path) => Effect.sync(() => (stored.has(path) ? { text: String(stored.get(path)), modified: 0 } : undefined)),
    write: (path, contents) => Effect.sync(() => {
      writes.push(path);
      stored.set(path, contents);
    }),
    replace: () => Effect.void,
    list: () => Effect.succeed([]),
    remove: () => Effect.void,
    installMap: () => Effect.void,
  });
  const mapBuild = MapBuild.of({ compile: Effect.die("not compiled"), build: () => Effect.void, rebuild: () => Effect.void });
  const dependencies = Layer.merge(Layer.succeed(GameFiles, files), Layer.succeed(MapBuild, mapBuild));
  const start = () => Effect.runPromise(Effect.scoped(Layer.build(HotReload.layer(directories, "custom").pipe(Layer.provide(dependencies)))));
  await start();
  // Starting is all it did: no payload, no manifest.
  expect(writes).toEqual(directories.map((directory) => `${directory}/custom-hot/host.pld`));
  expect(stored.get(writes[0] ?? "")).toBe(linePreloadFile("host"));
  // A later run finds the marker and leaves it alone: a client may be reading it.
  await start();
  expect(writes).toHaveLength(directories.length);
});

test("the hot folder and its marker are created on disk, and an existing marker is not rewritten", async () => {
  const root = mkdtempSync(join(tmpdir(), "wisp-hot-folder-"));
  const directories = [join(root, "a", "CustomMapData"), join(root, "b", "CustomMapData")];
  const prepare = Effect.runPromise(prepareHotFolders(directories, "custom").pipe(Effect.provide(GameFiles.layer())));
  await prepare;
  for (const directory of directories) {
    expect(statSync(join(directory, "custom-hot")).isDirectory()).toBe(true);
    expect(readFileSync(hostPath(directory, hostFile("custom")), "utf8")).toBe(linePreloadFile("host"));
    utimesSync(hostPath(directory, hostFile("custom")), 1, 1);
  }
  await Effect.runPromise(prepareHotFolders(directories, "custom").pipe(Effect.provide(GameFiles.layer())));
  for (const directory of directories) expect(statSync(hostPath(directory, hostFile("custom"))).mtimeMs).toBe(1000);
});

test("hot reload requires distinct non-empty client data directories", async () => {
  expect(await Effect.runPromise(validateDataDirectories(["/client/data"]))).toEqual(["/client/data"]);
  expect(Exit.isFailure(await Effect.runPromiseExit(validateDataDirectories([])))).toBe(true);
  expect(Exit.isFailure(await Effect.runPromiseExit(validateDataDirectories([""])))).toBe(true);
  expect(Exit.isFailure(await Effect.runPromiseExit(validateDataDirectories(["/client/data", "/client/data"])))).toBe(true);
});

test("map rebuild reuses the bundle only while it is newer than every compile input", () => {
  const root = mkdtempSync(join(tmpdir(), "wisp-fresh-"));
  const src = join(root, "src");
  mkdirSync(join(src, "game"), { recursive: true });
  const source = join(src, "game", "a.ts");
  const config = join(root, "tsconfig.map.json");
  const bundle = join(root, "map.lua");
  for (const file of [source, config, bundle, `${bundle}.map`]) writeFileSync(file, "");
  const at = (file: string, seconds: number) => utimesSync(file, seconds, seconds);
  at(source, 100);
  at(config, 100);
  at(bundle, 200);
  expect(freshBundleAge(bundle, [src, config], 203_000)).toBe(3);
  at(source, 250);
  expect(freshBundleAge(bundle, [src, config], 260_000)).toBeUndefined();
});

test("source maps stay in each consumer build directory even when payload keys match", async () => {
  const root = mkdtempSync(join(tmpdir(), "wisp-source-maps-"));
  const key = "101-24";
  for (const name of ["first", "second"]) {
    const directory = join(root, name);
    mkdirSync(directory);
    const bundle = join(directory, "map.lua");
    const map = new SourceMapGenerator({ file: "map.lua" });
    map.addMapping({ generated: { line: 42, column: 0 }, original: { line: 7, column: 0 }, source: `src/${name}.ts` });
    writeFileSync(`${bundle}.map`, map.toString());
    const sourceMapDirectory = join(directory, "sourcemaps");
    const paths: string[] = [];
    const files = GameFiles.of({
      read: (path) => Effect.sync(() => {
        paths.push(path);
        return path.endsWith("custom-error-p0.txt") ? { text: fixture("error-report.pld"), modified: 0 } : undefined;
      }),
      write: () => Effect.void, replace: () => Effect.void, list: () => Effect.succeed([]), remove: () => Effect.void, installMap: () => Effect.void,
    });
    const reports = await Effect.runPromise(Effect.gen(function*() {
      const errors = yield* SourceErrors;
      yield* errors.retain(bundle, key);
      return yield* errors.changed([directory]);
    }).pipe(Effect.provide(SourceErrors.layer({ sourceMapDirectory, filePrefix: "custom" }).pipe(Layer.provide(Layer.succeed(GameFiles, files))))));
    expect(paths[0]).toBe(join(directory, "custom-error-p0.txt"));
    expect(reports[0]?.text).toContain(`src/${name}.ts:7`);
    expect(await toTypeScript(`map-${key}:42`, sourceMapDirectory)).toBe(`src/${name}.ts:7`);
  }
});

test("hot files sit in the project's hot folder, whose names carry versions and payload keys", () => {
  expect(manifestFile(17, "custom")).toBe("custom-hot\\manifest-17.pld");
  expect(hostPath("/client/CustomMapData", payloadFile("101:24", 0, "custom"))).toBe("/client/CustomMapData/custom-hot/101-24-0.pld");
  expect(manifestVersion("manifest-17.pld")).toBe(17);
  expect(manifestVersion("custom-hot-manifest-17.pld")).toBeUndefined();
  expect(payloadFileKey("101-24-0.pld")).toBe("101-24");
  expect(payloadFileKey("manifest-17.pld")).toBeUndefined();
});

test("the host's bytes checksum equals the shared payload checksum", () => {
  let state = 12345;
  for (const length of [0, 1, 7, 4096, 100_000]) {
    const bytes = Uint8Array.from({ length }, () => (state = (Math.imul(state, 1103515245) + 12345) >>> 0) >>> 24);
    expect(bytesChecksum(bytes)).toBe(checksum(bytes.length, (index) => bytes[index] ?? 0));
  }
});
