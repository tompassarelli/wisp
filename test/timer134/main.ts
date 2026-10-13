import { configureRuntime } from "../../src/runtime/config";

export const TIMER134_CALLBACKS = 4000;
export const TIMER134_FAST_CALLBACKS = 1024;

declare global {
  var __timer134: { readings: number[]; fastReadings: number[] } | undefined;
}

export function install(this: void): void {
  configureRuntime({ filePrefix: "timer134", readyPrefix: "TM134_HRR", globalPrefix: "__timer134" });
}

export function start(this: void): void {
  install();
  const state = { readings: [] as number[], fastReadings: [] as number[] };
  globalThis.__timer134 = state;
  const reference = CreateTimer();
  TimerStart(reference, 128.0, false, () => {});
  TimerStart(CreateTimer(), 1.0 / 1024.0, true, () => {
    if (state.fastReadings.length < TIMER134_FAST_CALLBACKS) state.fastReadings.push(R2I(TimerGetElapsed(reference) * 65536.0));
  });
  TimerStart(CreateTimer(), 1.0 / 60.0, true, () => {
    if (state.readings.length < TIMER134_CALLBACKS) state.readings.push(R2I(TimerGetElapsed(reference) * 65536.0));
  });
}
