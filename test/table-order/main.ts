import { configureRuntime } from "../../src/runtime/config";
import { installDispatch } from "../../src/platform/dispatch";
import { installHotReload, startHotReload } from "../../src/platform/hotReload";
import { writeLines } from "../../src/platform/fileio";
import { floorMod } from "../../src/sim/intMath";

function order(table: Record<string | number, number>, kind: string): string[] {
  let hash = 0;
  let count = 0;
  const rows: string[] = [];
  for (const [key, value] of pairs(table)) {
    hash = floorMod(hash * 31 + value, 65521);
    count++;
    rows.push(`${kind} ${count} ${key} ${value}`);
  }
  return [`${kind} count=${count} checksum=${hash}`, ...rows];
}

export function install(this: void): void {
  configureRuntime({ filePrefix: "table-order", readyPrefix: "TO_HRR", globalPrefix: "__tableOrder" });
  installDispatch();
  installHotReload();
}

export function start(this: void): void {
  install();
  const strings: Record<string, number> = {};
  const integers: Record<number, number> = {};
  for (let index = 1; index <= 1000; index++) {
    strings[`string-table-key-${index}`] = index;
    integers[1000000 + index * 1009] = index;
  }
  const rows = [
    `player=${GetPlayerId(GetLocalPlayer())}`,
    ...order(strings, "string"),
    ...order(integers, "sparse-integer"),
  ];
  writeLines("table-order.txt", rows);
  startHotReload();
}
