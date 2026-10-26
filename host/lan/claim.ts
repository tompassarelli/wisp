import { readFileSync } from "node:fs";
import { Option, Schema } from "effect";

/** A process by its PID and kernel start time, so a reused PID never reads as the same process. */
export interface ProcessMark {
  readonly pid: number;
  readonly start: number;
}

const ProcessMarkJson = Schema.Struct({ pid: Schema.Int, start: Schema.Int });

const startOf = (pid: number) => {
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
    const start = Number(stat.slice(stat.lastIndexOf(")") + 2).split(" ")[19]);
    return Number.isInteger(start) ? start : undefined;
  } catch {
    return undefined;
  }
};

export const markOf = (pid: number): ProcessMark | undefined => {
  const start = startOf(pid);
  return start === undefined ? undefined : { pid, start };
};

export const running = (mark: ProcessMark) => startOf(mark.pid) === mark.start;

/** Who holds a pair: the pool process holding its `pool.lock` (`pid`, `start`), the fleet session that started it and that session's own process (`agent`), and the lane label `owner`. */
export interface PairClaim extends ProcessMark {
  readonly pair: number;
  readonly owner: string;
  readonly session: string;
  readonly agent?: ProcessMark;
}

const PairClaimJson = Schema.Struct({
  pair: Schema.Int,
  owner: Schema.String,
  session: Schema.String,
  pid: Schema.Int,
  start: Schema.Int,
  agent: Schema.optionalKey(ProcessMarkJson),
});

const decodeClaim = Schema.decodeUnknownOption(Schema.fromJsonString(PairClaimJson));

export const readClaimAt = (file: string): PairClaim | undefined => {
  try {
    return Option.getOrUndefined(decodeClaim(readFileSync(file, "utf8")));
  } catch {
    return undefined;
  }
};

export const claimHolder = (claim: PairClaim) => `wisp lan pool ${claim.pid}${claim.session === "" ? "" : ` (fleet session ${claim.session})`}`;
