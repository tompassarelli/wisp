import { join } from "node:path";
import { Effect, Schema } from "effect";
import { CapacityAdmission } from "../../platform/services";
import { LanFailure } from "./join";

export const admissionFile = (directory: string) => join(directory, "admission.json");

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
  if (probe.exitCode === 75 && status.decision === "DEFER") return status.reason;
  if (probe.exitCode !== 0 || status.decision !== "RUN") return yield* new LanFailure({ problem: `the capacity helper refused: ${probe.stderr.trim()}` });
  return undefined;
});

export const nativeCommand = (capacity: string, name: string, runtime: string) =>
  CapacityAdmission.use((admission) => admission.session(capacity, `wisp-lan:${name}`, 1.5)).pipe(Effect.map((session) => [...session, "env", `XDG_RUNTIME_DIR=${runtime}`]));
