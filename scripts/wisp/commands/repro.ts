// `wisp repro FILE [--test NAME]`: replays a moment a map saved
// (wisp:docs/repro.md) in two simulated clients of the game's map. Each must
// land on the checksum the game recorded; with --test, it then writes a test
// that replays the moment.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join, relative } from "node:path";
import { Console, Effect, Schema } from "effect";
import { type Repro, type ReproReplay, type ReproResult, parseRepro } from "../../../src/runtime/repro";
import { preloadRecord } from "../boundary";
import { type Command, UsageFailure, describeCause, flagValues } from "../command";
import { type HeadlessMap, installHeadless } from "../headless";
import { step } from "../timings";

/** What a game declares for `wisp repro`. */
export interface ReproProject {
  readonly map: HeadlessMap;
  /**
   * The module exporting `replayRepro`, a ReproReplay (wisp:src/runtime/repro.ts):
   * it restores the state the game saved and runs the saved frames. Loaded
   * when the command runs; it runs in each simulated client.
   */
  readonly replay: string;
  /** The directory where `--test NAME` writes NAME.tests.ts, a test registered with wisp:src/runtime/testing.ts. */
  readonly tests: string;
}

export class ReproFailure extends Schema.TaggedError<ReproFailure>()("ReproFailure", {
  file: Schema.String,
  problem: Schema.String,
}) {
  override get message(): string {
    return `${this.file}: ${this.problem}`;
  }
}

/** The simulated clients a repro replays in. */
const CLIENTS = [0, 1];

const ReproFile = preloadRecord({ rest: "lines" }, Schema.Struct({ lines: Schema.Array(Schema.String) }));

/** A repro file as the game writes it, Preload lines: the repro and the lines. */
export const readRepro = (file: string) => Effect.gen(function*() {
  const text = yield* Effect.try({ try: () => readFileSync(file, "utf8"), catch: (cause) => new ReproFailure({ file, problem: describeCause(cause) }) });
  const { lines } = yield* ReproFile.decode(file, text).pipe(Effect.mapError((error) => new ReproFailure({ file, problem: error.message })));
  const repro = parseRepro(lines);
  return typeof repro === "string" ? yield* new ReproFailure({ file, problem: repro }) : { repro, lines };
});

/** The module's replayRepro; throws when it exports none. */
export async function loadReplay(path: string): Promise<ReproReplay> {
  const module: unknown = await import(path);
  if (typeof module !== "object" || module === null || !("replayRepro" in module) || typeof module.replayRepro !== "function") throw new Error(`${path} exports no replayRepro()`);
  const { replayRepro } = module;
  return (repro) => replayRepro(repro);
}

/** Each simulated client's replay of the repro, in its own scope of the map's natives and globals. */
export function replayInClients(map: HeadlessMap, replay: ReproReplay, repro: Repro): ReproResult[] {
  const runtime = installHeadless(map);
  try {
    // The replay restores the saved state itself, so the clients never start the map.
    const clients = runtime.clients({ start: () => undefined, install: () => undefined }, CLIENTS);
    return clients.clients.map((client) => {
      let result: ReproResult | undefined;
      client.run(() => {
        result = replay(repro);
      });
      if (result === undefined) throw new Error(`p${client.slot} replayed nothing`);
      return result;
    });
  } finally {
    runtime.restore();
  }
}

/** The report's lines, and whether every client landed on the recorded checksum without a problem. */
export function reproReport(file: string, repro: Repro, results: readonly ReproResult[]): { readonly lines: string[]; readonly landed: boolean } {
  const lines = [`${basename(file)}: build ${repro.build}, frame ${repro.frame}, checksum ${repro.checksum}`];
  let landed = true;
  results.forEach((result, slot) => {
    lines.push(`p${slot}: ran ${result.frames} frames to checksum ${result.checksum}`);
    for (const problem of result.problems) lines.push(`p${slot}: ${problem}`);
    if (result.checksum !== repro.checksum || result.problems.length > 0) landed = false;
  });
  lines.push(landed
    ? `every client lands on the recorded checksum ${repro.checksum} at frame ${repro.frame}`
    : `the replay doesn't land on the recorded checksum ${repro.checksum} at frame ${repro.frame}`);
  return { lines, landed };
}

/** Test names become file names and test titles. */
const isTestName = (name: string) => /^[a-z0-9][a-z0-9-]*$/.test(name);

/** NAME.tests.ts: a registered test that replays the repro's lines and requires the recorded checksum. */
export function reproTestSource(name: string, file: string, repro: Repro, replayImport: string, lines: readonly string[]): string {
  return [
    `// \`wisp repro ${basename(file)} --test ${name}\` wrote this: the moment build`,
    `// ${repro.build} saved, ending on frame ${repro.frame}. Replaying it must reach the checksum the game recorded.`,
    `import { assertReproLands } from "wisp/src/runtime/repro";`,
    `import { test } from "wisp/src/runtime/testing";`,
    `import { replayRepro } from "${replayImport}";`,
    "",
    "const LINES = [",
    ...lines.map((line) => `  ${JSON.stringify(line)},`),
    "];",
    "",
    `test("repro ${name}", () => assertReproLands(LINES, replayRepro));`,
    "",
  ].join("\n");
}

/** The import specifier of `module` from a file in `directory`, without its extension. */
function importFrom(directory: string, module: string): string {
  const path = relative(directory, module).replace(/\.ts$/, "");
  return path.startsWith(".") ? path : `./${path}`;
}

/** `repro FILE [--test NAME]`; loads the game's modules only when it runs. */
export const makeRepro = (load: () => Promise<ReproProject>): Command => (args) => Effect.gen(function*() {
  const [name, ...extra] = flagValues(args, "test");
  const files = args.filter((arg, index) => !arg.startsWith("--") && args[index - 1] !== "--test");
  const file = files[0];
  if (file === undefined || files.length > 1 || extra.length > 0 || (args.includes("--test") && name === undefined)) {
    return yield* new UsageFailure({ problem: "repro takes one repro file and at most one --test NAME" });
  }
  if (name !== undefined && !isTestName(name)) return yield* new UsageFailure({ problem: `test names are lowercase letters, digits and hyphens: ${name}` });
  const { repro, lines } = yield* readRepro(file).pipe(step("read repro"));
  const project = yield* Effect.tryPromise({ try: load, catch: (cause) => new ReproFailure({ file, problem: `loading the project: ${describeCause(cause)}` }) });
  const replay = yield* Effect.tryPromise({ try: () => loadReplay(project.replay), catch: (cause) => new ReproFailure({ file, problem: describeCause(cause) }) }).pipe(step("load replay"));
  const results = yield* Effect.try({
    try: () => replayInClients(project.map, replay, repro),
    catch: (cause) => new ReproFailure({ file, problem: `the replay stopped: ${describeCause(cause)}` }),
  }).pipe(step(`replay in ${CLIENTS.length} clients`));
  const report = reproReport(file, repro, results);
  yield* Console.log(report.lines.join("\n"));
  if (!report.landed) return yield* new ReproFailure({ file, problem: "the replay doesn't reproduce the moment" });
  if (name === undefined) return;
  const target = join(project.tests, `${name}.tests.ts`);
  if (existsSync(target)) return yield* new ReproFailure({ file, problem: `${target} already exists` });
  yield* Effect.try({
    try: () => {
      mkdirSync(project.tests, { recursive: true });
      writeFileSync(target, reproTestSource(name, file, repro, importFrom(project.tests, project.replay), lines));
    },
    catch: (cause) => new ReproFailure({ file, problem: `writing ${target}: ${describeCause(cause)}` }),
  });
  yield* Console.log(`wrote ${target}`);
});
