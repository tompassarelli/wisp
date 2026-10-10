import { join } from "node:path";
import { Console, Effect, Schedule, Schema } from "effect";
import { CapacityAdmission } from "../../platform/services";
import { LanFailure } from "./join";

export const admissionFile = (directory: string) => join(directory, "admission.json");

// The machine-capacity helper exits EX_TEMPFAIL when it defers a run.
const DEFERRED_EXIT = 75;

/** Whether a run under the capacity helper exited because the helper deferred it. */
export const deferredExit = (exitCode: number) => exitCode === DEFERRED_EXIT;

/** The DEFER reason, and the CPU pressure it saw, that the capacity helper printed. */
export function capacityDeferral(stderr: string): { readonly reason: string; readonly cpuSomeAvg10?: string } | undefined {
  const deferred = /"decision":"DEFER","reason":"([A-Z_]+)"(?:.*?"cpuSomeAvg10":([\d.]+))?/.exec(stderr);
  if (deferred === null) return undefined;
  const [, reason = "", cpuSomeAvg10] = deferred;
  return cpuSomeAvg10 === undefined ? { reason } : { reason, cpuSomeAvg10 };
}

export class CapacityDeferred extends Schema.TaggedError<CapacityDeferred>()("CapacityDeferred", { reason: Schema.String }) {}

/** Runs `attempt` again every 45 s while it fails with `CapacityDeferred`, for up to `seconds`; then fails with `exhausted`. */
export const retryWhileDeferred = <A, E, R, E2>(
  attempt: Effect.Effect<A, E | CapacityDeferred, R>,
  { seconds, waiting, exhausted }: { readonly seconds: number; readonly waiting: (reason: string) => string; readonly exhausted: (reason: string) => E2 },
): Effect.Effect<A, Exclude<E, CapacityDeferred> | E2, R> => {
  const deadline = Date.now() + seconds * 1000;
  const retrying = (failure: E | CapacityDeferred): failure is CapacityDeferred => failure instanceof CapacityDeferred && Date.now() < deadline;
  return attempt.pipe(
    Effect.tapError((failure) => (retrying(failure) ? Console.log(`${waiting(failure.reason)}; trying again in 45 s`) : Effect.void)),
    Effect.retry({ schedule: Schedule.spaced("45 seconds"), while: retrying }),
    Effect.catchIf((failure): failure is CapacityDeferred => failure instanceof CapacityDeferred, (failure) => Effect.fail(exhausted(failure.reason))),
  ) as Effect.Effect<A, Exclude<E, CapacityDeferred> | E2, R>;
};

const ProbeReply = Schema.fromJsonString(Schema.Struct({
  decision: Schema.String,
  reason: Schema.optional(Schema.String),
  protectedCpuSomeAvg10: Schema.optional(Schema.Unknown),
}));

export const pairAdmission = (capacity: string) => Effect.gen(function*() {
  const probe = yield* CapacityAdmission.use((admission) => admission.probe(capacity, 3)).pipe(
    Effect.mapError((cause) => new LanFailure({ problem: `the capacity helper did not run: ${cause._tag === "PlatformFailure" ? cause.problem : cause.message}` })),
  );
  const status = yield* Schema.decodeEffect(ProbeReply)(probe.stdout).pipe(
    Effect.mapError((cause) => new LanFailure({ problem: `the capacity helper's probe reply: ${cause.message}` })),
  );
  const pressure = status.protectedCpuSomeAvg10;
  if (typeof pressure !== "number" || !Number.isFinite(pressure)) return yield* new LanFailure({ problem: "the capacity helper did not report protected CPU pressure" });
  if (pressure >= 20) return `protected CPU pressure ${pressure}% (waiting for less than 20%)`;
  if (probe.exitCode === DEFERRED_EXIT && status.decision === "DEFER") return status.reason;
  if (probe.exitCode !== 0 || status.decision !== "RUN") return yield* new LanFailure({ problem: `the capacity helper refused: ${probe.stderr.trim()}` });
  return undefined;
});

export const nativeCommand = (capacity: string, name: string, runtime: string) =>
  CapacityAdmission.use((admission) => admission.session(capacity, `wisp-lan:${name}`, 1.5)).pipe(Effect.map((session) => [...session, "env", `XDG_RUNTIME_DIR=${runtime}`]));
