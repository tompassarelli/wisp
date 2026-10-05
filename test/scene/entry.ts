import { configureRuntime } from "../../src/runtime/config";
import { installDispatch } from "../../src/platform/dispatch";
import { startSceneReport } from "../../src/platform/scene";

declare global {
  var __fixtureFrame: number | undefined;
}

export function start(): void {
  configureRuntime({ filePrefix: "fixture", readyPrefix: "FX_HRR", globalPrefix: "__fixture" });
  installDispatch();
  startSceneReport({ frame: () => globalThis.__fixtureFrame ?? 0, parked: (_x, _y, z) => z < -1000.0 });
}
