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

/** The pause of each finished collection in a JavaScriptCore `logGC` stream (`BUN_JSC_logGC=1`), in milliseconds. */
export const gcPauses = (log: string): number[] =>
  [...log.matchAll(/\bp=([\d.]+)ms \(max [\d.]+\), cycle [\d.]+ms END\]/g)].map((match) => Number(match[1]));
