import { configureRuntime } from "../../src/runtime/config";
import { installDispatch, on, trampoline } from "../../src/map/dispatch";
import { reportError } from "../../src/map/errors";
import { installHotReload, startHotReload } from "../../src/map/hotReload";

declare global {
  var __fixtureTicks: number | undefined;
}

const FIXTURE = { filePrefix: "fixture", readyPrefix: "FX_HRR", globalPrefix: "__fixture" };

export function install(): void {
  configureRuntime(FIXTURE);
  installDispatch();
  installHotReload();
  on("fixture.tick", () => { globalThis.__fixtureTicks = (globalThis.__fixtureTicks ?? 0) + 1; });
}

export function start(): void {
  install();
  startHotReload();
}

export const tick = () => trampoline("fixture.tick")();
export const fail = (message = "fixture failure") => reportError("fixture.tick", message, "");
export const showErrors = (errorsOnScreen: boolean) => configureRuntime({ ...FIXTURE, errorsOnScreen });
