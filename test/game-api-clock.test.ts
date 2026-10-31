import { expect, test } from "bun:test";
import * as nativeClock from "../src/game/native/clock";
import { bindWorld } from "../src/game/native/world";
import { HeadlessClient } from "../src/headless/client";
import { readNativeDeclarations } from "../host/headless/headless";
import { compile, wrap } from "./gameApiCompile";

test("clock calls lower to the natives they replaced, byte for byte", () => {
  const lowered = compile(`import { createTimer, destroyTimer, gameSpeed, localElapsed, lockSpeed, pauseTimer, restartMatch, setNormalSpeed, startTimer } from "../../src/game/clock";\n` + wrap(`
  const tick = createTimer();
  startTimer(tick, 1 / 60, true, () => {});
  pauseTimer(tick);
  setNormalSpeed();
  lockSpeed();
  if (localElapsed(tick) > 0 || gameSpeed() === MAP_SPEED_NORMAL) restartMatch(false);
  destroyTimer(tick);`));
  const raw = compile(wrap(`
  const tick = CreateTimer();
  TimerStart(tick, 1 / 60, true, () => {});
  PauseTimer(tick);
  SetGameSpeed(MAP_SPEED_NORMAL);
  SetMapFlag(MAP_LOCK_SPEED, true);
  if (TimerGetElapsed(tick) > 0 || GetGameSpeed() === MAP_SPEED_NORMAL) RestartGame(false);
  DestroyTimer(tick);`));
  expect(lowered.diagnostics).toBe("");
  expect(raw.diagnostics).toBe("");
  expect(lowered.lua).toBe(raw.lua);
  expect(lowered.lua).toContain("SetMapFlag(MAP_LOCK_SPEED, true)");
});

test("the native clock fires a timer on the frame at or after its deadline, once per frame, and keeps each client's timers apart", () => {
  const declarations = readNativeDeclarations();
  const make = (slot: number) => new HeadlessClient({ slot, humans: [0, 1], declarations, filePrefix: "game-api", localNatives: {}, network: [] });
  const [first, second] = [make(0), make(1)];
  const fired: string[] = [];
  bindWorld(first.world);
  const tick = nativeClock.createTimer();
  nativeClock.startTimer(tick, Math.fround(1 / 60), true, () => { fired.push(`tick ${first.frame}`); });
  const slow = nativeClock.createTimer();
  nativeClock.startTimer(slow, 1.5 / 60, true, () => { fired.push(`slow ${first.frame}`); });
  const once = nativeClock.createTimer();
  nativeClock.startTimer(once, 0.1, false, () => { fired.push(`once ${first.frame}`); });
  const idle = nativeClock.createTimer();
  nativeClock.startTimer(idle, 4 / 60, true, () => { fired.push(`idle ${first.frame}`); });
  nativeClock.pauseTimer(idle);
  nativeClock.destroyTimer(idle);
  bindWorld(second.world);
  const other = nativeClock.createTimer();
  nativeClock.startTimer(other, 2 / 60, false, () => { fired.push(`other ${second.frame}`); });
  bindWorld(undefined);
  for (let frame = 0; frame < 7; frame++) {
    first.step(false);
    second.step(false);
  }
  expect(fired).toEqual(["tick 1", "slow 2", "tick 2", "other 2", "tick 3", "slow 3", "tick 4", "slow 5", "tick 5", "tick 6", "slow 6", "once 6", "tick 7"]);
  bindWorld(first.world);
  expect(nativeClock.localElapsed(tick)).toBe(0);
  expect(nativeClock.localElapsed(once)).toBe(0.1);
  nativeClock.setNormalSpeed();
  nativeClock.lockSpeed();
  nativeClock.restartMatch(false);
  expect(nativeClock.gameSpeed() as unknown).toBe("MAP_SPEED_NORMAL");
  bindWorld(undefined);
  expect([...first.emulatedCalls.keys(), ...second.emulatedCalls.keys()]).toEqual([]);
});
