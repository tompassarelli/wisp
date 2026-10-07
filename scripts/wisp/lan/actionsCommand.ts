// `wisp engine actions --client a,b [--map MAP] [--follow]`: what Warcraft's
// network layer delivered to a pool pair, per turn (wisp:docs/engine.md,
// "Actions"). The pair's LAN host relays every turn, so its action log holds
// each player's actions decoded (orders, BlzSendSyncData payloads with their
// prefixes, frame and key events, chat), joins, loads, leaves and every
// desync by turn. With --map it first starts MAP on the pair (wisp lan fresh).
// Only clients the pool declares (its clients file) are accepted: offline
// development clients, never a signed-in Battle.net client.
import { existsSync, readFileSync, statSync } from "node:fs";
import { Console, Effect } from "effect";
import { type Command, UsageFailure, flagValues } from "../command";
import { LanFailure } from "./join";
import { agentSocket, pairOf, poolClientsFile, readPool } from "./pool";

const agent = (pair: number, path: string, body?: unknown) => Effect.tryPromise({
  try: async () => {
    const response = await fetch(`http://pair${path}`, { unix: agentSocket(pair), method: body === undefined ? "GET" : "POST", ...(body === undefined ? {} : { body: JSON.stringify(body), headers: { "content-type": "application/json" } }) });
    const value = (await response.json()) as Record<string, unknown>;
    if (!response.ok) throw new Error(String(value["error"] ?? response.status));
    return value;
  },
  catch: (cause) => new LanFailure({ problem: `pair ${pair}'s agent: ${cause instanceof Error ? cause.message : String(cause)}` }),
});

export const actions: Command = (args) => Effect.gen(function*() {
  const names = flagValues(args, "client").flatMap((value) => value.split(",")).filter((name) => name !== "");
  if (names.length === 0) return yield* new UsageFailure({ problem: "name the pool clients with --client lan0a,lan0b" });
  const pool = readPool();
  if (pool === undefined) return yield* new LanFailure({ problem: `no LAN pool is running; start one with wisp lan pool (actions come from its host; online clients are never touched)` });
  const pair = pairOf(pool, names);
  if (pair === undefined) return yield* new LanFailure({ problem: `${names.join(", ")} aren't one pair of ${poolClientsFile()}; only the pool's offline clients have an action log` });
  const [map] = flagValues(args, "map");
  if (map !== undefined) yield* agent(pair.id, "/fresh", { map });
  const status = yield* agent(pair.id, "/status");
  const game = status["game"] as { log?: string; phase?: string } | undefined;
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
  while (true) {
    yield* Effect.sleep("250 millis");
    if (statSync(log).size !== size) {
      size = statSync(log).size;
      print();
    }
    const now = yield* agent(pair.id, "/status").pipe(Effect.orElseSucceed(() => ({ game: undefined }) as Record<string, unknown>));
    const current = now["game"] as { log?: string; phase?: string } | undefined;
    if (current?.log !== log || current.phase === "over") {
      print();
      return;
    }
  }
});
