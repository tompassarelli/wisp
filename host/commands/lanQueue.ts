import { existsSync, readdirSync } from "node:fs";
import { hostname } from "node:os";
import { join } from "node:path";
import { Console, Effect, Option, Schema } from "effect";
import { type Command, UsageFailure, flagValues, wholeFlag } from "../cli/command";
import { LanFailure } from "../lan/join";
import { type Lease, type QueueHost, type QueueWorld, expireIdle, queueStatus, releasePair, slotKey, takePair } from "../lan/pairQueue";
import { orphaned } from "../lan/claim";
import { readHealth } from "../lan/pairHealth";
import { agentSocket, alive, dataRoot, installOf, missingClients, readClaim, stateRoot } from "../lan/pool";
import { lanPoolSupported } from "../os/warcraft/builds";
import { buildOf } from "../os/warcraft/sharedStorage";

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

export const PEER_STATE_SCRIPT = "state=\"${XDG_STATE_HOME:-$HOME/.local/state}/wisp/lan\"; data=\"${XDG_DATA_HOME:-$HOME/.local/share}/wisp/lan\"; me=$(hostname)\nlive() { kill -0 \"$1\" 2>/dev/null; }\nnum() { sed -n \"s/.*\\\"$1\\\": *\\([0-9]*\\).*/\\1/p\" \"$2\" | head -n 1; }\nstr() { sed -n \"s/.*\\\"$1\\\": *\\\"\\([^\\\"]*\\)\\\".*/\\1/p\" \"$2\" | head -n 1; }\nfor f in \"$state\"/queue/leases/\"$me\"-*.json; do [ -f \"$f\" ] || continue; live \"$(num pid \"$f\")\" && echo \"busy $(num pair \"$f\")\"; done\nfor f in \"$state\"/pair-*/claim.json; do [ -f \"$f\" ] || continue; pair=$(basename \"$(dirname \"$f\")\"); live \"$(num pid \"$f\")\" && echo \"busy ${pair#pair-} $(str session \"$f\")\"; done\nfor f in \"$state\"/pair-*/health.json; do [ -f \"$f\" ] || continue; pair=$(basename \"$(dirname \"$f\")\"); echo \"health ${pair#pair-} $(num failures \"$f\")\"; done\nfor d in \"$data\"/clients/lan*a/pfx/drive_c/\"Program Files (x86)\"/\"Warcraft III\"; do [ -f \"$d/.build.info\" ] || continue; k=${d#*/clients/lan}; k=${k%%a/*}\n  echo \"build $k $(awk -F'|' 'NR==1{for(i=1;i<=NF;i++){split($i,a,\"!\"); if(a[1]==\"Version\")v=i; if(a[1]==\"Active\")c=i}} NR>1 && $c==1 && !done {print $v; done=1}' \"$d/.build.info\")\"; done\ntrue";

export interface PeerState {
  /** Each busy pair's holder session: a pool claim's fleet session, "" for the peer's own lease or a claim that names none. */
  readonly busy: ReadonlyMap<number, string>;
  readonly builds: ReadonlyMap<number, string>;
  /** Each recorded pair's start failures in a row. */
  readonly failures: ReadonlyMap<number, number>;
}

export const parsePeerState = (output: string): PeerState => {
  const rows = output.split("\n").map((line) => line.trim().split(/\s+/));
  const busy = new Map<number, string>();
  for (const [kind, pair, session = ""] of rows) if (kind === "busy" && Number.isInteger(Number(pair)) && busy.get(Number(pair)) !== "") busy.set(Number(pair), session);
  return {
    busy,
    builds: new Map(rows.flatMap(([kind, pair, version]) => (kind === "build" && Number.isInteger(Number(pair)) && version !== undefined ? [[Number(pair), version] as const] : []))),
    failures: new Map(rows.flatMap(([kind, pair, count]) => (kind === "health" && Number.isInteger(Number(pair)) && Number.isInteger(Number.parseInt(count ?? "", 10)) ? [[Number(pair), Number.parseInt(count ?? "", 10)] as const] : []))),
  };
};

export const poolablePairs = (pairs: readonly number[], builds: ReadonlyMap<number, string>) =>
  pairs.filter((pair) => {
    const version = builds.get(pair);
    return version !== undefined && lanPoolSupported(version);
  });

const peerState = (name: string) => Effect.promise(async () => {
  const run = Bun.spawn(["ssh", "-o", "BatchMode=yes", "-o", "ConnectTimeout=5", "--", name, PEER_STATE_SCRIPT], { stdin: "ignore", stdout: "pipe", stderr: "ignore" });
  const output = await new Response(run.stdout).text();
  return await run.exited === 0 ? parsePeerState(output) : undefined;
}).pipe(Effect.orElseSucceed(() => undefined));

const localPoolable = (pair: number) => {
  if (missingClients(pair).length > 0) return false;
  try {
    const version = buildOf(installOf(`lan${pair}a`));
    return version !== undefined && lanPoolSupported(version);
  } catch {
    return false;
  }
};

const IDLE_PAIRS_SCRIPT = "state=\"${XDG_STATE_HOME:-$HOME/.local/state}/wisp/lan\"\nfor dir in \"$state\"/pair-*; do\n  [ -d \"$dir\" ] || continue\n  if [ -S \"$dir/agent.sock\" ]; then printf '%s\\t' \"${dir##*pair-}\"; curl -s --max-time 3 --unix-socket \"$dir/agent.sock\" http://pair/status | tr -d '\\n'; echo\n  else printf '%s\\tnone\\n' \"${dir##*pair-}\"; fi\ndone\ntrue";

const PairState = Schema.Struct({ idleSeconds: Schema.Finite });
const decodePairState = Schema.decodeUnknownOption(Schema.fromJsonString(PairState));

export const parseIdle = (output: string): ReadonlyMap<number, number> => new Map(output.split("\n").flatMap((line) => {
  const [pair, status = ""] = line.split("\t");
  const number = Number.parseInt(pair ?? "", 10);
  if (!Number.isInteger(number)) return [];
  if (status === "none") return [[number, Number.POSITIVE_INFINITY] as const];
  const state = decodePairState(status);
  return Option.isSome(state) ? [[number, state.value.idleSeconds] as const] : [];
}));

const localIdle = (pair: number) => Effect.promise(async () => {
  if (!existsSync(agentSocket(pair))) return Number.POSITIVE_INFINITY;
  const state = decodePairState(await (await fetch("http://pair/status", { unix: agentSocket(pair), signal: AbortSignal.timeout(3000) })).text());
  return Option.isSome(state) ? state.value.idleSeconds : undefined;
}).pipe(Effect.orElseSucceed(() => undefined));

const remoteIdle = (name: string) => Effect.promise(async () => {
  const run = Bun.spawn(["ssh", "-o", "BatchMode=yes", "-o", "ConnectTimeout=5", "--", name, IDLE_PAIRS_SCRIPT], { stdin: "ignore", stdout: "pipe", stderr: "ignore" });
  const output = await new Response(run.stdout).text();
  return await run.exited === 0 ? parseIdle(output) : undefined;
}).pipe(Effect.orElseSucceed(() => undefined));

const idleness = (local: string) => (leases: readonly Lease[]) => Effect.gen(function*() {
  const entries = yield* Effect.forEach(leases, (lease) => lease.host === local
    ? localIdle(lease.pair).pipe(Effect.map((seconds) => [slotKey(lease), seconds] as const))
    : remoteIdle(lease.host).pipe(Effect.map((pairs) => [slotKey(lease), pairs?.get(lease.pair) ?? (pairs === undefined ? undefined : Number.POSITIVE_INFINITY)] as const)), { concurrency: "unbounded" });
  return new Map(entries.flatMap(([key, seconds]) => seconds === undefined ? [] : [[key, seconds] as const]));
});

const leaseQueue = () => join(stateRoot(), "queue");

/** The fleet session of the live pool holding this host's pair K; a pool whose custodian has exited holds it for nobody. */
export const localHolder = (pair: number) => {
  const claim = readClaim(pair);
  return claim !== undefined && alive(claim.pid) && !orphaned(claim) ? claim.session : undefined;
};

const world = (any: boolean) => Effect.gen(function*() {
  const local: QueueHost = { name: hostname(), pairs: provisionedPairs().filter(localPoolable), available: true, clientLimit: yield* clientLimit(["north", "capacity", "warcraft-limit"]) };
  const remote = any ? yield* Effect.forEach([...remoteHosts()], ([name, pairs]) => Effect.all([laptopAvailable(), clientLimit(["ssh", "-o", "BatchMode=yes", "-o", "ConnectTimeout=5", "--", name, "north capacity warcraft-limit"])]).pipe(Effect.flatMap(([available, limit]) => peerState(name).pipe(Effect.map((state) => ({ busy: state?.busy, failures: state?.failures, host: { name, pairs: state === undefined ? pairs : poolablePairs(pairs, state.builds), available: available && state !== undefined, clientLimit: limit } satisfies QueueHost })))))) : [];
  const busyThere = new Map(remote.map(({ busy, host }) => [host.name, busy ?? new Map<number, string>()]));
  const failuresThere = new Map(remote.map(({ failures, host }) => [host.name, failures ?? new Map<number, number>()]));
  return {
    directory: leaseQueue(),
    hosts: [local, ...remote.map(({ host }) => host)],
    alive,
    idleness: idleness(local.name),
    holder: ({ host, pair }) => {
      return host === local.name ? localHolder(pair) : busyThere.get(host)?.get(pair);
    },
    health: ({ host, pair }) => host === local.name ? readHealth(pair) : { failures: failuresThere.get(host)?.get(pair) ?? 0 },
  } satisfies QueueWorld;
});

/** Frees this host's leases on `pairs`, so the queue offers them again once their pool has let them go. */
export const releaseLocalLeases = (pairs: readonly number[]) => Effect.forEach(pairs, (pair) => releasePair(leaseQueue(), { host: hostname(), pair }), { discard: true });

/** Stops the pool still holding pair K after its custodian exited, so the pool the new lease starts gets the pair's lock. */
const reclaimOrphan = (pair: number) => Effect.suspend(() => {
  const claim = readClaim(pair);
  if (claim === undefined || !alive(claim.pid) || !orphaned(claim)) return Effect.void;
  return Console.error(`pair ${pair}: stopping ${claim.owner}'s pool ${claim.pid}, whose custodian ${claim.agent?.pid} has exited`).pipe(
    Effect.andThen(Effect.sync(() => { try { process.kill(claim.pid, "SIGTERM"); } catch { return; } })),
  );
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
    const slot = yield* takePair(state, { owner, pid, waitSeconds: wait, session: process.env["NORTH_FLEET_SESSION"] ?? "" });
    if (slot.host === hostname()) yield* reclaimOrphan(slot.pair);
    return yield* Console.log(JSON.stringify(slot));
  }
  if (verb === "release") {
    const [host] = flagValues(args, "host");
    const pair = wholeFlag(args, "pair");
    if (host === undefined || pair === undefined || pair instanceof UsageFailure) return yield* new UsageFailure({ problem: LEASE_USAGE });
    return yield* releasePair(state.directory, { host, pair });
  }
  if (verb === "status") {
    yield* expireIdle(state);
    return yield* Console.log(JSON.stringify(queueStatus(state)));
  }
  return yield* new LanFailure({ problem: `lan takes ${LEASE_USAGE}` });
});
