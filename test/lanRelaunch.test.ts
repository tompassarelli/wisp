import { describe, expect, test } from "bun:test";
import { Cause, Effect, Exit } from "effect";
import { LanFailure } from "../host/lan/join";
import { WINDOW_RELAUNCHES, launchUntilShown } from "../host/lan/pool";

describe("pool client relaunch", () => {
  test("[spec docs/lan.md] a pool client that shows no window within its deadline is stopped and relaunched at most three times, and its pair fails when the fourth launch shows none", () => {
    const run = (shownOn: number) => {
      const log: string[] = [];
      let launches = 0;
      const exit = Effect.runSyncExit(launchUntilShown({
        launch: Effect.sync(() => ++launches),
        shown: (launch) => Effect.succeed(launch === shownOn),
        stop: (launch) => Effect.sync(() => { log.push(`stop ${launch}`); }),
        relaunching: (count) => Effect.sync(() => { log.push(`relaunch after ${count}`); }),
        exhausted: (count) => new LanFailure({ problem: `no window in ${count} launches` }),
      }));
      return { exit, log, launches };
    };
    expect(WINDOW_RELAUNCHES).toBe(3);
    expect(run(1)).toEqual({ exit: Exit.succeed(1), log: [], launches: 1 });
    expect(run(3)).toEqual({ exit: Exit.succeed(3), log: ["stop 1", "relaunch after 1", "stop 2", "relaunch after 2"], launches: 3 });
    const never = run(0);
    expect(never.launches).toBe(4);
    expect(never.log).toEqual(["stop 1", "relaunch after 1", "stop 2", "relaunch after 2", "stop 3", "relaunch after 3", "stop 4"]);
    expect(Exit.isFailure(never.exit) && Cause.squash(never.exit.cause)).toEqual(new LanFailure({ problem: "no window in 4 launches" }));
  });
});
