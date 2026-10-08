// `wisp farm test [--ref REF] [--wait]`: a project's full suites on GitHub's
// free hosted runners (wisp:docs/farm.md). A game adds its own farm jobs
// beside `test` and dispatches `test` here.
import { parseArgs } from "node:util";
import { Effect } from "effect";
import { type Command, UsageFailure, describeCause } from "../command";
import { farmTest } from "../farm";

export const farm: Command = (args) => Effect.gen(function*() {
  const { values, positionals } = yield* Effect.try({
    try: () => parseArgs({ args: [...args], allowPositionals: true, options: { ref: { type: "string" }, wait: { type: "boolean" } } }),
    catch: (cause) => new UsageFailure({ problem: describeCause(cause) }),
  });
  switch (positionals[0]) {
    case "test":
      return yield* farmTest({ ref: values.ref, wait: values.wait === true });
    default:
      return yield* new UsageFailure({ problem: "farm test" });
  }
});
