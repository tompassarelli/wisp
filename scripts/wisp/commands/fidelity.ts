import * as BunServices from "@effect/platform-bun/BunServices";
import { Console, Effect } from "effect";
import { type Command, flagValues, UsageFailure } from "../command";
import { checkFidelity, FidelityFailure } from "../fidelity/check";

/** Blizzard's patch CDN lists each region's current build of a product; Warcraft III is `w3`. */
const VERSIONS_URL = "http://us.patch.battle.net:1119/w3/versions";

/** The us row's `VersionsName` (such as `3.0.0.24268`) from a CDN `versions` file, or undefined. */
export function liveBuildFrom(text: string): string | undefined {
  const lines = text.split(/\r?\n/).filter(line => line.trim() !== "" && !line.startsWith("##"));
  const columns = (lines[0] ?? "").split("|").map(column => column.split("!")[0]);
  const region = columns.indexOf("Region"), name = columns.indexOf("VersionsName");
  if (region < 0 || name < 0) return undefined;
  const build = lines.slice(1).map(line => line.split("|")).find(row => row[region] === "us")?.[name];
  return build !== undefined && /^\d+(\.\d+)+$/.test(build) ? build : undefined;
}

const unread = (problem: string) => new FidelityFailure({ problem: `no live Warcraft III build: ${problem}; pass --live-build BUILD to check offline` });

const liveBuild = Effect.tryPromise({ try: () => fetch(VERSIONS_URL).then(response => response.ok ? response.text() : Promise.reject(new Error(`HTTP ${response.status}`))), catch: cause => unread(`${VERSIONS_URL}: ${String(cause)}`) }).pipe(
  Effect.timeoutOrElse({ duration: "10 seconds", orElse: () => Effect.fail(unread(`${VERSIONS_URL} didn't answer within 10 s`)) }),
  Effect.flatMap(text => {
    const build = liveBuildFrom(text);
    return build === undefined ? Effect.fail(unread(`${VERSIONS_URL} has no us row with a build`)) : Effect.succeed(build);
  }),
);

export const fidelity: Command = args => Effect.gen(function*() {
  const [action,lever] = args;
  const [reference] = flagValues(args,"reference"), [candidate] = flagValues(args,"candidate"), [flagBuild] = flagValues(args,"live-build");
  if (action !== "check" || lever === undefined || lever.startsWith("--") || reference === undefined || candidate === undefined || (args.includes("--live-build") && flagBuild === undefined)) return yield* new UsageFailure({ problem: "fidelity check LEVER needs --reference DIR and --candidate DIR, and optionally --live-build BUILD" });
  const build = flagBuild ?? (yield* liveBuild);
  const result = yield* checkFidelity(lever,reference,candidate,build).pipe(Effect.provide(BunServices.layer));
  yield* Console.log(JSON.stringify(result, (_key,value) => typeof value === "number" && !Number.isFinite(value) ? String(value) : value));
  if (result.verdict !== "PASS") return yield* new FidelityFailure({ problem: `fidelity ${lever}: ${result.verdict}` });
});
