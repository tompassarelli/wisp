import * as BunServices from "@effect/platform-bun/BunServices";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { Console, Effect } from "effect";
import { type Command, UsageFailure, describeCause } from "../cli/command";
import { payoff } from "../payoff/payoff";
import { render } from "../payoff/report";
import { nativeRemote } from "./nativeRemote";

const repo = join(import.meta.dir, "../..");

const sinceOf = (text: string | undefined): number | UsageFailure => {
  if (text === undefined) return Number.MIN_SAFE_INTEGER;
  const at = Date.parse(`${text}T00:00:00Z`);
  return /^\d{4}-\d{2}-\d{2}$/.test(text) && Number.isFinite(at) && new Date(at).toISOString().startsWith(text) ? at / 1000 : new UsageFailure({ problem: `--since takes a date YYYY-MM-DD, not ${text}` });
};

/** `native payoff`: native runs' agreement with Wisp, their client minutes and the kinds that could retire to Wisp only (wisp:docs/native-payoff.md). */
const nativePayoff: Command = (args) => Effect.gen(function*() {
  const { values, positionals } = yield* Effect.try({
    try: () => parseArgs({ args: [...args], allowPositionals: true, options: { since: { type: "string" }, evidence: { type: "string", multiple: true }, json: { type: "boolean" } } }),
    catch: (cause) => new UsageFailure({ problem: describeCause(cause) }),
  });
  if (positionals.length !== 1) return yield* new UsageFailure({ problem: "native payoff takes only flags" });
  const since = sinceOf(values.since);
  if (since instanceof UsageFailure) return yield* since;
  const report = yield* payoff({ repo, evidence: values.evidence ?? [], since }).pipe(Effect.provide(BunServices.layer));
  yield* Console.log(values.json === true ? JSON.stringify(report, null, 2) : render(report));
});

export const native: Command = (args) => args[0] === "payoff" ? nativePayoff(args) : nativeRemote(args);
