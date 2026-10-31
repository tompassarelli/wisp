import { readFileSync } from "node:fs";
import { Effect, Schema } from "effect";
import { UsageFailure, describeCause, wholeFlag } from "../cli/command";
import { LanFailure } from "../lan/join";
import { agentSocket } from "../lan/pool";

export const number = (args: readonly string[], name: string, fallback: number | undefined) => Effect.suspend(() => {
  const value = wholeFlag(args, name, fallback === undefined ? {} : { fallback });
  return value instanceof UsageFailure ? Effect.fail(value) : value === undefined ? Effect.fail(new UsageFailure({ problem: `--${name} is required` })) : Effect.succeed(value);
});

export const agent = (pair: number, path: string, body?: unknown) => Effect.tryPromise({
  try: async () => {
    const response = await fetch(`http://pair${path}`, { unix: agentSocket(pair), method: body === undefined ? "GET" : "POST", ...(body === undefined ? {} : { body: JSON.stringify(body), headers: { "content-type": "application/json" } }) });
    const value = (await response.json()) as Record<string, unknown>;
    if (!response.ok) throw new Error(String(value["error"] ?? response.status));
    return value;
  },
  catch: (cause) => new LanFailure({ problem: `pair ${pair}'s agent (${agentSocket(pair)}): ${describeCause(cause)}` }),
});

export const AgentProcess = Schema.fromJsonString(Schema.Struct({ pid: Schema.Int, network: Schema.optionalKey(Schema.Boolean), runs: Schema.Struct({ a: Schema.String }) }));

export const readJson = <A>(file: string, schema: Schema.Decoder<A>) => Effect.try({
  try: () => readFileSync(file, "utf8"),
  catch: (cause) => new LanFailure({ problem: `read ${file}: ${describeCause(cause)}` }),
}).pipe(
  Effect.flatMap(Schema.decodeUnknownEffect(schema)),
  Effect.mapError((failure) => (failure instanceof LanFailure ? failure : new LanFailure({ problem: `${file}: ${failure.message}` }))),
);
