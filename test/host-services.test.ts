import { expect, test } from "bun:test";
import { readFileSync, mkdtempSync, statSync, utimesSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect, Layer, Schema } from "effect";
import { hostPath, linePreloadFile, preloadRecord } from "../scripts/wisp/boundary";
import { hostFile } from "../src/runtime/gameFiles";
import { GameFiles, prepareHotFolders } from "../scripts/wisp/gameFiles";
import { freshBundleAge } from "../scripts/wisp/mapBuild";
import { SourceErrors } from "../scripts/wisp/sourceErrors";
import { SourceMapGenerator } from "source-map";

test("[property seed 94905] Preload assignments preserve text between independently generated numeric fields", async () => {
  const kind = preloadRecord({ head: ["received-mask={mask} reason={reason} sequence={sequence} frame={frame}"] }, Schema.Struct({ mask: Schema.FiniteFromString, reason: Schema.NonEmptyString, sequence: Schema.FiniteFromString, frame: Schema.FiniteFromString }));
  let seed = 94905;
  for (let sequence = 0; sequence < 64; sequence++) {
    seed = Math.imul(seed, 1664525) + 1013904223;
    const mask = seed >>> 0;
    const reason = ["input submission failed", "waiting for both clients", "received-mask key intact"][sequence % 3]!;
    const frame = sequence * 417;
    const text = 'function PreloadFiles takes nothing returns nothing\ncall Preload( "received-mask=' + mask + ' reason=' + reason + ' sequence=' + sequence + ' frame=' + frame + '" )\nendfunction\n';
    expect(await Effect.runPromise(kind.decode("seed-94905-" + sequence + ".pld", text))).toEqual({ mask, reason, sequence, frame });
  }
});

test("[scenario] real hot folders and source-map files remain isolated and idempotent across consumers", async () => {
  const root = mkdtempSync(join(tmpdir(), "wisp-hot-files-"));
  const directories = [join(root, "a"), join(root, "b")];
  try {
    await Effect.runPromise(prepareHotFolders(directories, "custom").pipe(Effect.provide(GameFiles.layer())));
    for (const directory of directories) {
      expect(statSync(join(directory, "custom-hot")).isDirectory()).toBe(true);
      const marker = hostPath(directory, hostFile("custom"));
      expect(readFileSync(marker, "utf8")).toBe(linePreloadFile("host"));
      utimesSync(marker, 1, 1);
    }
    await Effect.runPromise(prepareHotFolders(directories, "custom").pipe(Effect.provide(GameFiles.layer())));
    for (const [index, directory] of directories.entries()) {
      expect(statSync(hostPath(directory, hostFile("custom"))).mtimeMs).toBe(1000);
      const map = new SourceMapGenerator({ file: "map.lua" });
      map.addMapping({ generated: { line: 42, column: 0 }, original: { line: 7, column: 0 }, source: "src/client-" + index + ".ts" });
      writeFileSync(join(directory, "map.lua.map"), map.toString());
      writeFileSync(join(directory, "custom-error-p0.txt"), readFileSync(join(import.meta.dir, "fixtures/wisp/error-report.pld")));
      const reports = await Effect.runPromise(Effect.gen(function*() {
        const errors = yield* SourceErrors;
        yield* errors.retain(join(directory, "map.lua"), "101-24");
        const reports = yield* errors.changed([directory]);
        expect(yield* errors.changed([directory])).toEqual([]);
        return reports;
      }).pipe(Effect.provide(SourceErrors.layer({ sourceMapDirectory: join(directory, "sourcemaps"), filePrefix: "custom" }).pipe(Layer.provide(GameFiles.layer())))));
      expect(reports[0]?.text).toContain("src/client-" + index + ".ts:7");
    }
  } finally {
    rmSync(root, { recursive: true });
  }
});

test("[property] cache freshness agrees with independently varied source and configuration ages", () => {
  const root = mkdtempSync(join(tmpdir(), "wisp-fresh-"));
  const source = join(root, "entry.ts"), config = join(root, "tsconfig.json"), bundle = join(root, "map.lua");
  try {
    for (const file of [source, config, bundle, bundle + ".map"]) writeFileSync(file, "");
    for (const seconds of [2, 100, 250, 400]) {
      utimesSync(bundle, seconds, seconds);
      for (const changed of [source, config]) for (const delta of [-1, 0, 1]) {
        for (const file of [source, config]) utimesSync(file, seconds - 1, seconds - 1);
        utimesSync(changed, seconds + delta, seconds + delta);
        expect(freshBundleAge(bundle, [source, config], (seconds + 3) * 1000)).toBe(delta < 0 ? 3 : undefined);
      }
    }
  } finally {
    rmSync(root, { recursive: true });
  }
});
