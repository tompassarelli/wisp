import { expect, test } from "bun:test";
import { FARM_LOAD_MAX_AGE_SECONDS, type FarmLoad, merge, type Plan, placeShards, type ShardResult } from "../scripts/wisp/farm/farmShards";

test("[property] a shard goes to the farm only when it is even and the farm's load sample is fresh and fits its cores (wisp#132)", () => {
  let state = 132;
  const next = (below: number) => {
    state = (Math.imul(state, 1103515245) + 12345) >>> 0;
    return (state >>> 8) % below;
  };
  const now = 1_800_000_000;
  for (let run = 0; run < 2000; run++) {
    const farm = next(5) === 0 ? "" : "farm-big";
    // Ages and loads straddle the 900 s and load == cores boundaries.
    const sampleAge = next(4) === 0 ? next(60) : FARM_LOAD_MAX_AGE_SECONDS - 3 + next(7);
    const sample: FarmLoad | undefined = next(6) === 0 ? undefined : { load1: next(40) + next(2) / 2, cores: 30 - next(3) * 5, at: now - sampleAge };
    const shards = next(6);
    const placement = placeShards(sample, now, shards, farm);
    expect(placement).toHaveLength(shards);
    const age = sample === undefined ? 0 : now - sample.at;
    const fit = sample !== undefined && age <= FARM_LOAD_MAX_AGE_SECONDS && sample.load1 <= sample.cores;
    placement.forEach(({ runner, reason }, shard) => {
      const onFarm = farm !== "" && shard % 2 === 0 && fit;
      expect(runner).toBe(onFarm ? farm : "ubuntu-latest");
      const expected = farm === "" ? "no farm runner"
        : shard % 2 === 1 ? "odd shard"
        : sample === undefined ? "missing"
        : age > FARM_LOAD_MAX_AGE_SECONDS ? `stale ${age}s`
        : sample.load1 > sample.cores ? `load ${sample.load1} > ${sample.cores} cores`
        : `load ${sample.load1} <= ${sample.cores} cores, ${age}s old`;
      expect(reason).toBe(expected);
    });
  }
  expect(placeShards(undefined, now, 2, "box", false)).toEqual([{ runner: "box", reason: "farm-runner input" }, { runner: "ubuntu-latest", reason: "odd shard" }]);
});

test("[property] merge moves a measured test's time halfway to a slower sample and a fifth of the way to a faster one, and keeps or adopts the rest", () => {
  let state = 7;
  const next = (below: number) => {
    state = (Math.imul(state, 1103515245) + 12345) >>> 0;
    return (state >>> 8) % below;
  };
  for (let run = 0; run < 500; run++) {
    const previous: Record<string, number> = {};
    const tests: ShardResult["tests"][number][] = [];
    for (let index = 0; index < 6; index++) {
      const name = `t${index}`;
      if (next(4) !== 0) previous[name] = next(200) + 1;
      if (next(4) !== 0) tests.push({ name, unit: name, seconds: next(200) + 1, status: "pass" });
    }
    const planned: Plan = { bun: [], lua: 1, luaTests: {} };
    const { timings } = merge(planned, [{ suite: "lua", shard: 0, exitCode: 0, tests }], { bun: {}, lua: previous });
    for (let index = 0; index < 6; index++) {
      const name = `t${index}`;
      const before = previous[name];
      const sample = tests.find((test) => test.unit === name)?.seconds;
      const expected = sample === undefined ? before : before === undefined ? sample : sample > before ? (sample + before) / 2 : 0.2 * sample + 0.8 * before;
      expect(timings.lua[name]).toBe(expected);
    }
  }
});
