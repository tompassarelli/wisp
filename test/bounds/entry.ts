import { createEffect } from "wisp/game/effects";
import { FramePoint, OriginFrame, createFrameByType, originFrame, setFrameAbsPoint, setFrameSize, setFrameTexture } from "wisp/game/frames";
import { configureRuntime } from "../../src/runtime/config";

// One BACKDROP and one effect from a generated MDL, for `wisp headless --bounds` (wisp#125 lane 4).
export function install(this: void): void {
  configureRuntime({ filePrefix: "bounds", readyPrefix: "BOUNDS", globalPrefix: "__bounds" });
}

export function start(this: void): void {
  install();
  const bust = createFrameByType("BACKDROP", "bust", originFrame(OriginFrame.gameUi, 0), "", 0);
  setFrameAbsPoint(bust, FramePoint.topLeft, 0.02625, 0.102);
  setFrameSize(bust, 0.08, 0.08);
  setFrameTexture(bust, "Bust.blp", 0, true);
  createEffect("Cube.mdl", 0, 0);
}
