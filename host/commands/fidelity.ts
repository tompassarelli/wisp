import * as BunServices from "@effect/platform-bun/BunServices";
import { Console, Effect } from "effect";
import { type Command, flagValues, UsageFailure } from "../cli/command";
import { checkFidelity, FidelityFailure } from "../fidelity/check";
import { liveBuild as readLiveBuild } from "../os/warcraft/liveBuild";

const liveBuild = readLiveBuild.pipe(Effect.mapError(failure => new FidelityFailure({ problem: `no live Warcraft III build: ${failure.problem}; pass --live-build BUILD to check offline` })));

export const fidelity: Command = args => Effect.gen(function*() {
  const [action,lever] = args;
  const [reference] = flagValues(args,"reference"), [candidate] = flagValues(args,"candidate"), [flagBuild] = flagValues(args,"live-build");
  if (action !== "check" || lever === undefined || lever.startsWith("--") || reference === undefined || candidate === undefined || (args.includes("--live-build") && flagBuild === undefined)) return yield* new UsageFailure({ problem: "fidelity check LEVER needs --reference DIR and --candidate DIR, and optionally --live-build BUILD" });
  const build = flagBuild ?? (yield* liveBuild);
  const result = yield* checkFidelity(lever,reference,candidate,build).pipe(Effect.provide(BunServices.layer));
  yield* Console.log(JSON.stringify(result, (_key,value) => typeof value === "number" && !Number.isFinite(value) ? String(value) : value));
  if (result.verdict !== "PASS") return yield* new FidelityFailure({ problem: `fidelity ${lever}: ${result.verdict}` });
});
