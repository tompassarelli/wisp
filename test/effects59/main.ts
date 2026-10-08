import { configureRuntime } from "../../src/runtime/config";
import { writeLines } from "../../src/platform/fileio";
import { effectCases } from "./cases";

export function install(this: void): void {
  configureRuntime({ filePrefix: "effects", readyPrefix: "FX_HRR", globalPrefix: "__effects59" });
}

export function start(this: void): void {
  install();
  effectCases(rows => writeLines(`effects-p${GetPlayerId(GetLocalPlayer())}.txt`, rows));
}
