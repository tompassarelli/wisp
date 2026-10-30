import { Database } from "bun:sqlite";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { Console, Effect } from "effect";
import { type Command, UsageFailure, flagValues, wholeFlag } from "../cli/command";
import { LanFailure } from "../lan/join";
import { type CapacityHold, readCaptures, readHolds } from "../lan/holdLog";
import { stateHome } from "../os/xdg";

export const HOLDS_USAGE = "holds [--hours N] [--limit-minutes N] [--db capacity.db]";

const POOL_OWNER = /^wisp-lan-pair-(\d+)$/;

const capacityDb = () => join(stateHome(), "agents/machine-capacity/capacity.db");

const capacityHolds = (db: string, sinceMs: number): readonly CapacityHold[] => {
  const database = new Database(db, { readonly: true });
  try {
    const rows = database.query<{ owner: string; at: string; wallSeconds: number }, [string]>("select owner, at, wallSeconds from capacity_runs where owner like 'wisp-lan-pair-%' and at >= ?").all(new Date(sinceMs).toISOString());
    return rows.flatMap(({ owner, at, wallSeconds }) => {
      const pair = POOL_OWNER.exec(owner)?.[1];
      const end = Date.parse(at);
      return pair === undefined ? [] : [{ pair: Number(pair), end, start: end - wallSeconds * 1000 }];
    });
  } finally {
    database.close();
  }
};

/** Prints each pair hold in the last `--hours` of capacity.db with how long it ran past the pair's last capture, and fails when a measured hold ran past `--limit-minutes` (default 30). */
export const holds: Command = (args) => Effect.gen(function*() {
  const hours = wholeFlag(args, "hours", { fallback: 24, min: 1 });
  const limit = wholeFlag(args, "limit-minutes", { fallback: 30, min: 1 });
  if (hours instanceof UsageFailure) return yield* hours;
  if (limit instanceof UsageFailure) return yield* limit;
  const [db = capacityDb()] = flagValues(args, "db");
  if (!existsSync(db)) return yield* new LanFailure({ problem: `${db} does not exist` });
  const readings = readCaptures(capacityHolds(db, Date.now() - hours * 3_600_000), readHolds());
  for (const { pair, start, end, pastCaptureSeconds } of readings) {
    yield* Console.log(`pair ${pair}: held ${new Date(start).toISOString()} to ${new Date(end).toISOString()}, ${pastCaptureSeconds === undefined ? "no record of its last capture" : `${pastCaptureSeconds} s past its last capture`}`);
  }
  const over = readings.filter(({ pastCaptureSeconds }) => pastCaptureSeconds !== undefined && pastCaptureSeconds > limit * 60);
  const unmeasured = readings.filter(({ pastCaptureSeconds }) => pastCaptureSeconds === undefined).length;
  yield* Console.log(`${readings.length} holds in ${hours} h: ${readings.length - unmeasured} measured, ${unmeasured} without a record, ${over.length} over ${limit} min`);
  if (over.length > 0) return yield* new LanFailure({ problem: `${over.length} pair hold${over.length === 1 ? "" : "s"} ran over ${limit} min past the last capture` });
});
