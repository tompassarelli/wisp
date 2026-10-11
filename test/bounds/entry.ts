import { configureRuntime } from "../../src/runtime/config";

// One BACKDROP and one effect from a generated MDL, for `wisp headless --bounds` (wisp#125 lane 4).
export function install(this: void): void {
  configureRuntime({ filePrefix: "bounds", readyPrefix: "BOUNDS", globalPrefix: "__bounds" });
}

export function start(this: void): void {
  install();
  const bust = BlzCreateFrameByType("BACKDROP", "bust", BlzGetOriginFrame(ORIGIN_FRAME_GAME_UI, 0), "", 0);
  BlzFrameSetAbsPoint(bust, FRAMEPOINT_TOPLEFT, 0.02625, 0.102);
  BlzFrameSetSize(bust, 0.08, 0.08);
  BlzFrameSetTexture(bust, "Bust.blp", 0, true);
  AddSpecialEffect("Cube.mdl", 0, 0);
}
