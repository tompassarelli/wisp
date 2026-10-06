// Frame-cost runs in 32-bit Lua (wisp:docs/frame-cost.md#headless): what
// runLuaPerf (wisp:src/headless/luaPerf.ts) prints, read back, and two runs
// compared. Instructions and calls per frame are the same on every run of the
// same code and journey, so a rise is the code's; Lua time is reported and
// varies with the machine.

export const PERF_METRICS = ["instructions", "lua-us", "natives"] as const;
export type PerfMetric = (typeof PERF_METRICS)[number];

export interface PerfValues {
  /** The client's start, before the first frame. */
  readonly start: number;
  readonly total: number;
  readonly median: number;
  readonly mean: number;
  readonly max: number;
}

export interface PerfRun {
  readonly frames: number;
  /** Instructions between the count hook's calls. */
  readonly step: number;
  readonly problems: number;
  /** Per player slot, per metric. */
  readonly clients: ReadonlyMap<number, Readonly<Record<PerfMetric, PerfValues>>>;
}

const HEADING = /^frames (\d+) step (\d+) problems (\d+)$/;
const VALUES = /^p(\d+) (instructions|lua-us|natives) start=([\d.]+) total=([\d.]+) median=([\d.]+) mean=([\d.]+) max=([\d.]+)$/;

/** A run's printed lines, read back; throws on a line it doesn't know. */
export function parsePerfRun(text: string): PerfRun {
  const lines = text.split(/\r?\n/).filter((line) => line.trim() !== "");
  const heading = HEADING.exec(lines[0] ?? "");
  if (heading === null) throw new Error(`not a frame-cost run: ${JSON.stringify(lines[0] ?? "")}`);
  const clients = new Map<number, Partial<Record<PerfMetric, PerfValues>>>();
  for (const line of lines.slice(1)) {
    if (line.startsWith("journey: ")) continue;
    const match = VALUES.exec(line);
    if (match === null) throw new Error(`not a frame-cost line: ${JSON.stringify(line)}`);
    const [, slot, metric, start, total, median, mean, max] = match;
    const values = clients.get(Number(slot)) ?? {};
    values[metric as PerfMetric] = { start: Number(start), total: Number(total), median: Number(median), mean: Number(mean), max: Number(max) };
    clients.set(Number(slot), values);
  }
  const complete = new Map<number, Record<PerfMetric, PerfValues>>();
  for (const [slot, values] of clients) {
    const { instructions, natives } = values;
    const lua = values["lua-us"];
    if (instructions === undefined || natives === undefined || lua === undefined) throw new Error(`p${slot} lacks a metric`);
    complete.set(slot, { instructions, "lua-us": lua, natives });
  }
  return { frames: Number(heading[1]), step: Number(heading[2]), problems: Number(heading[3]), clients: complete };
}

/** How much worse B may be than A before compare fails: a share of A, 0.05 for 5%. */
export const DEFAULT_PERF_THRESHOLD = 0.05;

const LABELS: Record<PerfMetric, string> = { instructions: "Lua instructions", "lua-us": "Lua µs", natives: "native calls" };
const change = (before: number, after: number) => (before === 0 ? (after === 0 ? "+0%" : "new") : `${after >= before ? "+" : ""}${((after / before - 1) * 100).toFixed(1)}%`);
const number = (value: number) => (Number.isInteger(value) ? String(value) : value.toFixed(2));

export interface PerfComparison {
  readonly lines: readonly string[];
  /** What rose beyond the threshold; empty when B is no worse. */
  readonly regressions: readonly string[];
}

/**
 * B against A, per client and metric, per frame: mean, median and max, and
 * the start. Instructions (mean and max) and calls (mean) are held to the
 * threshold; Lua time is reported only.
 */
export function comparePerfRuns(a: PerfRun, b: PerfRun, threshold = DEFAULT_PERF_THRESHOLD): PerfComparison {
  const lines = [`A: ${a.frames} frames, B: ${b.frames} frames, per frame A -> B`];
  const regressions: string[] = [];
  if (a.frames !== b.frames) regressions.push(`the runs played ${a.frames} and ${b.frames} frames`);
  if (b.problems > 0) regressions.push(`B's journey found ${b.problems} problem(s)`);
  for (const [slot, after] of b.clients) {
    const before = a.clients.get(slot);
    if (before === undefined) {
      regressions.push(`p${slot} is not in A`);
      continue;
    }
    for (const metric of PERF_METRICS) {
      const from = before[metric];
      const to = after[metric];
      lines.push(`p${slot} ${LABELS[metric]}: mean ${number(from.mean)} -> ${number(to.mean)} (${change(from.mean, to.mean)}), median ${number(from.median)} -> ${number(to.median)}, max ${number(from.max)} -> ${number(to.max)} (${change(from.max, to.max)}), start ${number(from.start)} -> ${number(to.start)}`);
      if (metric === "lua-us") continue;
      const gated: readonly ("mean" | "max")[] = metric === "instructions" ? ["mean", "max"] : ["mean"];
      for (const value of gated) {
        if (to[value] > from[value] * (1 + threshold)) regressions.push(`p${slot} ${LABELS[metric]} ${value} ${change(from[value], to[value])}`);
      }
    }
  }
  return { lines, regressions };
}
