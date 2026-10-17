import { configureRuntime } from "../../src/runtime/config";
import { writeLines } from "../../src/map/fileio";

export const TIMER134_CALLBACKS = 4000;
export const TIMER134_FAST_CALLBACKS = 1024;
const ROWS_PER_FILE = 100;

declare global {
  var __timer134: { readings: number[]; fastReadings: number[] } | undefined;
}

export function install(this: void): void {
  configureRuntime({ filePrefix: "timer134", readyPrefix: "TM134_HRR", globalPrefix: "__timer134" });
}

function record(this: void, readings: number[], total: number, name: string, reading: number): void {
  if (readings.length >= total) return;
  readings.push(reading);
  const count = readings.length;
  if (count % ROWS_PER_FILE !== 0 && count !== total) return;
  const first = count - ((count - 1) % ROWS_PER_FILE);
  const rows: string[] = [];
  for (let callback = first; callback <= count; callback++) rows.push(`${callback},${readings[callback - 1]}`);
  writeLines(`${name}-${count}-p${GetPlayerId(GetLocalPlayer())}.txt`, rows);
}

export function start(this: void): void {
  install();
  const state = { readings: [] as number[], fastReadings: [] as number[] };
  globalThis.__timer134 = state;
  const reference = CreateTimer();
  TimerStart(reference, 128.0, false, () => {});
  TimerStart(CreateTimer(), 1.0 / 1024.0, true, () => {
    record(state.fastReadings, TIMER134_FAST_CALLBACKS, "timer134-fast", R2I(TimerGetElapsed(reference) * 65536.0));
  });
  TimerStart(CreateTimer(), 1.0 / 60.0, true, () => {
    record(state.readings, TIMER134_CALLBACKS, "timer134", R2I(TimerGetElapsed(reference) * 65536.0));
  });
}
