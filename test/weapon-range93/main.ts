import { configureRuntime } from "../../src/runtime/config";
import { writeLines } from "../../src/platform/fileio";
import { weaponRangeCases } from "./cases";

export function install(this: void): void {
  configureRuntime({ filePrefix: "weapon-range93", readyPrefix: "WR_HRR", globalPrefix: "__weaponRange93" });
}

export function start(this: void): void {
  install();
  weaponRangeCases(rows => writeLines(`weapon-range93-p${GetPlayerId(GetLocalPlayer())}.txt`, rows));
}
