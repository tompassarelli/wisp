import { localPlayer, playerSlot } from "wisp/game/players";
import { configureRuntime } from "../../src/runtime/config";
import { writeLines } from "../gameApiLines";
import { animationCases } from "./cases";

export function install(this: void): void {
  configureRuntime({ filePrefix: "animation", readyPrefix: "AN_HRR", globalPrefix: "__animation58" });
}

export function start(this: void): void {
  install();
  animationCases(rows => writeLines(`animation-p${playerSlot(localPlayer())}.txt`, rows));
}
