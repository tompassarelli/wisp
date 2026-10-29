import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Option, Schema } from "effect";
import { pairDirectory, writeJson } from "./pool";

/** A pair whose pool failed this many times in a row to start its clients or a game is skipped by `wisp lan lease take` until `wisp lan check` passes on it. */
const UNHEALTHY_AFTER = 2;

const HealthJson = Schema.Struct({ failures: Schema.Int, problem: Schema.optionalKey(Schema.String), at: Schema.String });
type PairHealth = typeof HealthJson.Type;

const decodeHealth = Schema.decodeUnknownOption(Schema.fromJsonString(HealthJson));

const healthFile = (pair: number) => join(pairDirectory(pair), "health.json");

/** Pair K's record of consecutive start failures; a pair never recorded has none. */
export const readHealth = (pair: number): PairHealth => {
  try {
    return Option.getOrElse(decodeHealth(readFileSync(healthFile(pair), "utf8")), () => ({ failures: 0, at: "" }));
  } catch {
    return { failures: 0, at: "" };
  }
};

export const healthy = (health: Pick<PairHealth, "failures">) => health.failures < UNHEALTHY_AFTER;

/** Counts one more failure of pair K to start its clients or a game. */
export const recordFailure = (pair: number, problem: string) =>
  writeJson(healthFile(pair), { failures: readHealth(pair).failures + 1, problem, at: new Date().toISOString() } satisfies PairHealth);

/** Clears pair K's failures once it has started a game or passed `wisp lan check`. */
export const recordPassed = (pair: number) => {
  if (readHealth(pair).failures > 0) writeJson(healthFile(pair), { failures: 0, at: new Date().toISOString() } satisfies PairHealth);
};
