import { configureRuntime } from "../../src/runtime/config";
import { writeLines } from "../../src/platform/fileio";
import { unitMotionCases } from "./cases";

export function install(this: void): void {
  configureRuntime({ filePrefix: "unit-motion", readyPrefix: "UM_HRR", globalPrefix: "__unitMotion" });
}

export function start(this: void): void {
  install();
  unitMotionCases(rows => writeLines(`unit-motion-p${GetPlayerId(GetLocalPlayer())}.txt`, rows));
}
