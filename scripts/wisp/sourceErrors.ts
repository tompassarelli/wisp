// SourceErrors: runtime errors the game reports, with their Lua positions
// mapped back to TypeScript lines. Every chunk that can run in a client keeps
// its source map (wisp:scripts/sourceMaps.ts) under its key.
import { join } from "node:path";
import { Clock, Context, Effect, Layer, Schema } from "effect";
import { errorFile, errorHeading } from "../../src/runtime/gameFiles";
import { keepModuleSourceMap, keepSourceMap, toTypeScript } from "../sourceMaps";
import { ErrorReport, FILE_SLOT_NUMBERS, type MalformedGameFile } from "./boundary";
import { describeCause } from "./command";
import { type GameFileFailure, GameFiles } from "./gameFiles";

export class SourceMapFailure extends Schema.TaggedError<SourceMapFailure>()("SourceMapFailure", {
  operation: Schema.String,
  path: Schema.String,
  cause: Schema.Unknown,
}) {
  override get message(): string {
    return `${this.operation} failed for ${this.path}: ${describeCause(this.cause)}`;
  }
}

/** One client's error report, as TypeScript positions. */
export interface SourceError {
  readonly slot: number;
  /** `error N in HANDLER`. */
  readonly heading: string;
  /** The message and stack, each Lua position replaced by its TypeScript file and line. */
  readonly text: string;
  /** Milliseconds from the game writing the report to the host mapping it. */
  readonly latency: number;
}

export interface SourceErrorOptions {
  readonly sourceMapDirectory: string;
  readonly filePrefix?: string;
}

export class SourceErrors extends Context.Service<SourceErrors, {
  /** Keeps a compiled bundle's source map under its key, so reports from that bundle map back. */
  readonly retain: (bundlePath: string, key: string) => Effect.Effect<void, SourceMapFailure>;
  /** Keeps a hot-reload module's source map under its key. */
  readonly retainModule: (key: string, sourceMap: string) => Effect.Effect<void, SourceMapFailure>;
  /** Reports in these CustomMapData folders that are new or changed since the previous look. */
  readonly changed: (directories: readonly string[]) => Effect.Effect<readonly SourceError[], GameFileFailure | MalformedGameFile | SourceMapFailure>;
}>()("wisp/SourceErrors") {
  static readonly layer = ({ sourceMapDirectory, filePrefix = "wisp" }: SourceErrorOptions) => Layer.effect(SourceErrors, Effect.gen(function*() {
    const files = yield* GameFiles;
    const seen = new Map<string, string>();
    return SourceErrors.of({
      retain: (bundlePath, key) => Effect.try({
        try: () => keepSourceMap(bundlePath, key, sourceMapDirectory),
        catch: (cause) => new SourceMapFailure({ operation: "retain TypeScript source map", path: `${bundlePath}.map`, cause }),
      }),
      retainModule: (key, sourceMap) => Effect.try({
        try: () => keepModuleSourceMap(key, sourceMap, sourceMapDirectory),
        catch: (cause) => new SourceMapFailure({ operation: "retain TypeScript source map", path: join(sourceMapDirectory, `${key}.lua.map`), cause }),
      }),
      changed: Effect.fnUntraced(function*(directories) {
        const reports: SourceError[] = [];
        for (const directory of directories) {
          for (const slot of FILE_SLOT_NUMBERS) {
            const path = join(directory, errorFile(slot, filePrefix));
            const stored = yield* files.read(path);
            if (stored === undefined || seen.get(path) === stored.text) continue;
            // Marked seen before decoding, so a malformed report fails once, not on every look.
            seen.set(path, stored.text);
            const report = yield* ErrorReport.decode(path, stored.text);
            const text = yield* Effect.tryPromise({
              try: () => toTypeScript(report.lines.join("\n"), sourceMapDirectory),
              catch: (cause) => new SourceMapFailure({ operation: "map in-game error to TypeScript", path, cause }),
            });
            const latency = (yield* Clock.currentTimeMillis) - stored.modified;
            reports.push({ slot, heading: errorHeading(report.count, report.handler), text, latency });
          }
        }
        return reports;
      }),
    });
  }));
}
