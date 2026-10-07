import { configureRuntime } from "../../src/runtime/config";
import { writeLines } from "../../src/platform/fileio";
import { unitStateCases } from "./cases";

export function install(this: void): void {
  configureRuntime({ filePrefix: "unit-states", readyPrefix: "US_HRR", globalPrefix: "__unitStates" });
}

export function start(this: void): void {
  install();
  writeLines(`unit-states-p${GetPlayerId(GetLocalPlayer())}.txt`, unitStateCases());
}
