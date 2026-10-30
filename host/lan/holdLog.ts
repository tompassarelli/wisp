import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { Option, Schema } from "effect";
import { stateRoot } from "./pool";

const HoldJson = Schema.Struct({ pair: Schema.Int, owner: Schema.String, end: Schema.String, lastBusy: Schema.String, how: Schema.Literals(["released", "stopped"]) });

/** A pool's account of one pair it held: it let go at `end`, the pair was last driven or playing at `lastBusy`, and it let go because its checks ended (`released`) or its run ended (`stopped`). */
export type HoldRecord = typeof HoldJson.Type;

const decodeHold = Schema.decodeUnknownOption(Schema.fromJsonString(HoldJson));

const holdsFile = () => join(stateRoot(), "holds.jsonl");

export const recordHold = (hold: HoldRecord, file = holdsFile()) => {
  mkdirSync(dirname(file), { recursive: true });
  appendFileSync(file, `${JSON.stringify(hold)}\n`);
};

export const readHolds = (file = holdsFile()): readonly HoldRecord[] => {
  try {
    return readFileSync(file, "utf8").split("\n").flatMap((line) => Option.toArray(decodeHold(line)));
  } catch {
    return [];
  }
};

/** One hold of a pair in machine-capacity's `capacity.db`: the pair's capacity session, `wisp-lan-pair-K`, from `start` to `end` (ms). */
export interface CapacityHold {
  readonly pair: number;
  readonly start: number;
  readonly end: number;
}

export interface HoldReading extends CapacityHold {
  readonly pastCaptureSeconds: number | undefined;
}

/** The pool writes its record as it stops the pair, before the pair's capacity session closes, so a record matches the capacity hold that ended within this window after it. */
const RECORD_TO_SESSION_END_MS = 10 * 60_000;

/** How long each capacity hold ran past the pair's last capture, from the pool's record of it; a hold no record matches has no reading, as holds that ran before pools wrote records do. */
export const readCaptures = (holds: readonly CapacityHold[], records: readonly HoldRecord[]): readonly HoldReading[] => {
  const unused = [...records];
  return [...holds].sort((left, right) => left.end - right.end).map((hold) => {
    const index = unused.findIndex((record) => {
      const ended = Date.parse(record.end);
      return record.pair === hold.pair && ended >= hold.start && ended <= hold.end + 5_000 && hold.end - ended <= RECORD_TO_SESSION_END_MS;
    });
    const [record] = index < 0 ? [] : unused.splice(index, 1);
    return { ...hold, pastCaptureSeconds: record === undefined ? undefined : Math.max(0, Math.round((hold.end - Date.parse(record.lastBusy)) / 1000)) };
  });
};
