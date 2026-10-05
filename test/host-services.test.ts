import { readFileSync, mkdtempSync, utimesSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Cause, Clock, Effect, Exit, Fiber, Layer, Schema } from "effect";
import { TestClock } from "effect/testing";
import { expect, test } from "bun:test";
import { Acknowledgement, ErrorReport, manifestVersion, payloadFileKey, preloadRecord } from "../scripts/waygate/boundary";
import { validateDataDirectories } from "../scripts/waygate/commands/hot";
import { GameFiles } from "../scripts/waygate/gameFiles";
import { HotReload } from "../scripts/waygate/hotReload";
import { MapBuild, freshBundleAge, type CompiledBundle } from "../scripts/waygate/mapBuild";
import { SourceErrors } from "../scripts/waygate/sourceErrors";
import { SourceMapGenerator } from "source-map";
import { toTypeScript } from "../scripts/sourceMaps";
const fixture = (name: string) => readFileSync(join(import.meta.dir, "fixtures/waygate", name), "utf8");
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
test("hot reload publishes payloads before manifests and waits for each fake client acknowledgement", async () => {
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
    write: (path) => Effect.sync(() => events.push(`payload:${path}`)),
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
  for (const directory of directories) {
    const payload = events.findIndex((event) => event.startsWith(`payload:${directory}/`));
    const manifest = events.findIndex((event) => event === `manifest:${directory}/custom-hot-manifest-1.pld`);
    const acknowledgementRead = events.findIndex((event) => event === `ack:${directory}/custom-hot-ack-p0.txt`);
    expect(payload).toBeGreaterThanOrEqual(0);
    expect(manifest).toBeGreaterThan(payload);
    expect(acknowledgementRead).toBeGreaterThan(manifest);
  }
});

test("hot reload requires distinct non-empty client data directories", async () => {
  expect(await Effect.runPromise(validateDataDirectories(["/client/data"]))).toEqual(["/client/data"]);
  expect(Exit.isFailure(await Effect.runPromiseExit(validateDataDirectories([])))).toBe(true);
  expect(Exit.isFailure(await Effect.runPromiseExit(validateDataDirectories([""])))).toBe(true);
  expect(Exit.isFailure(await Effect.runPromiseExit(validateDataDirectories(["/client/data", "/client/data"])))).toBe(true);
});

test("map rebuild reuses the bundle only while it is newer than every compile input", () => {
  const root = mkdtempSync(join(tmpdir(), "waygate-fresh-"));
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
  const root = mkdtempSync(join(tmpdir(), "waygate-source-maps-"));
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

test("manifest and payload parsing selects only the requested project prefix", () => {
  expect(manifestVersion("custom-hot-manifest-17.pld", "custom")).toBe(17);
  expect(manifestVersion("waygate-hot-manifest-17.pld", "custom")).toBeUndefined();
  expect(payloadFileKey("custom-hot-101-24-0.pld", "custom")).toBe("101-24");
  expect(payloadFileKey("other-hot-101-24-0.pld", "custom")).toBeUndefined();
});
