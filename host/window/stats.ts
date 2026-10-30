export interface Spread {
  readonly p50: number;
  readonly p95: number;
  readonly p99: number;
  readonly max: number;
}

/** The value at `fraction` of the sorted samples by the nearest-rank rule, as the page's `standalone.json` figures use. */
export const percentile = (values: readonly number[], fraction: number): number =>
  [...values].sort((a, b) => a - b)[Math.max(0, Math.ceil(values.length * fraction) - 1)] ?? 0;

export const spread = (values: readonly number[]): Spread => ({
  p50: percentile(values, 0.5), p95: percentile(values, 0.95), p99: percentile(values, 0.99), max: values.reduce((most, value) => Math.max(most, value), 0),
});

/** The frame-by-frame sum of two series that may differ in length; extra samples of the longer one are dropped. */
export const summed = (first: readonly number[], second: readonly number[]): number[] =>
  first.slice(0, Math.min(first.length, second.length)).map((value, index) => value + (second[index] ?? 0));

export const GC_LOG_BEGIN = "wisp-window-probe frames begin";
export const GC_LOG_END = "wisp-window-probe frames end";

/** The pause of each finished collection in a JavaScriptCore `logGC` stream (`BUN_JSC_logGC=1`), in milliseconds, by the heap that ran it: each thread's VM logs under its own heap address. */
export const gcPausesByHeap = (log: string): Map<string, number[]> => {
  const heaps = new Map<string, number[]>();
  for (const match of log.matchAll(/\[GC<(0x[0-9a-f]+)>: START[^\n]*? p=([\d.]+)ms \(max [\d.]+\), cycle [\d.]+ms END\]/g)) {
    const heap = match[1]!;
    heaps.set(heap, [...(heaps.get(heap) ?? []), Number(match[2])]);
  }
  return heaps;
};

/** The heap whose collections come first in a log, which is the main thread's VM because it starts before any worker. */
export const firstHeap = (log: string): string | undefined => /\[GC<(0x[0-9a-f]+)>/.exec(log)?.[1];
