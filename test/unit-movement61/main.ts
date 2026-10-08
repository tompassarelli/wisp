import { configureRuntime } from "../../src/runtime/config";
import { writeLines } from "../../src/platform/fileio";
import { unitMovementCases } from "./cases";

export function install(this: void): void {
  configureRuntime({ filePrefix: "unit-movement", readyPrefix: "UV_HRR", globalPrefix: "__unitMovement" });
}

export function start(this: void): void {
  install();
  unitMovementCases(rows => writeLines(`unit-movement-p${GetPlayerId(GetLocalPlayer())}.txt`, rows));
}
