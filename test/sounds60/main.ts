import { configureRuntime } from "../../src/runtime/config";
import { writeLines } from "../../src/platform/fileio";
import { soundCases } from "./cases";

export function install(this: void): void {
  configureRuntime({ filePrefix: "sounds60", readyPrefix: "SND60_HRR", globalPrefix: "__sounds60" });
}

export function start(this: void): void {
  install();
  soundCases(rows => writeLines(`sounds60-p${GetPlayerId(GetLocalPlayer())}.txt`, rows));
}
