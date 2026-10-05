import { configureRuntime } from "waygate/src/runtime/config";
import { installDispatch, on, trampoline } from "waygate/src/platform/dispatch";
import { reportError } from "waygate/src/platform/errors";
import { installHotReload, startHotReload } from "waygate/src/platform/hotReload";
import { assertEquals } from "waygate/src/runtime/testing";
import { floorDiv, idiv, imod } from "waygate/src/sim/intMath";
import { f32 } from "waygate/src/sim/f32";
import { multiplyFloat32 } from "waygate/src/sim/binary32";

declare global {
  var __fixtureTicks: number | undefined;
}

export function install(): void {
  configureRuntime({ filePrefix: "fixture", announcePrefix: "FX_HR", readyPrefix: "FX_HRR", globalPrefix: "__fixture" });
  installDispatch();
  installHotReload();
  on("fixture.tick", () => { globalThis.__fixtureTicks = (globalThis.__fixtureTicks ?? 0) + 1; });
}

export function start(): void {
  const large = 2000000000;
  assertEquals(floorDiv(large, 3), 666666666);
  assertEquals(idiv(-large, 3), -666666666);
  assertEquals(imod(-large, 3), 1);
  assertEquals(f32(0.1), 0.10000000149011612);
  assertEquals(multiplyFloat32(16777215.0, 2.0), 33554430.0);
  install();
  startHotReload(0, 0);
}

export const tick = () => trampoline("fixture.tick")();
export const fail = () => reportError("fixture.tick", "fixture failure", "");
