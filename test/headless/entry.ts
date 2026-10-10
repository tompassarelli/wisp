import { installDispatch, on, trampoline } from "../../src/platform/dispatch";
import { installHotReload, startHotReload } from "../../src/platform/hotReload";
import { configureRuntime } from "../../src/runtime/config";

export function install(this: void): void {
  configureRuntime({ filePrefix: "fixture", readyPrefix: "FX_HRR", globalPrefix: "__fixture" });
  installDispatch();
  on("fixture.second", () => {
    DisplayTextToForce(GetPlayersAll(), "second");
    if (GetPlayerId(GetLocalPlayer()) === 1) CreateTimer();
  });
  installHotReload();
}

export function start(this: void): void {
  install();
  TimerStart(CreateTimer(), 1.0, true, trampoline("fixture.second"));
  startHotReload();
}
