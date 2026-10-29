import { existsSync, readdirSync } from "node:fs";
import { hostname } from "node:os";
import { join } from "node:path";
import { Console, Effect } from "effect";
import { type Command, UsageFailure, flagValues, wholeFlag } from "../cli/command";
import { LanFailure } from "../lan/join";
import { type QueueHost, type QueueWorld, queueStatus, releasePair, takePair } from "../lan/pairQueue";
import { alive, dataRoot, poolHolder, stateRoot } from "../lan/pool";

export const LEASE_USAGE = "lease take --owner NAME [--pid PID] [--wait SECONDS] [--hosts local|any] | lease release --host H --pair K | lease status [--hosts local|any]";

const WAIT_SECONDS = 1800;

/** The pairs `lan setup` made on this host: one `lanKa` client install each. */
const provisionedPairs = (clients = join(dataRoot(), "clients")): readonly number[] =>
  existsSync(clients) ? readdirSync(clients).flatMap((name) => /^lan(\d+)a$/.exec(name)?.[1] ?? []).map(Number) : [];

/** `NAME=K,K` entries of $WISP_PAIR_REMOTE: the pairs set up on another host that this host's workers may lease. */
const remoteHosts = (spec = process.env.WISP_PAIR_REMOTE ?? ""): ReadonlyMap<string, readonly number[]> =>
  new Map(spec.split(";").filter((entry) => entry.includes("=")).map((entry) => {
    const [name = "", pairs = ""] = entry.split("=");
    return [name, pairs.split(",").map(Number).filter(Number.isInteger)] as const;
  }));

const laptopAvailable = () => Effect.promise(async () => {
  const run = Bun.spawn(["north", "laptop", "status"], { stdout: "pipe", stderr: "ignore" });
  return (await new Response(run.stdout).text()).startsWith("laptop: available") && await run.exited === 0;
}).pipe(Effect.orElseSucceed(() => false));

const clientLimit = (command: readonly string[]) => Effect.promise(async () => {
  const run = Bun.spawn([...command], { stdin: "ignore", stdout: "pipe", stderr: "ignore" });
  const limit = Number.parseInt((await new Response(run.stdout).text()).trim(), 10);
  return await run.exited === 0 && Number.isInteger(limit) ? limit : undefined;
}).pipe(Effect.orElseSucceed(() => undefined));

const world = (any: boolean) => Effect.gen(function*() {
  const local: QueueHost = { name: hostname(), pairs: provisionedPairs(), available: true, clientLimit: yield* clientLimit(["north", "capacity", "warcraft-limit"]) };
  const remote = any ? yield* Effect.forEach([...remoteHosts()], ([name, pairs]) => Effect.all([laptopAvailable(), clientLimit(["ssh", "-o", "BatchMode=yes", "-o", "ConnectTimeout=5", "--", name, "north capacity warcraft-limit"])]).pipe(Effect.map(([available, limit]): QueueHost => ({ name, pairs, available, clientLimit: limit })))) : [];
  return {
    directory: join(stateRoot(), "queue"),
    hosts: [local, ...remote],
    alive,
    held: ({ host, pair }) => {
      const holder = poolHolder(pair);
      return host === local.name && holder !== undefined && alive(holder);
    },
  } satisfies QueueWorld;
});

const hostsAny = (args: readonly string[]) => flagValues(args, "hosts")[0] === "any";

export const lease: Command = ([verb, ...args]) => Effect.gen(function*() {
  const state = yield* world(hostsAny(args));
  if (verb === "take") {
    const [owner] = flagValues(args, "owner");
    const pid = wholeFlag(args, "pid", { fallback: process.ppid, min: 1 });
    const wait = wholeFlag(args, "wait", { fallback: WAIT_SECONDS });
    if (owner === undefined) return yield* new UsageFailure({ problem: LEASE_USAGE });
    if (pid instanceof UsageFailure) return yield* pid;
    if (wait instanceof UsageFailure) return yield* wait;
    const slot = yield* takePair(state, { owner, pid, waitSeconds: wait });
    return yield* Console.log(JSON.stringify(slot));
  }
  if (verb === "release") {
    const [host] = flagValues(args, "host");
    const pair = wholeFlag(args, "pair");
    if (host === undefined || pair === undefined || pair instanceof UsageFailure) return yield* new UsageFailure({ problem: LEASE_USAGE });
    return yield* releasePair(state.directory, { host, pair });
  }
  if (verb === "status") return yield* Console.log(JSON.stringify(queueStatus(state)));
  return yield* new LanFailure({ problem: `lan takes ${LEASE_USAGE}` });
});
