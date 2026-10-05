import { configureRuntime } from "wisp/src/runtime/config";
import { installDispatch, on, trampoline } from "wisp/src/platform/dispatch";
import { reportError } from "wisp/src/platform/errors";
import { installHotReload, startHotReload } from "wisp/src/platform/hotReload";
import { assertEquals } from "wisp/src/runtime/testing";
import { floorDiv, idiv, imod } from "wisp/src/sim/intMath";
import { f32 } from "wisp/src/sim/f32";
import { multiplyFloat32 } from "wisp/src/sim/binary32";

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
  const large = 2000000000;
  assertEquals(floorDiv(large, 3), 666666666);
  assertEquals(idiv(-large, 3), -666666666);
  assertEquals(imod(-large, 3), 1);
  assertEquals(f32(0.1), 0.10000000149011612);
  assertEquals(multiplyFloat32(16777215.0, 2.0), 33554430.0);
  install();
  startHotReload();
}

export const tick = () => trampoline("fixture.tick")();
export const fail = () => reportError("fixture.tick", "fixture failure", "");
