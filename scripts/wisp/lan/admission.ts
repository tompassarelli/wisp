import { join } from "node:path";

export const admissionFile = (directory: string) => join(directory, "admission.json");

/** Check protected CPU pressure even when the helper uses its away profile. */
export function pairAdmission(capacity: string): string | undefined {
  const probe = Bun.spawnSync([process.execPath, capacity, "probe", "--class", "native", "--memory-gib", "3"], { stdout: "pipe", stderr: "pipe" });
  const status = JSON.parse(probe.stdout.toString()) as { decision: string; reason: string; protectedCpuSomeAvg10: number };
  if (!Number.isFinite(status.protectedCpuSomeAvg10)) throw new Error("the capacity helper did not report protected CPU pressure");
  if (status.protectedCpuSomeAvg10 >= 20) return `protected CPU pressure ${status.protectedCpuSomeAvg10}% (waiting for less than 20%)`;
  if (probe.exitCode === 75 && status.decision === "DEFER") return status.reason;
  if (probe.exitCode !== 0 || status.decision !== "RUN") throw new Error(`the capacity helper refused: ${probe.stderr.toString().trim()}`);
  return undefined;
}

export const nativeCommand = (capacity: string, name: string, runtime: string) => [
  process.execPath, capacity, "session", "--class", "native", "--memory-gib", "1.5", "--owner", `wisp-lan:${name}`, "--", "env", `XDG_RUNTIME_DIR=${runtime}`,
];
