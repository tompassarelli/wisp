import { createTimer, startTimer } from "wisp/game/clock";
import { displayTextToAll } from "wisp/game/frames";
import { localPlayer, playerSlot } from "wisp/game/players";
import { installDispatch, on, trampoline } from "../../src/map/dispatch";
import { installHotReload, startHotReload } from "../../src/map/hotReload";
import { configureRuntime } from "../../src/runtime/config";

export function install(this: void): void {
  configureRuntime({ filePrefix: "fixture", readyPrefix: "FX_HRR", globalPrefix: "__fixture" });
  installDispatch();
  on("fixture.second", () => {
    displayTextToAll("second");
    if (playerSlot(localPlayer()) === 1) createTimer();
  });
  installHotReload();
}

export function start(this: void): void {
  install();
  startTimer(createTimer(), 1.0, true, trampoline("fixture.second"));
  startHotReload();
}
