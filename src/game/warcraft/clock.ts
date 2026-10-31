import type { Lowering } from "./lowering";

export const clock: Lowering = {
  createTimer: "CreateTimer()",
  startTimer: "TimerStart($1, $2, $3, $4)",
  pauseTimer: "PauseTimer($1)",
  destroyTimer: "DestroyTimer($1)",
  localElapsed: "TimerGetElapsed($1)",
  setNormalSpeed: "SetGameSpeed(MAP_SPEED_NORMAL)",
  lockSpeed: "SetMapFlag(MAP_LOCK_SPEED, true)",
  gameSpeed: "GetGameSpeed()",
  restartMatch: "RestartGame($1)",
};
