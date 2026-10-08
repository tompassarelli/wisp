import { join } from "node:path";
import { Effect, Schema } from "effect";
import { ChildProcess } from "effect/process";
import { collect } from "../hostProcess";
import { LanFailure } from "./join";

export const admissionFile = (directory: string) => join(directory, "admission.json");

const ProbeReply = Schema.fromJsonString(Schema.Struct({
  decision: Schema.String,
  reason: Schema.optional(Schema.String),
  protectedCpuSomeAvg10: Schema.optional(Schema.Unknown),
}));

/** Check protected CPU pressure even when the helper uses its away profile; why the pair must wait, or undefined to start it. */
export const pairAdmission = (capacity: string) => Effect.gen(function*() {
  const probe = yield* collect(ChildProcess.make(process.execPath, [capacity, "probe", "--class", "native", "--memory-gib", "3"], { stdin: "ignore" })).pipe(
    Effect.mapError((cause) => new LanFailure({ problem: `the capacity helper did not run: ${cause.message}` })),
  );
  const status = yield* Schema.decodeUnknownEffect(ProbeReply)(new TextDecoder().decode(probe.stdout)).pipe(
    Effect.mapError((cause) => new LanFailure({ problem: `the capacity helper's probe reply: ${cause.message}` })),
  );
  const pressure = status.protectedCpuSomeAvg10;
  if (typeof pressure !== "number" || !Number.isFinite(pressure)) return yield* new LanFailure({ problem: "the capacity helper did not report protected CPU pressure" });
  if (pressure >= 20) return `protected CPU pressure ${pressure}% (waiting for less than 20%)`;
  if (probe.exitCode === 75 && status.decision === "DEFER") return status.reason;
  if (probe.exitCode !== 0 || status.decision !== "RUN") return yield* new LanFailure({ problem: `the capacity helper refused: ${probe.stderr.trim()}` });
  return undefined;
});

export const nativeCommand = (capacity: string, name: string, runtime: string) => [
  process.execPath, capacity, "session", "--class", "native", "--memory-gib", "1.5", "--owner", `wisp-lan:${name}`, "--", "env", `XDG_RUNTIME_DIR=${runtime}`,
];
