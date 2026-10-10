import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "bun:test";
import ts from "typescript";
import { Console, Effect, Layer } from "effect";
import { MapBuild } from "../scripts/wisp/mapBuild";
import { SourceErrors } from "../scripts/wisp/sourceErrors";
import { GameFiles } from "../scripts/wisp/gameFiles";

test("[spec #95] map build compilation prints file:line warnings and matching cleanup prints none", async () => {
  mkdirSync(join(import.meta.dir, "../build"), { recursive: true });
  const directory = mkdtempSync(join(import.meta.dir, "../build/handle-build-"));
  const source = join(directory, "map.ts");
  const config = join(directory, "tsconfig.json");
  writeFileSync(join(directory, "natives.d.ts"), "declare function Location(x: number, y: number): object; declare function RemoveLocation(h: object): void; declare function CreateGroup(): object; declare function DestroyGroup(h: object): void;");
  writeFileSync(config, JSON.stringify({ compilerOptions: {
    target: "ESNext", lib: ["ES2015"], module: "ESNext", moduleResolution: "Bundler", types: [], skipLibCheck: true,
    rootDir: ".", outDir: "out", sourceMap: true,
  }, include: ["*.ts"], tstl: { luaTarget: "5.3", luaBundle: "map.lua", luaBundleEntry: "map.ts", noHeader: true } }));
  const messages: string[] = [];
  const sourceErrors = SourceErrors.layer({ sourceMapDirectory: join(directory, "sourcemaps") }).pipe(Layer.provide(GameFiles.layer()));
  const maps = MapBuild.layer({ projectRoot: directory, configPath: config, bundlePath: join(directory, "out/map.lua"),
    compileInputs: [source], packager: "unused", toolchainLockPath: "unused", packageDirectory: directory }).pipe(Layer.provide(sourceErrors));
  const compile = MapBuild.use(map => map.compile).pipe(Effect.provide(maps), Effect.provideService(Console.Console, {
    ...console, warn: (...args: unknown[]) => { messages.push(args.join(" ")); },
  }));
  writeFileSync(source, "export function install() {\nconst point = Location(0, 0);\nconst units = CreateGroup();\n}\n");
  await Effect.runPromise(compile);
  expect(messages.join("\n")).toContain("map.ts:2:15: warning TS9501: Unmatched Location");
  expect(messages.join("\n")).toContain("map.ts:3:15: warning TS9501: Unmatched CreateGroup");
  messages.length = 0;
  writeFileSync(source, "export function install() {\nconst point = Location(0, 0); RemoveLocation(point);\nconst units = CreateGroup(); DestroyGroup(units);\n}\n");
  await Effect.runPromise(compile);
  expect(messages).toEqual([]);
});
