import { configureRuntime } from "../../src/runtime/config";
import { installDispatch, on, trampoline } from "../../src/platform/dispatch";
import { reportError } from "../../src/platform/errors";
import { installHotReload, startHotReload } from "../../src/platform/hotReload";

declare global {
  var __fixtureTicks: number | undefined;
}

export function install(): void {
  configureRuntime({ filePrefix: "fixture", readyPrefix: "FX_HRR", globalPrefix: "__fixture" });
  installDispatch();
  installHotReload();
  on("fixture.tick", () => { globalThis.__fixtureTicks = (globalThis.__fixtureTicks ?? 0) + 1; });
}

export function start(): void {
  install();
  startHotReload();
}

export const tick = () => trampoline("fixture.tick")();
export const fail = () => reportError("fixture.tick", "fixture failure", "");
