import { configureRuntime } from "../../src/runtime/config";

export const TIMER134_CALLBACKS = 4000;
export const TIMER134_PER_CHUNK = 100;

declare global {
  var __timer134: { count: number; chunks: string[] } | undefined;
}

export function install(this: void): void {
  configureRuntime({ filePrefix: "timer134", readyPrefix: "TM134_HRR", globalPrefix: "__timer134" });
}

export function start(this: void): void {
  install();
  const state = { count: 0, chunks: [] as string[] };
  globalThis.__timer134 = state;
  const reference = CreateTimer();
  TimerStart(reference, 128.0, false, () => {});
  let chunk = "";
  let inChunk = 0;
  TimerStart(CreateTimer(), 1.0 / 60.0, true, () => {
    if (state.count >= TIMER134_CALLBACKS) return;
    state.count++;
    chunk = chunk + I2S(R2I(TimerGetElapsed(reference) * 65536.0)) + ",";
    inChunk++;
    if (inChunk === TIMER134_PER_CHUNK) {
      state.chunks.push(chunk);
      chunk = "";
      inChunk = 0;
    }
  });
}
