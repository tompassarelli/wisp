import { expect, test } from "bun:test";
import { merge, type Plan, placeShards, type ShardResult } from "../host/farm/farmShards";

test("[property] the first idle-many shards go to the farm and every other shard, and every shard when the farm is unset, goes to hosted runners (wisp#132)", () => {
  let state = 132;
  const next = (below: number) => {
    state = (Math.imul(state, 1103515245) + 12345) >>> 0;
    return (state >>> 8) % below;
  };
  for (let run = 0; run < 2000; run++) {
    const farm = next(5) === 0 ? "" : "farm-big";
    const shards = next(7);
    const idle = next(5);
    const placement = placeShards(shards, farm, idle);
    expect(placement).toHaveLength(shards);
    placement.forEach(({ runner, reason }, shard) => {
      const onFarm = farm !== "" && shard < idle;
      expect(runner).toBe(onFarm ? farm : "ubuntu-latest");
      expect(reason).toBe(farm === "" ? "no farm runner" : onFarm ? `${idle} farm runners idle` : idle === 0 ? "farm full" : `only ${idle} farm runners idle`);
    });
  }
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
