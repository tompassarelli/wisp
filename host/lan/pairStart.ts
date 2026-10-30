import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { Console, Duration, Effect, Option, Schema } from "effect";
import { pollUntil } from "../cli/hostProcess";
import { admissionFile, readiness, waitingForCapacity } from "./admission";
import { LanFailure } from "./join";
import { installMenuPage } from "./menus";
import { recordFailure } from "./pairHealth";
import { agentFile, agentPidFile, agentSocket, clientLog, clientName, missingClients, pairDirectory, pairSides, reportPort, retailOf, stopPairScopes } from "./pool";

export const AgentStatus = Schema.Struct({ clients: Schema.Array(Schema.Struct({ name: Schema.String, pid: Schema.optional(Schema.Int) })) });
const decodeRefusal = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Struct({ reason: Schema.String })));

const clientsReady = (pair: number, network: boolean) => Effect.tryPromise({
  try: () => fetch("http://pair/status", { unix: agentSocket(pair) }).then((response) => response.json()),
  catch: () => undefined,
}).pipe(
  Effect.flatMap(Schema.decodeUnknownEffect(AgentStatus)),
  Effect.map((status) => status.clients.length === pairSides(network).length && status.clients.every(({ pid }) => pid !== undefined)),
  Effect.orElseSucceed(() => false),
);

const READY = "10 minutes";

export const outlivedStop = (name: string, lease: string) => Console.log(`${name} outlived its stop (lease ${lease}); killing its scope`);

/** Fails a pair start with `problem`, counted against the pair's health since it is the pair's own fault rather than the host's capacity. */
export const pairFault = (pair: number, problem: string) => Effect.sync(() => recordFailure(pair, problem)).pipe(Effect.andThen(Effect.fail(new LanFailure({ problem }))));

const waitingClient = (pair: number, network: boolean) => pairSides(network).some((side) => {
  const file = clientLog(pair, clientName(pair, side));
  return existsSync(file) && waitingForCapacity(readFileSync(file, "utf8"));
});

/** Waits for both clients of admitted pair K to run, giving them READY after the admission or after either last waited for a GPU slot, and at most `waitSeconds` more for those slots. */
export const clientsRunning = <E, R>(pair: number, network: boolean, waitSeconds: number, ended: Effect.Effect<void, E, R>) => Effect.suspend(() => {
  const directory = pairDirectory(pair);
  const admittedAt = Date.now();
  let lastWaitAt: number | undefined;
  const step = Effect.gen(function*() {
    if (existsSync(admissionFile(directory))) return yield* new LanFailure({ problem: `the capacity helper deferred a game inside it (${Option.match(decodeRefusal(readFileSync(admissionFile(directory), "utf8")), { onNone: () => "no reason given", onSome: ({ reason }) => reason })})` });
    yield* ended;
    if (yield* clientsReady(pair, network)) return true;
    const now = Date.now();
    if (waitingClient(pair, network)) lastWaitAt = now;
    const verdict = readiness({ admittedAt, lastWaitAt, now, readyMs: Duration.toMillis(READY), boundMs: waitSeconds * 1000 + Duration.toMillis(READY) });
    if (verdict === "pair fault") return yield* pairFault(pair, `its clients weren't both running within ${READY} of its admission or their last wait for a GPU slot; see ${directory}`);
    if (verdict === "host capacity") return yield* new LanFailure({ problem: `its clients were still waiting for GPU slots ${waitSeconds} s past their ${READY} to run; see ${directory}` });
    return false;
  });
  return pollUntil(step, { until: (ready) => ready, every: "1 second" });
});

/** Clears what pair K's last start left, refuses a pair with a client not set up, and points each client's menu page back at the pair's report port, which a playtest on the same prefix rewrites, before the pair asks for capacity. */
export const clearLastStart = (pair: number, network: boolean) => Effect.gen(function*() {
  const directory = pairDirectory(pair);
  mkdirSync(directory, { recursive: true });
  rmSync(agentSocket(pair), { force: true });
  rmSync(agentFile(pair), { force: true });
  rmSync(agentPidFile(pair), { force: true });
  const outlived = yield* stopPairScopes(pair, outlivedStop);
  if (outlived.length > 0) return yield* new LanFailure({ problem: `${outlived.join(" and ")} from its last start outlived the stop of ${outlived.length === 1 ? "its" : "their"} capacity scope` });
  rmSync(admissionFile(directory), { force: true });
  rmSync(join(directory, "session.err"), { force: true });
  for (const side of pairSides(network)) rmSync(clientLog(pair, clientName(pair, side)), { force: true });
  const missing = missingClients(pair, network);
  if (missing.length > 0) return yield* pairFault(pair, `${missing.join(" and ")} ${missing.length === 1 ? "has" : "have"} no Warcraft III install; wisp lan setup --pair ${pair} --from INSTALL rebuilds ${missing.length === 1 ? "it" : "them"}`);
  for (const side of pairSides(network)) yield* installMenuPage(retailOf(clientName(pair, side)), reportPort(pair, side)).pipe(Effect.mapError((failure) => new LanFailure({ problem: `${clientName(pair, side)}: ${failure.operation}: ${failure.problem}` })));
});

