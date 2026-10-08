// `wisp engine actions --client a,b [--map MAP] [--follow]`: what Warcraft's
// network layer delivered to a pool pair, per turn (wisp:docs/engine.md,
// "Actions"). The pair's LAN host relays every turn, so its action log holds
// each player's actions decoded (orders, BlzSendSyncData payloads with their
// prefixes, frame and key events, chat), joins, loads, leaves and every
// desync by turn. With --map it first starts MAP on the pair (wisp lan fresh).
// Only clients the pool declares (its clients file) are accepted: offline
// development clients, never a signed-in Battle.net client.
import { existsSync, readFileSync, statSync } from "node:fs";
import { Console, Effect, Option, Schedule, Schema } from "effect";
import { type Command, UsageFailure, flagValues } from "../command";
import { LanFailure } from "./join";
import { agentSocket, pairOf, poolClientsFile, readPool } from "./pool";

const Reply = Schema.fromJsonString(Schema.Unknown);
const ErrorReply = Schema.Struct({ error: Schema.optionalKey(Schema.Unknown) });
const AgentStatus = Schema.Struct({ game: Schema.optionalKey(Schema.Struct({ log: Schema.optionalKey(Schema.String), phase: Schema.optionalKey(Schema.String) })) });

const agent = (pair: number, path: string, body?: unknown) => Effect.gen(function*() {
  const failed = (cause: unknown) => new LanFailure({ problem: `pair ${pair}'s agent: ${cause instanceof Error ? cause.message : String(cause)}` });
  const response = yield* Effect.tryPromise({ catch: failed, try: () => fetch(`http://pair${path}`, { unix: agentSocket(pair), method: body === undefined ? "GET" : "POST", ...(body === undefined ? {} : { body: JSON.stringify(body), headers: { "content-type": "application/json" } }) }) });
  const value = yield* Effect.tryPromise({ try: () => response.text(), catch: failed }).pipe(Effect.flatMap(Schema.decodeUnknownEffect(Reply)), Effect.mapError((cause) => (cause instanceof LanFailure ? cause : failed(cause))));
  if (!response.ok) {
    const error = Schema.decodeUnknownOption(ErrorReply)(value).pipe(Option.flatMap(({ error }) => Option.fromUndefinedOr(error)));
    return yield* new LanFailure({ problem: `pair ${pair}'s agent: ${String(Option.getOrElse(error, () => response.status))}` });
  }
  return value;
});

/** The pair's game, from its agent; a silent agent is a failure after 3 s. */
const currentGame = (pair: number) => agent(pair, "/status").pipe(
  Effect.timeoutOrElse({ duration: "3 seconds", orElse: () => Effect.fail(new LanFailure({ problem: `pair ${pair}'s agent didn't answer within 3 s` })) }),
  Effect.flatMap(Schema.decodeUnknownEffect(AgentStatus)),
  Effect.mapError((failure) => (failure instanceof LanFailure ? failure : new LanFailure({ problem: `pair ${pair}'s agent status: ${failure.message}` }))),
  Effect.map(({ game }) => game),
);

export const actions: Command = (args) => Effect.gen(function*() {
  const names = flagValues(args, "client").flatMap((value) => value.split(",")).filter((name) => name !== "");
  if (names.length === 0) return yield* new UsageFailure({ problem: "name the pool clients with --client lan0a,lan0b" });
  const pool = yield* readPool;
  if (pool === undefined) return yield* new LanFailure({ problem: `no LAN pool is running; start one with wisp lan pool (actions come from its host; online clients are never touched)` });
  const pair = pairOf(pool, names);
  if (pair === undefined) return yield* new LanFailure({ problem: `${names.join(", ")} aren't one pair of ${poolClientsFile()}; only the pool's offline clients have an action log` });
  const [map] = flagValues(args, "map");
  if (map !== undefined) yield* agent(pair.id, "/fresh", { map });
  const game = yield* currentGame(pair.id);
  if (game?.log === undefined || !existsSync(game.log)) return yield* new LanFailure({ problem: `pair ${pair.id} has no game; start one with --map MAP or wisp lan fresh MAP --pair ${pair.id}` });
  const log = game.log;
  yield* Console.log(`# ${log}`);
  let printed = 0;
  const print = () => {
    const text = readFileSync(log, "utf8");
    if (text.length > printed) process.stdout.write(text.slice(printed));
    printed = text.length;
  };
  print();
  if (!args.includes("--follow")) return;
  let size = statSync(log).size;
  // Following ends when the game ends, another starts, or the agent stops answering.
  const ended = Effect.gen(function*() {
    if (statSync(log).size !== size) {
      size = statSync(log).size;
      print();
    }
    const current = yield* currentGame(pair.id).pipe(Effect.orElseSucceed(() => undefined));
    return current?.log !== log || current.phase === "over";
  });
  yield* Effect.sleep("250 millis");
  yield* ended.pipe(Effect.repeat({ schedule: Schedule.spaced("250 millis"), until: (done) => done }));
  print();
});
