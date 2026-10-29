import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Duration, Effect, Schema } from "effect";
import { LanFailure } from "./join";
import { pollUntil } from "../cli/hostProcess";
import { holdLock } from "../cli/flockHold";

export interface Slot {
  readonly host: string;
  readonly pair: number;
}

const Lease = Schema.Struct({
  host: Schema.String,
  pair: Schema.Int,
  owner: Schema.String,
  pid: Schema.Int,
  since: Schema.String,
});
export type Lease = typeof Lease.Type;
const decodeLease = Schema.decodeUnknownOption(Schema.fromJsonString(Lease));

/** The hosts a request may take a pair on, in preference order: the pairs each has set up, and whether the host takes work now. */
export interface QueueHost {
  readonly name: string;
  readonly pairs: readonly number[];
  readonly available: boolean;
  readonly clientLimit?: number | undefined;
}

export interface QueueWorld {
  readonly directory: string;
  readonly hosts: readonly QueueHost[];
  readonly alive: (pid: number) => boolean;
  /** Whether something outside the queue holds the pair (a pool started with an explicit `--pair`). */
  readonly held: (slot: Slot) => boolean;
}

const leaseFile = (directory: string, slot: Slot) => join(directory, "leases", `${slot.host}-${slot.pair}.json`);
const ticketsDirectory = (directory: string) => join(directory, "tickets");

const readLease = (path: string) => {
  try { return decodeLease(readFileSync(path, "utf8")); } catch { return { _tag: "None" } as const; }
};

const liveLeases = (world: QueueWorld): readonly Lease[] => {
  const folder = join(world.directory, "leases");
  if (!existsSync(folder)) return [];
  return readdirSync(folder).flatMap((name) => {
    const path = join(folder, name), lease = readLease(path);
    if (lease._tag === "Some" && world.alive(lease.value.pid)) return [lease.value];
    rmSync(path, { force: true });
    return [];
  });
};

/** Ticket files are named by arrival, so the oldest live one is the head of the line. */
const liveTickets = (world: QueueWorld): readonly string[] => {
  const folder = ticketsDirectory(world.directory);
  if (!existsSync(folder)) return [];
  return readdirSync(folder).sort().filter((name) => {
    const pid = Number(name.split("-")[1]);
    if (world.alive(pid)) return true;
    rmSync(join(folder, name), { force: true });
    return false;
  });
};

const pairsInUse = (world: QueueWorld, host: QueueHost, leases: readonly Lease[]) =>
  host.pairs.filter((pair) => leases.some((lease) => lease.host === host.name && lease.pair === pair) || world.held({ host: host.name, pair })).length;

const atLimit = (world: QueueWorld, host: QueueHost, leases: readonly Lease[]) =>
  host.clientLimit !== undefined && (pairsInUse(world, host, leases) + 1) * 2 > host.clientLimit;

/** The first slot that no lease and no outside holder has, on the available host with the fewest pairs in use (listed order breaks ties). */
export const nextFree = (world: QueueWorld, leases: readonly Lease[]): Slot | undefined => {
  const byUse = [...world.hosts].sort((left, right) => pairsInUse(world, left, leases) - pairsInUse(world, right, leases));
  for (const host of byUse) {
    if (!host.available || atLimit(world, host, leases)) continue;
    for (const pair of [...host.pairs].sort((left, right) => left - right)) {
      const slot = { host: host.name, pair };
      if (!leases.some((lease) => lease.host === slot.host && lease.pair === slot.pair) && !world.held(slot)) return slot;
    }
  }
  return undefined;
};

export interface Request {
  readonly owner: string;
  readonly pid: number;
  readonly waitSeconds: number;
}

const attempt = <A>(what: string, run: () => A) => Effect.try({ try: run, catch: (cause) => new LanFailure({ problem: `${what}: ${String(cause)}` }) });

/** Takes the next free pair for the oldest waiting request, waiting in line up to `waitSeconds`; the lease ends with its pid or `releasePair`. */
export const takePair = (world: QueueWorld, request: Request) => Effect.scoped(Effect.gen(function*() {
  const ticket = `${Date.now().toString().padStart(15, "0")}-${request.pid}-${crypto.randomUUID().slice(0, 8)}`;
  const ticketPath = join(ticketsDirectory(world.directory), ticket);
  yield* attempt("join the pair queue", () => {
    mkdirSync(ticketsDirectory(world.directory), { recursive: true });
    mkdirSync(join(world.directory, "leases"), { recursive: true });
    writeFileSync(ticketPath, "");
  });
  const turn = Effect.scoped(Effect.gen(function*() {
    yield* holdLock(join(world.directory, "queue.lock")).pipe(Effect.mapError((cause) => new LanFailure({ problem: cause.message })));
    const [head] = liveTickets(world);
    if (head !== ticket) return undefined;
    const slot = nextFree(world, liveLeases(world));
    if (slot === undefined) return undefined;
    const lease: Lease = { ...slot, owner: request.owner, pid: request.pid, since: new Date().toISOString() };
    yield* attempt("record the lease", () => {
      const path = leaseFile(world.directory, slot);
      writeFileSync(`${path}.next`, `${JSON.stringify(lease)}\n`);
      renameSync(`${path}.next`, path);
      rmSync(ticketPath, { force: true });
    });
    return slot;
  }));
  return yield* pollUntil(turn, {
    until: (slot) => slot !== undefined,
    every: "1 second",
    within: Duration.seconds(request.waitSeconds),
    onTimeout: () => Effect.fail(new LanFailure({ problem: `no free pair within ${request.waitSeconds} s (${world.hosts.map((host) => `${host.name}${host.available ? "" : " unavailable"}: ${host.pairs.length} pairs${host.clientLimit === undefined ? "" : `, ${host.clientLimit} clients`}`).join(", ")})` })),
  }).pipe(Effect.map((slot) => slot as Slot), Effect.ensuring(Effect.sync(() => rmSync(ticketPath, { force: true }))));
}));

export const releasePair = (directory: string, slot: Slot) => Effect.sync(() => rmSync(leaseFile(directory, slot), { force: true }));

export const queueStatus = (world: QueueWorld) => ({
  waiting: liveTickets(world).length,
  leases: liveLeases(world),
  free: world.hosts.flatMap((host) => host.available && !atLimit(world, host, liveLeases(world)) ? host.pairs.filter((pair) => !world.held({ host: host.name, pair })).map((pair) => ({ host: host.name, pair })) : [])
    .filter((slot) => !liveLeases(world).some((lease) => lease.host === slot.host && lease.pair === slot.pair)),
});
