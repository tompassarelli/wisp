import { mkdirSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { Console, Effect, Option, Schema } from "effect";
import { describeCause } from "../cli/command";
import { pollUntil } from "../cli/hostProcess";
import { type PairClaim, type ProcessMark, claimHolder, markOf, running } from "./claim";
import { LanFailure } from "./join";
import { claimFile, pairDirectory, playtestPairRefusal, readClaim, writeJson } from "./pool";

/** Who asks for a pair: the fleet session, that session's own process (`agent`), and the lane label its claim carries. */
export interface Custodian {
  readonly session: string;
  readonly owner: string;
  readonly agent?: ProcessMark;
}

const parentOf = (pid: number) => {
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
    const parent = Number(stat.slice(stat.lastIndexOf(")") + 2).split(" ")[1]);
    return Number.isInteger(parent) ? parent : undefined;
  } catch {
    return undefined;
  }
};

const carries = (pid: number, variable: string) => {
  try {
    return readFileSync(`/proc/${pid}/environ`, "latin1").split("\0").includes(variable);
  } catch {
    return false;
  }
};

/** The fleet session's own process: the outermost ancestor that carries this process's `NORTH_FLEET_SESSION`, which lives exactly as long as the session. */
export const sessionProcess = (session: string, from = process.pid) => {
  let outermost = from;
  for (let pid = parentOf(from); pid !== undefined && pid > 1 && carries(pid, `NORTH_FLEET_SESSION=${session}`); pid = parentOf(pid)) outermost = pid;
  return markOf(outermost);
};

const SESSION_POLL = "2 seconds";

/** Succeeds once the custodian's session process has exited, and never for a custodian outside a fleet session. */
export const sessionEnded = ({ session, agent }: Custodian) => agent === undefined ? Effect.never : pollUntil(Effect.sync(() => running(agent)), { until: (up) => !up, every: SESSION_POLL }).pipe(
  Effect.andThen(Console.log(`fleet session ${session}'s process ${agent.pid} exited; stopping the pool`)),
);

const lockFile = (pair: number) => join(pairDirectory(pair), "pool.lock");

/** Takes pair K's `pool.lock` for the rest of the scope without waiting; succeeds with whether it was free. */
const takeLock = (pair: number) => Effect.uninterruptible(Effect.gen(function*() {
  const child = yield* Effect.try({
    try: () => Bun.spawn(["flock", "--exclusive", "--nonblock", "--no-fork", lockFile(pair), "sh", "-c", "echo held; exec cat >/dev/null"], { stdin: "pipe", stdout: "pipe", stderr: "pipe" }),
    catch: (cause) => new LanFailure({ problem: `lock pair ${pair}: ${describeCause(cause)}` }),
  });
  const ready = yield* Effect.tryPromise({
    try: () => child.stdout.getReader().read(),
    catch: (cause) => new LanFailure({ problem: `lock pair ${pair}: ${describeCause(cause)}` }),
  }).pipe(Effect.onError(() => Effect.sync(() => child.kill())));
  if (!ready.done) {
    yield* Effect.addFinalizer(() => Effect.promise(async () => {
      child.stdin.end();
      await child.exited;
    }));
    return true;
  }
  const code = yield* Effect.promise(() => child.exited);
  if (code !== 1) return yield* new LanFailure({ problem: `flock pair ${pair} exited ${code}: ${(yield* Effect.promise(() => new Response(child.stderr).text())).trim()}` });
  return false;
}));

const queueDirectory = (pair: number) => join(pairDirectory(pair), "queue");

const TICKET = /^\d{12}\.json$/;

const TicketJson = Schema.fromJsonString(Schema.Struct({ pid: Schema.Int, start: Schema.Int, session: Schema.String }));

const decodeTicket = Schema.decodeUnknownOption(TicketJson);

interface Ticket {
  readonly file: string;
  readonly session: string;
}

/** Pair K's waiters in the order they asked; a ticket whose waiter has exited is removed. */
const waiters = (pair: number): Ticket[] => {
  const directory = queueDirectory(pair);
  const names = (() => {
    try {
      return readdirSync(directory).filter((name) => TICKET.test(name)).sort();
    } catch {
      return [];
    }
  })();
  return names.flatMap((name) => {
    const file = join(directory, name);
    const ticket = Option.getOrUndefined(decodeTicket((() => {
      try {
        return readFileSync(file, "utf8");
      } catch {
        return "";
      }
    })()));
    if (ticket !== undefined && running(ticket)) return [{ file, session: ticket.session }];
    rmSync(file, { force: true });
    return [];
  });
};

/** Draws pair K's next ticket number from a counter only one waiter at a time can advance, so tickets sort in the order they were asked for. */
const nextNumber = (pair: number) => Effect.tryPromise({
  try: async () => {
    const counter = join(queueDirectory(pair), "next");
    const child = Bun.spawn(["flock", `${counter}.lock`, "sh", "-c", 'n=$(( $(cat "$1" 2>/dev/null || echo 0) + 1 )); echo "$n" >"$1"; echo "$n"', "sh", counter], { stdin: "ignore", stdout: "pipe", stderr: "pipe" });
    const [said, code] = await Promise.all([new Response(child.stdout).text(), child.exited]);
    const next = Number(said.trim());
    if (code !== 0 || !Number.isInteger(next) || next < 1) throw new Error(`the ticket counter exited ${code}: ${(await new Response(child.stderr).text()).trim()}`);
    return next;
  },
  catch: (cause) => new LanFailure({ problem: `queue for pair ${pair}: ${describeCause(cause)}` }),
});

const ticketOf = (pair: number, session: string) => Effect.acquireRelease(
  nextNumber(pair).pipe(Effect.flatMap((next) => Effect.try({
    try: () => {
      const file = join(queueDirectory(pair), `${String(next).padStart(12, "0")}.json`);
      writeJson(file, { ...markOf(process.pid), session });
      return file;
    },
    catch: (cause) => new LanFailure({ problem: `queue for pair ${pair}: ${describeCause(cause)}` }),
  }))),
  (file) => Effect.sync(() => rmSync(file, { force: true })),
);

const heldBy = (pair: number) => {
  const claim = readClaim(pair);
  return claim === undefined ? "another wisp lan pool" : claimHolder(claim);
};

const QUEUE_POLL = "1 second";

/** Waits in pair K's line until every earlier waiter has had the pair and its `pool.lock` is free, then takes the lock for the rest of the scope. */
const waitTurn = (pair: number, session: string) => Effect.gen(function*() {
  const ticket = yield* ticketOf(pair, session);
  let said = "";
  const turn = Effect.gen(function*() {
    const place = waiters(pair).findIndex(({ file }) => file === ticket);
    if (place === 0 && (yield* takeLock(pair))) return true;
    const line = `pair ${pair}: waiting in line, ${Math.max(place, 0)} ahead; held by ${heldBy(pair)}`;
    if (line !== said) yield* Console.log(line);
    said = line;
    return false;
  });
  yield* pollUntil(turn, { until: (taken) => taken, every: QUEUE_POLL });
  rmSync(ticket, { force: true });
});

const writeClaim = (pair: number, { session, owner, agent }: Custodian) => Effect.try({
  try: () => {
    const self = markOf(process.pid);
    if (self === undefined) throw new Error("this process has no /proc entry");
    const claim: PairClaim = { pair, owner, session, ...self, ...(agent === undefined ? {} : { agent }) };
    writeJson(claimFile(pair), claim);
  },
  catch: (cause) => new LanFailure({ problem: `claim pair ${pair}: ${describeCause(cause)}` }),
});

const releaseClaim = (pair: number) => Effect.sync(() => {
  if (readClaim(pair)?.pid === process.pid) rmSync(claimFile(pair), { force: true });
});

/** Holds pair K for the rest of the scope: takes its `pool.lock`, in line behind earlier waiters when `queued`, then records this pool in its `claim.json` until it lets go. */
export const holdPair = (pair: number, custodian: Custodian, queued: boolean) => Effect.gen(function*() {
  yield* Effect.try({
    try: () => mkdirSync(queueDirectory(pair), { recursive: true }),
    catch: (cause) => new LanFailure({ problem: `create pair ${pair}: ${describeCause(cause)}` }),
  });
  if (queued) yield* waitTurn(pair, custodian.session);
  else {
    const line = waiters(pair);
    if (line.length > 0) return yield* new LanFailure({ problem: `${line.length} waiting in line for it (first: fleet session ${line[0]?.session || "(none)"}); add --queue to wait behind them` });
    if (!(yield* takeLock(pair))) return yield* new LanFailure({ problem: `it is held by ${heldBy(pair)}; stop that pool first, or add --queue to wait for it` });
  }
  yield* Effect.acquireRelease(writeClaim(pair, custodian), () => releaseClaim(pair));
  const refusal = yield* playtestPairRefusal(pair);
  if (refusal !== undefined) return yield* new LanFailure({ problem: refusal });
});
