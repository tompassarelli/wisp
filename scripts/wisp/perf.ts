





export const PERF_METRICS = ["instructions", "lua-us", "natives", "alloc-kb", "typed", "native-us", "typing-us"] as const;
export type PerfMetric = (typeof PERF_METRICS)[number];

export const RUNTIME_METRICS = ["runtime-instructions", "runtime-alloc-kb"] as const;
export type RuntimeMetric = (typeof RUNTIME_METRICS)[number];

export interface ModuleAllocation {
  readonly total: number;
  readonly mean: number;
}

export interface PerfValues {

  readonly start: number;
  readonly total: number;
  readonly median: number;
  readonly p95: number;
  readonly mean: number;
  readonly max: number;

  readonly top: number;
}

export interface PerfRun {
  readonly frames: number;

  readonly step: number;
  readonly problems: number;

  readonly collector: { readonly us: number; readonly kb: number };

  readonly clients: ReadonlyMap<number, Readonly<Record<PerfMetric, PerfValues>>>;

  readonly runtime: ReadonlyMap<number, Readonly<Partial<Record<RuntimeMetric, PerfValues>>>>;

  readonly modules: ReadonlyMap<number, ReadonlyMap<string, ModuleAllocation>>;
}

const HEADING = /^frames (\d+) step (\d+) problems (\d+)$/;
const COLLECTOR = /^collector us=(\d+) kb=(\d+)$/;
const VALUES = /^p(\d+) ([a-z-]+) start=(-?[\d.]+) total=(-?[\d.]+) median=(-?[\d.]+) p95=(-?[\d.]+) mean=(-?[\d.]+) max=(-?[\d.]+)(?: top=(-?[\d.]+))?$/;
const MODULE = /^p(\d+) module-alloc-bytes (\S+) total=(-?\d+) mean=(-?\d+)$/;

const isMetric = (name: string): name is PerfMetric => (PERF_METRICS as readonly string[]).includes(name);
const isRuntimeMetric = (name: string): name is RuntimeMetric => (RUNTIME_METRICS as readonly string[]).includes(name);


export function parsePerfRun(text: string): PerfRun {
  const lines = text.split(/\r?\n/).filter((line) => line.trim() !== "");
  const heading = HEADING.exec(lines[0] ?? "");
  if (heading === null) throw new Error(`not a frame-cost run: ${JSON.stringify(lines[0] ?? "")}`);
  const clients = new Map<number, Partial<Record<PerfMetric, PerfValues>>>();
  const runtime = new Map<number, Partial<Record<RuntimeMetric, PerfValues>>>();
  const modules = new Map<number, Map<string, ModuleAllocation>>();
  let collector = { us: 0, kb: 0 };
  for (const line of lines.slice(1)) {
    if (line.startsWith("journey: ") || line.startsWith("frame ")) continue;
    const collected = COLLECTOR.exec(line);
    if (collected !== null) {
      collector = { us: Number(collected[1]), kb: Number(collected[2]) };
      continue;
    }
    const allocated = MODULE.exec(line);
    if (allocated !== null) {
      const perModule = modules.get(Number(allocated[1])) ?? new Map<string, ModuleAllocation>();
      perModule.set(allocated[2] ?? "", { total: Number(allocated[3]), mean: Number(allocated[4]) });
      modules.set(Number(allocated[1]), perModule);
      continue;
    }
    const match = VALUES.exec(line);
    const [, slot, metric = "", start, total, median, p95, mean, max, top] = match ?? [];
    if (match === null || !(isMetric(metric) || isRuntimeMetric(metric))) throw new Error(`not a frame-cost line: ${JSON.stringify(line)}`);
    const parsed = { start: Number(start), total: Number(total), median: Number(median), p95: Number(p95), mean: Number(mean), max: Number(max), top: Number(top ?? max) };
    if (isRuntimeMetric(metric)) {
      runtime.set(Number(slot), { ...runtime.get(Number(slot)), [metric]: parsed });
      continue;
    }
    const values = clients.get(Number(slot)) ?? {};
    values[metric] = parsed;
    clients.set(Number(slot), values);
  }
  const complete = new Map<number, Record<PerfMetric, PerfValues>>();
  for (const [slot, values] of clients) {
    const missing = PERF_METRICS.filter((metric) => values[metric] === undefined);
    if (missing.length > 0) throw new Error(`p${slot} lacks ${missing.join(", ")}`);
    complete.set(slot, values as Record<PerfMetric, PerfValues>);
  }
  return { frames: Number(heading[1]), step: Number(heading[2]), problems: Number(heading[3]), collector, clients: complete, runtime, modules };
}


export const DEFAULT_PERF_THRESHOLD = 0.05;

const LABELS: Record<PerfMetric, string> = {
  instructions: "Lua instructions", "lua-us": "Lua µs", natives: "native calls", "alloc-kb": "allocated KB", typed: "typed characters",
  "native-us": "predicted native µs", "typing-us": "predicted typing stall µs",
};









const GATED: Partial<Record<PerfMetric, readonly ("median" | "p95" | "mean" | "top")[]>> = {
  instructions: ["mean", "top"],
  natives: ["mean"],
  "alloc-kb": ["mean", "p95"],
  "native-us": ["median", "p95"],
  "typing-us": ["top"],
};

const change = (before: number, after: number) => (before === 0 ? (after === 0 ? "+0%" : "new") : `${after >= before ? "+" : ""}${((after / before - 1) * 100).toFixed(1)}%`);
const number = (value: number) => (Number.isInteger(value) ? String(value) : value.toFixed(2));

const MODULE_ROWS = 5;

function grownModules(before: ReadonlyMap<string, ModuleAllocation> | undefined, after: ReadonlyMap<string, ModuleAllocation> | undefined): string[] {
  const grown: { readonly name: string; readonly from: number; readonly to: number }[] = [];
  for (const [name, now] of after ?? []) {
    const from = before?.get(name)?.mean ?? 0;
    if (now.mean > from) grown.push({ name, from, to: now.mean });
  }
  grown.sort((left, right) => right.to - right.from - (left.to - left.from));
  return grown.slice(0, MODULE_ROWS).map(({ name, from, to }) => `${name} ${number(from)} -> ${number(to)} B/frame`);
}

function moduleLines(slot: number, before: ReadonlyMap<string, ModuleAllocation> | undefined, after: ReadonlyMap<string, ModuleAllocation> | undefined): string[] {
  const names = [...new Set([...(before?.keys() ?? []), ...(after?.keys() ?? [])])].sort();
  return names.map((name) => {
    const from = before?.get(name)?.mean ?? 0;
    const to = after?.get(name)?.mean ?? 0;
    return `p${slot} module ${name} allocated bytes: mean ${number(from)} -> ${number(to)} (${change(from, to)})`;
  });
}

export interface PerfComparison {
  readonly lines: readonly string[];

  readonly regressions: readonly string[];
}






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
    for (const metric of RUNTIME_METRICS) {
      const [from, to] = [a.runtime.get(slot)?.[metric], b.runtime.get(slot)?.[metric]];
      if (from !== undefined && to !== undefined) lines.push(`p${slot} Wisp headless runtime ${metric}: mean ${number(from.mean)} -> ${number(to.mean)} (${change(from.mean, to.mean)}), p95 ${number(from.p95)} -> ${number(to.p95)} (${change(from.p95, to.p95)})`);
    }
    lines.push(...moduleLines(slot, a.modules.get(slot), b.modules.get(slot)));
    for (const metric of PERF_METRICS) {
      const from = before[metric];
      const to = after[metric];
      lines.push(`p${slot} ${LABELS[metric]}: mean ${number(from.mean)} -> ${number(to.mean)} (${change(from.mean, to.mean)}), median ${number(from.median)} -> ${number(to.median)}, p95 ${number(from.p95)} -> ${number(to.p95)} (${change(from.p95, to.p95)}), max ${number(from.max)} -> ${number(to.max)} (${change(from.max, to.max)}), top 1% mean ${number(from.top)} -> ${number(to.top)} (${change(from.top, to.top)}), start ${number(from.start)} -> ${number(to.start)}`);
      for (const value of GATED[metric] ?? []) {
        if (to[value] > from[value] * (1 + threshold)) {
          const grown = metric === "alloc-kb" ? grownModules(a.modules.get(slot), b.modules.get(slot)) : [];
          regressions.push(`p${slot} ${LABELS[metric]} ${value} ${change(from[value], to[value])}${grown.length > 0 ? ` (grew: ${grown.join(", ")})` : ""}`);
        }
      }
    }
  }
  return { lines, regressions };
}

const ms = (us: number) => (us / 1000).toFixed(2);


export function predictionLines(run: PerfRun): string[] {
  return [...run.clients].map(([slot, values]) => {
    const callbacks = values["native-us"];
    const typing = values["typing-us"];
    return `p${slot} predicted native per frame: ${ms(callbacks.median)} ms p50, ${ms(callbacks.p95)} ms p95, ${ms(callbacks.max)} ms worst; typing stall ${ms(typing.max)} ms worst`;
  });
}
