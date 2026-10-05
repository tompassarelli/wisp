// `wisp headless`: plays one of the game's journeys in simulated clients of
// its map, in this process, and prints a desync, error reports, a hot reload
// that didn't run and what a player would see wrong (wisp:docs/headless.md).
import { Console, Effect, Schema } from "effect";
import { type Command, UsageFailure, describeCause, flagValues } from "../command";
import { type HeadlessProject, installHeadless, loadMapEntry, playHeadless } from "../headless";
import { step } from "../timings";

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
export const MAX_CLIENTS = 4;

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
  const entry = yield* Effect.tryPromise({
    try: () => loadMapEntry(project.entry),
    catch: (cause) => new HeadlessFailure({ journey: "loading the map entry", problems: 1, cause }),
  }).pipe(step("load map"));
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
