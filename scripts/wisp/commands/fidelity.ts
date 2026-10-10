import * as BunServices from "@effect/platform-bun/BunServices";
import { Console, Effect } from "effect";
import { type Command, flagValues, UsageFailure } from "../command";
import { checkFidelity, FidelityFailure } from "../fidelity/check";
export const fidelity: Command = args => Effect.gen(function*() {
  const [action,lever] = args;
  const [reference] = flagValues(args,"reference"), [candidate] = flagValues(args,"candidate");
  if (action !== "check" || lever === undefined || lever.startsWith("--") || reference === undefined || candidate === undefined) return yield* new UsageFailure({ problem: "fidelity check LEVER needs --reference DIR and --candidate DIR" });
  const result = yield* checkFidelity(lever,reference,candidate).pipe(Effect.provide(BunServices.layer));
  yield* Console.log(JSON.stringify(result, (_key,value) => typeof value === "number" && !Number.isFinite(value) ? String(value) : value));
  if (result.verdict !== "PASS") return yield* new FidelityFailure({ problem: `fidelity ${lever}: ${result.verdict}` });
});
