import { dlopen } from "bun:ffi";

const CLOCK_MONOTONIC = 1;
let read: (() => number) | undefined;

function openMonotonic(): () => number {
  const libc = dlopen("libc.so.6", { clock_gettime: { args: ["i32", "ptr"], returns: "i32" } });
  const time = new BigInt64Array(2);
  return () => {
    libc.symbols.clock_gettime(CLOCK_MONOTONIC, time);
    return Number(time[0] ?? 0n) * 1e9 + Number(time[1] ?? 0n);
  };
}

/** Nanoseconds on CLOCK_MONOTONIC, the clock every process on the host shares; Bun's `process.hrtime` counts from its own process's or worker's start, so two of its readings in different processes cannot be compared. */
export const monotonicNs = (): number => (read ??= openMonotonic())();
