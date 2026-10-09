import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "bun:test";
import ts from "typescript";
import { handleWarnings } from "../scripts/handleWarnings";
import { installHeadless } from "../scripts/wisp/headless";
import { Console, Effect, Layer } from "effect";
import { MapBuild } from "../scripts/wisp/mapBuild";
import { SourceErrors } from "../scripts/wisp/sourceErrors";
import { GameFiles } from "../scripts/wisp/gameFiles";

test("[spec #95] source-owned native allocations warn at their line, cleanup clears them, escaping and branches stay unknown", () => {
  mkdirSync(join(import.meta.dir, "../build"), { recursive: true });
  const directory = mkdtempSync(join(import.meta.dir, "../build/handle-cleanup-"));
  const declarations = join(directory, "natives.d.ts");
  const source = join(directory, "map.ts");
  writeFileSync(declarations, "declare function Location(x: number, y: number): object; declare function RemoveLocation(h: object): void; declare function CreateGroup(): object; declare function DestroyGroup(h: object): void; declare function save(h: object): void;");
  writeFileSync(source, `function unmatched() {
  const point = Location(0, 0);
  const units = CreateGroup();
}
function cleaned() {
  const point = Location(0, 0); RemoveLocation(point);
  const units = CreateGroup(); DestroyGroup(units); return 1;
}
function escaped() { const point = Location(0, 0); save(point); }
function conditional(flag: boolean) { const units = CreateGroup(); if (flag) DestroyGroup(units); }
function returned() { return Location(0, 0); }
function captured() { const units = CreateGroup(); return () => DestroyGroup(units); }
function shadowed() { function CreateGroup() { return {}; } const units = CreateGroup(); }
`);
  const program = ts.createProgram([declarations, source], { noLib: true, types: [] });
  const warnings = handleWarnings(program);
  expect(warnings.map(w => [w.file?.getLineAndCharacterOfPosition(w.start ?? 0).line, String(w.messageText).includes("UNKNOWN")]))
    .toEqual([[1, false], [2, false], [8, true], [9, true], [10, true], [11, true]]);
});

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

test("[spec #95] headless map journey reports live locations and groups returning to baseline", () => {
  const runtime = installHeadless({ filePrefix: "handles95", globalPrefixes: [] });
  try {
    const clients = runtime.clients({ start: () => {
      const point = Location(12, 34);
      const units = CreateGroup();
      expect([GetLocationX(point), GetLocationY(point)]).toEqual([12, 34]);
      TimerStart(CreateTimer(), 1 / 60, false, () => { RemoveLocation(point); DestroyGroup(units); });
    }, install: () => {} });
    const counts = () => clients.clients.map(c => c.liveHandleCounts());
    const before = counts();
    clients.start();
    const created = counts();
    clients.frames(2);
    const cleaned = counts();
    console.log(JSON.stringify({ before, created, cleaned }));
    expect(created).toEqual(before.map(c => ({ locations: c.locations + 1, groups: c.groups + 1 })));
    expect(cleaned).toEqual(before);
    expect(clients.firstDivergence()).toBeUndefined();
  } finally { runtime.restore(); }
});
