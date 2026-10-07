// The sample map's commands, composed from Wisp's services.
// Usage (from the Wisp checkout): bun examples/sample/scripts/sample.ts COMMAND [ARGUMENTS]
import { homedir } from "node:os";
import { join } from "node:path";
import { Effect, Layer } from "effect";
import { runCli } from "wisp/scripts/wisp/cli";
import { Clients } from "wisp/scripts/wisp/clients";
import { type Command, UsageFailure, flagValues } from "wisp/scripts/wisp/command";
import { makeClient } from "wisp/scripts/wisp/commands/client";
import { makeHot } from "wisp/scripts/wisp/commands/hot";
import { GameFiles } from "wisp/scripts/wisp/gameFiles";
import { freshMatch } from "wisp/scripts/wisp/lobby";
import { ClientWatch } from "wisp/scripts/wisp/watch";
import { type BuildProject, MapBuild } from "wisp/scripts/wisp/mapBuild";
import { SourceErrors } from "wisp/scripts/wisp/sourceErrors";
import type { MapDeclaration } from "wisp/scripts/mapInfo";

const sample = join(import.meta.dir, "..");
// In a project that installs the wisp package, this is the project's own root.
const root = join(sample, "../..");
const sourceDirectory = join(sample, "src");
const sourceMapDirectory = join(sample, "build/source-maps");
/** The map's configureRuntime() filePrefix in src/main.ts. */
const filePrefix = "sample";
const NAME = "Wisp Sample";
const clientsFile = process.env.WISP_CLIENTS ?? join(homedir(), ".local/state/wisp/clients.json");

const project: BuildProject = {
  projectRoot: root,
  configPath: join(sample, "tsconfig.map.json"),
  bundlePath: join(sample, "build/map.lua"),
  compileInputs: [sourceDirectory, join(root, "src"), join(root, "plugins"), join(sample, "tsconfig.map.json")],
  packager: join(root, "build/tools/map-pack"),
  toolchainLockPath: join(root, "typescript-toolchain.lock"),
  packageDirectory: root,
};

const declaration: MapDeclaration = {
  author: "Wisp",
  description: "Two Footmen walk a square around the center. Type -ping.",
  suggestedPlayers: "2",
  players: [{ id: 0, name: "Player 1" }, { id: 1, name: "Player 2" }],
  forces: [{ name: "Players", playerIds: [0, 1] }],
};

const mapServices = MapBuild.layer(project).pipe(
  Layer.provideMerge(SourceErrors.layer({ sourceMapDirectory, filePrefix })),
  Layer.provide(GameFiles.layer()),
);

const build: Command = (args) => Effect.gen(function*() {
  const [base] = flagValues(args, "base");
  const [out] = flagValues(args, "out");
  const [container] = flagValues(args, "container");
  if (base === undefined || out === undefined) return yield* new UsageFailure({ problem: "build needs --base and --out" });
  yield* MapBuild.use((maps) => maps.build({ base, out, name: NAME, declaration, ...(container === undefined ? {} : { container }) }));
}).pipe(Effect.provide(mapServices));

const rebuild: Command = ([map, ...rest]) => Effect.gen(function*() {
  if (map === undefined || rest.length > 0) return yield* new UsageFailure({ problem: "rebuild takes one map" });
  yield* MapBuild.use((maps) => maps.rebuild(map));
}).pipe(Effect.provide(mapServices));

const fresh: Command = ([map, ...flags]) => Effect.gen(function*() {
  const [mapFolder = "Maps/00-Wisp"] = flagValues(flags, "map-folder");
  const known = flags.every((flag, index) => flag === "--rebuild" || flag === "--map-folder" || flags[index - 1] === "--map-folder");
  if (map === undefined || !known) return yield* new UsageFailure({ problem: "fresh takes MAP.w3x and its options" });
  if (flags.includes("--rebuild")) yield* MapBuild.use((maps) => maps.rebuild(map)).pipe(Effect.provide(mapServices));
  yield* freshMatch({ map, folder: mapFolder.replace(/^Maps\//, ""), filePrefix }).pipe(
    Effect.provide(Layer.mergeAll(Clients.layer(clientsFile), GameFiles.layer({ mapFolder, replacedMaps: "wisp-replaced-maps" }), ClientWatch.layer({ filePrefix }))),
  );
});

process.exit(await runCli("bun examples/sample/scripts/sample.ts", {
  map: { usage: "build --base BASE.w3m --out OUT.w3x [--container MAP.w3x] | rebuild MAP.w3x", load: async () => ([verb, ...args]) => verb === "build" ? build(args) : verb === "rebuild" ? rebuild(args) : Effect.fail(new UsageFailure({ problem: "map takes build or rebuild" })) },
  hot: { usage: "--data DIR [--data DIR ...] [--watch]", load: async () => makeHot({ project, sourceDirectory, sourceMapDirectory, filePrefix }) },
  fresh: { usage: "MAP.w3x [--rebuild] [--map-folder Maps/00-Wisp]   (WISP_CLIENTS=clients.json)", load: async () => fresh },
  client: { usage: "look|read|click|keys|chat CLIENT ... | watch [CLIENT...] [--once] [--json] [--record FILE] | wait CLIENT STATE... [--seconds N]   (WISP_CLIENTS=clients.json)", load: async () => makeClient(clientsFile, { filePrefix }) },
  menus: {
    usage: "install|remove RETAIL_DIR | listen | host --folder F --map FILE --name NAME [--password P] [--start] | join --name NAME --password P | start | leave   [--port N]",
    load: async () => (await import("wisp/scripts/wisp/commands/menus")).makeMenus(),
  },
  engine: {
    usage: "desync|poll|diff|trace|locate|actions ...   (WISP_CLIENTS=clients.json; a LAN pool's is ~/.local/state/wisp/lan/clients.json)",
    load: async () => {
      const { makeEngine } = await import("wisp/scripts/wisp/commands/engine");
      return makeEngine(clientsFile);
    },
  },
  lan: {
    usage: "setup --from INSTALL [--pairs N] | pool [--pairs N] [--pool-profile parity|visual] [--fps N] | fresh MAP [--pair K] | status | end --pair K",
    load: async () => (await import("wisp/scripts/wisp/commands/lan")).lan,
  },
  headless: {
    usage: "[ping-reload] [--clients N]",
    load: async () => {
      const { makeHeadless } = await import("wisp/scripts/wisp/commands/headless");
      return makeHeadless(async () => {
        const { SAMPLE_JOURNEY, SAMPLE_MAP } = await import("../test/journey");
        return { map: SAMPLE_MAP, entry: join(sourceDirectory, "main.ts"), journeys: { "ping-reload": SAMPLE_JOURNEY } };
      });
    },
  },
}, process.argv.slice(2)));
