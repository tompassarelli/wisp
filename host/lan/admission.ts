import { join } from "node:path";
import { Effect } from "effect";
import { CapacityAdmission } from "../os/platform/services";

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

/** Why a native start given `waitSeconds` in the capacity helper's queue exited deferred, from what the helper printed. */
export function unadmitted(stderr: string, waitSeconds: number) {
  const deferred = capacityDeferral(stderr);
  if (deferred === undefined) return `the capacity helper refused: ${stderr.trim().split("\n").slice(-2).join(" | ")}`;
  return `the capacity helper kept deferring it for ${waitSeconds} s (${deferred.reason}${deferred.cpuSomeAvg10 === undefined ? "" : `, CPU pressure ${deferred.cpuSomeAvg10}%`})`;
}

export const nativeCommand = (capacity: string, name: string, runtime: string) =>
  CapacityAdmission.use((admission) => admission.session(capacity, `wisp-lan:${name}`, 1.5)).pipe(Effect.map((session) => [...session, "env", `XDG_RUNTIME_DIR=${runtime}`]));
