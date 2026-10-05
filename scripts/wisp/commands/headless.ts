// `wisp headless`: plays one of the game's journeys in simulated clients of
// its map, in this process, and prints a desync, error reports, a hot reload
// that didn't run and what a player would see wrong (wisp:docs/headless.md).
import { Console, Effect, Schema } from "effect";
import type { MapEntry } from "../../../src/headless/client";
import type { Journey } from "../../../src/headless/journey";
import { type Command, UsageFailure, describeCause, flagValues } from "../command";
import { type HeadlessMap, installHeadless, playHeadless } from "../headless";
import type { SceneExpectations } from "../scene";
import { step } from "../timings";

/** What the game supplies: its map, its journeys, and its scene when the entry starts the scene recorder. */
export interface HeadlessProject {
  readonly map: HeadlessMap;
  /**
   * The map entry's TypeScript module, exporting start() and install(). It
   * is loaded when the command runs, so the game's host program never
   * type-checks map code against host globals.
   */
  readonly entry: string;
  /** The first is the default. */
  readonly journeys: Readonly<Record<string, Journey>>;
  readonly scene?: SceneExpectations;
}

export class HeadlessFailure extends Schema.TaggedError<HeadlessFailure>()("HeadlessFailure", {
  journey: Schema.String,
  problems: Schema.Finite,
  cause: Schema.optional(Schema.Unknown),
}) {
  override get message(): string {
    return this.cause === undefined
      ? `${this.journey}: ${this.problems} problem${this.problems === 1 ? "" : "s"}`
      : `${this.journey} stopped: ${describeCause(this.cause)}`;
  }
}

/** The clients the reloader counts: Wisp's per-slot files cover four players. */
const MAX_CLIENTS = 4;

/** The entry module's start() and install(), or why it has none. */
const loadEntry = (path: string) => Effect.tryPromise({
  try: async (): Promise<MapEntry> => {
    const module: unknown = await import(path);
    if (typeof module !== "object" || module === null || !("start" in module) || !("install" in module)) throw new Error(`${path} exports no start() and install()`);
    const { start, install } = module;
    if (typeof start !== "function" || typeof install !== "function") throw new Error(`${path}'s start and install aren't functions`);
    return { start: () => start(), install: () => install() };
  },
  catch: (cause) => new HeadlessFailure({ journey: "loading the map entry", problems: 1, cause }),
});

/** `headless [JOURNEY] [--clients N]`; loads the game's modules only when it runs. */
export const makeHeadless = (load: () => Promise<HeadlessProject>): Command => (args) => Effect.gen(function*() {
  const [clientsText = "2"] = flagValues(args, "clients");
  const named = args.filter((arg, index) => !arg.startsWith("--") && args[index - 1] !== "--clients");
  const count = Number(clientsText);
  if (named.length > 1 || !Number.isInteger(count) || count < 1 || count > MAX_CLIENTS) {
    return yield* new UsageFailure({ problem: `headless takes one journey and 1 to ${MAX_CLIENTS} clients` });
  }
  const project = yield* Effect.tryPromise({ try: load, catch: (cause) => new HeadlessFailure({ journey: "loading the project", problems: 1, cause }) });
  const names = Object.keys(project.journeys);
  const name = named[0] ?? names[0];
  const journey = name === undefined ? undefined : project.journeys[name];
  if (name === undefined || journey === undefined) return yield* new UsageFailure({ problem: `journeys: ${names.join(", ")}` });
  const entry = yield* loadEntry(project.entry).pipe(step("load map"));
  const report = yield* Effect.try({
    try: () => {
      const runtime = installHeadless(project.map);
      try {
        const clients = runtime.clients(entry, Array.from({ length: count }, (_, slot) => slot));
        return playHeadless(clients, journey, project.map.filePrefix, project.scene);
      } finally {
        runtime.restore();
      }
    },
    catch: (cause) => new HeadlessFailure({ journey: name, problems: 1, cause }),
  }).pipe(step(`${name} in ${count} clients`));
  yield* Console.log(report.lines.join("\n"));
  if (report.problems > 0) return yield* new HeadlessFailure({ journey: name, problems: report.problems });
});
