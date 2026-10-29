import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Duration, Effect, Schema } from "effect";
import { LanFailure } from "./join";
import { pollUntil } from "../cli/hostProcess";
import { holdLock } from "../cli/flockHold";
import { healthy } from "./pairHealth";

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
  /** The fleet session of whatever outside the queue holds the pair (a pool started with an explicit `--pair`), "" when it names none, undefined when nothing does. */
  readonly holder: (slot: Slot) => string | undefined;
  readonly idleness?: (leases: readonly Lease[]) => Effect.Effect<ReadonlyMap<string, number>>;
  /** The pair's start failures in a row and the last one's problem; a pair with none recorded is healthy. */
  readonly health?: (slot: Slot) => { readonly failures: number; readonly problem?: string | undefined };
}

const IDLE_RELEASE_SECONDS = 300;
const IDLE_CHECK_SECONDS = 15;

export const slotKey = (slot: Slot) => `${slot.host}:${slot.pair}`;

const healthOf = (world: QueueWorld, slot: Slot) => world.health?.(slot) ?? { failures: 0 };

const offered = (world: QueueWorld, slot: Slot) => healthy(healthOf(world, slot));

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

const leased = (leases: readonly Lease[], slot: Slot) => leases.some((lease) => lease.host === slot.host && lease.pair === slot.pair);

const pairsInUse = (world: QueueWorld, host: QueueHost, leases: readonly Lease[]) =>
  host.pairs.filter((pair) => leased(leases, { host: host.name, pair }) || world.holder({ host: host.name, pair }) !== undefined).length;

const atLimit = (world: QueueWorld, host: QueueHost, leases: readonly Lease[]) =>
  host.clientLimit !== undefined && (pairsInUse(world, host, leases) + 1) * 2 > host.clientLimit;

/** The first unleased healthy slot a pool of the requester's own fleet `session` holds, which adds no clients; else the first healthy slot that no lease and no outside holder has, on the available host with the fewest pairs in use (listed order breaks ties). */
export const nextFree = (world: QueueWorld, leases: readonly Lease[], session = ""): Slot | undefined => {
  const byUse = [...world.hosts].filter((host) => host.available).sort((left, right) => pairsInUse(world, left, leases) - pairsInUse(world, right, leases));
  const slots = (hosts: readonly QueueHost[]) => hosts.flatMap((host) => [...host.pairs].sort((left, right) => left - right).map((pair) => ({ host: host.name, pair }))).filter((slot) => offered(world, slot));
  const own = session === "" ? undefined : slots(byUse).find((slot) => !leased(leases, slot) && world.holder(slot) === session);
  return own ?? slots(byUse.filter((host) => !atLimit(world, host, leases))).find((slot) => !leased(leases, slot) && world.holder(slot) === undefined);
};

export const expireIdle = (world: QueueWorld) => Effect.gen(function*() {
  if (world.idleness === undefined) return;
  const leases = liveLeases(world);
  if (leases.length === 0) return;
  const idle = yield* world.idleness(leases);
  const now = Date.now();
  for (const lease of leases) {
    const seconds = Math.min(idle.get(slotKey(lease)) ?? Number.NaN, (now - Date.parse(lease.since)) / 1000);
    if (!(seconds >= IDLE_RELEASE_SECONDS)) continue;
    rmSync(leaseFile(world.directory, lease), { force: true });
    const line = `${new Date(now).toISOString()} released idle lease ${slotKey(lease)} held by ${lease.owner} (pid ${lease.pid}, taken ${lease.since}): no capture activity for ${Math.floor(seconds)} s\n`;
    appendFileSync(join(world.directory, "released.log"), line);
    process.stderr.write(line);
  }
});

export interface Request {
  readonly owner: string;
  readonly pid: number;
  readonly waitSeconds: number;
  /** The requester's fleet session, "" outside one. */
  readonly session: string;
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
  let checkedAt = 0;
  const freeSlot = Effect.gen(function*() {
    const free = nextFree(world, liveLeases(world), request.session);
    if (free !== undefined || Date.now() - checkedAt < IDLE_CHECK_SECONDS * 1000) return free;
    checkedAt = Date.now();
    yield* expireIdle(world);
    return nextFree(world, liveLeases(world), request.session);
  });
  const turn = Effect.scoped(Effect.gen(function*() {
    yield* holdLock(join(world.directory, "queue.lock")).pipe(Effect.mapError((cause) => new LanFailure({ problem: cause.message })));
    const [head] = liveTickets(world);
    if (head !== ticket) return undefined;
    const slot = yield* freeSlot;
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
  free: world.hosts.flatMap((host) => host.available && !atLimit(world, host, liveLeases(world)) ? host.pairs.filter((pair) => world.holder({ host: host.name, pair }) === undefined).map((pair) => ({ host: host.name, pair })) : [])
    .filter((slot) => !leased(liveLeases(world), slot) && offered(world, slot)),
  health: world.hosts.flatMap((host) => host.pairs.map((pair) => {
    const { failures, problem } = healthOf(world, { host: host.name, pair });
    return { host: host.name, pair, healthy: healthy({ failures }), failures, ...(problem === undefined ? {} : { problem }) };
  })),
});
