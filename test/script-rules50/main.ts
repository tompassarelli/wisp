import { configureRuntime } from "../../src/runtime/config";
import { writeLines } from "../../src/platform/fileio";
import { immediateCases, syncCases } from "./cases";

export function install(this: void): void {
  configureRuntime({ filePrefix: "script-rules", readyPrefix: "SR_HRR", globalPrefix: "__scriptRules" });
}

export function start(this: void): void {
  install();
  const slot = GetPlayerId(GetLocalPlayer());
  writeLines(`script-rules-p${slot}.txt`, immediateCases());
  syncCases(rows => writeLines(`script-rules-sync-p${slot}.txt`, rows));
}
