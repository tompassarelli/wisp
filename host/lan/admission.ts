import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Effect } from "effect";
import { CapacityAdmission } from "../contract/services";
import { pollUntil } from "../process/hostProcess";

export const admissionFile = (directory: string) => join(directory, "admission.json");

// The machine-capacity helper exits EX_TEMPFAIL when it defers a run.
const DEFERRED_EXIT = 75;

/** Whether a run under the capacity helper exited because the helper deferred it. */
export const deferredExit = (exitCode: number) => exitCode === DEFERRED_EXIT;

/** The lease the capacity helper reserved, from the RESERVED line it printed. */
export const reservedLease = (stderr: string) => /"decision":"RESERVED".*?"lease":"([0-9a-f-]{36})"/.exec(stderr)?.[1];

/** The DEFER reason, and the CPU pressure it saw, that the capacity helper printed. */
export function capacityDeferral(stderr: string): { readonly reason: string; readonly cpuSomeAvg10?: string } | undefined {
  const deferred = /"decision":"DEFER","reason":"([A-Z_]+)"(?:.*?"cpuSomeAvg10":([\d.]+))?/.exec(stderr);
  if (deferred === null) return undefined;
  const [, reason = "", cpuSomeAvg10] = deferred;
  return cpuSomeAvg10 === undefined ? { reason } : { reason, cpuSomeAvg10 };
}

/** The DEFER reason a native start waiting in the capacity helper's queue printed, from one QUEUED line. */
export const capacityQueued = (line: string) => /"decision":"QUEUED","reason":"([A-Z_]+)"/.exec(line)?.[1];

/** The newest reason the capacity helper printed for keeping a native start in its queue. */
export const lastQueued = (stderr: string) => stderr.split("\n").map(capacityQueued).findLast((reason) => reason !== undefined);

/** Whether the newest decision the capacity helper printed still keeps the start in its queue. */
export const waitingForCapacity = (stderr: string) => [...stderr.matchAll(/"decision":"([A-Z]+)"/g)].at(-1)?.[1] === "QUEUED";

/** Where a pair start stands: a pair fault once its clients have had `readyMs` since its admission or since one of them last waited in the capacity helper's queue, since a GPU slot is the host's capacity and not the pair's; the host's capacity once `boundMs` have passed since its admission. */
export const readiness = (clock: { readonly admittedAt: number; readonly lastWaitAt?: number | undefined; readonly now: number; readonly readyMs: number; readonly boundMs: number }) => {
  if (clock.now - Math.max(clock.admittedAt, clock.lastWaitAt ?? 0) > clock.readyMs) return "pair fault";
  return clock.now - clock.admittedAt > clock.boundMs ? "host capacity" : "waiting";
};

/** Why a native start given `waitSeconds` in the capacity helper's queue exited deferred, from what the helper printed. */
export function unadmitted(stderr: string, waitSeconds: number) {
  const deferred = capacityDeferral(stderr);
  if (deferred === undefined) return `the capacity helper refused: ${stderr.trim().split("\n").slice(-2).join(" | ")}`;
  return `the capacity helper kept deferring it for ${waitSeconds} s (${deferred.reason}${deferred.cpuSomeAvg10 === undefined ? "" : `, CPU pressure ${deferred.cpuSomeAvg10}%`})`;
}

/** How long a pool client's launch waits in the capacity helper's queue: inside the 10 minutes its pair start gives both clients to run. */
const CLIENT_ADMISSION_WAIT_SECONDS = 480;

const readLog = (file: string) => {
  try {
    return readFileSync(file, "utf8");
  } catch {
    return "";
  }
};

/** Waits while a pool client's launch sits in the capacity helper's queue, saying each new reason, until the helper's RESERVED line in `errFile` admits it (true) or the launch exits or outwaits its queue time (false), so the wait for its window starts at its admission. */
export const clientAdmitted = (name: string, errFile: string, isRunning: Effect.Effect<boolean, unknown>, say: (line: string) => void) => {
  let queued: string | undefined;
  return pollUntil(Effect.gen(function*() {
    const said = readLog(errFile);
    if (reservedLease(said) !== undefined) return true;
    const reason = lastQueued(said);
    if (reason !== undefined && reason !== queued) say(`${name}: waiting in the capacity helper's queue (${reason})`);
    queued = reason ?? queued;
    return (yield* isRunning.pipe(Effect.orElseSucceed(() => false))) ? undefined : false;
  }), { until: (state) => state !== undefined, every: "1 second", within: `${CLIENT_ADMISSION_WAIT_SECONDS + 60} seconds`, onTimeout: () => Effect.succeed(false) });
};

export const nativeCommand = (capacity: string, name: string, runtime: string) =>
  CapacityAdmission.use((admission) => admission.session(capacity, `wisp-lan:${name}`, 1.5, CLIENT_ADMISSION_WAIT_SECONDS)).pipe(Effect.map((session) => [...session, "env", `XDG_RUNTIME_DIR=${runtime}`]));
