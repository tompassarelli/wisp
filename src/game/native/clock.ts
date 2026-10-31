import type { GameSpeed as GameSpeedType, Timer } from "../clock";
import { asHandle, fromHandle, fromValue } from "./types";
import { boundWorld } from "./world";

export function createTimer(): Timer {
  const world = boundWorld();
  world.log?.("CreateTimer", []);
  return fromHandle<Timer>(world.clock.create());
}

export function startTimer(timer: Timer, seconds: number, periodic: boolean, handler: (this: void) => void): void {
  const world = boundWorld();
  world.log?.("TimerStart", [timer, seconds, periodic, handler]);
  world.clock.start(asHandle(timer), seconds, periodic, handler);
}

export function pauseTimer(timer: Timer): void {
  const world = boundWorld();
  world.log?.("PauseTimer", [timer]);
  world.clock.pause(asHandle(timer));
}

export function destroyTimer(timer: Timer): void {
  const world = boundWorld();
  world.log?.("DestroyTimer", [timer]);
  world.clock.destroy(asHandle(timer));
}

export function localElapsed(timer: Timer): number {
  const world = boundWorld();
  world.log?.("TimerGetElapsed", [timer]);
  return world.clock.elapsed(asHandle(timer));
}

export function setNormalSpeed(): void {
  const world = boundWorld();
  world.log?.("SetGameSpeed", ["MAP_SPEED_NORMAL"]);
  world.clock.speed = "MAP_SPEED_NORMAL";
}

export function lockSpeed(): void {
  boundWorld().log?.("SetMapFlag", ["MAP_LOCK_SPEED", true]);
}

export function gameSpeed(): GameSpeedType {
  const world = boundWorld();
  world.log?.("GetGameSpeed", []);
  return fromValue<GameSpeedType>(world.clock.speed);
}

export function restartMatch(scoreScreen: boolean): void {
  boundWorld().log?.("RestartGame", [scoreScreen]);
}

export const GameSpeed = {
  slowest: fromValue<GameSpeedType>("MAP_SPEED_SLOWEST"),
  slow: fromValue<GameSpeedType>("MAP_SPEED_SLOW"),
  normal: fromValue<GameSpeedType>("MAP_SPEED_NORMAL"),
  fast: fromValue<GameSpeedType>("MAP_SPEED_FAST"),
  fastest: fromValue<GameSpeedType>("MAP_SPEED_FASTEST"),
};
