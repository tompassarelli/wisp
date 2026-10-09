






import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

/** CPU seconds one test may use (wisp:AGENTS.md). Only Tom raises it. */
export const TEST_CEILING_S = 4;

export const BASELINE_PATH = "test/cost-baseline.tsv";
export const TEST_COST_OUT_ENV = "WISP_TEST_COST_OUT";

export const RISE = 0.25;

export const NOISE_S = 1;

const SPEED_SAMPLE_MIN_S = 0.5;
const SPEED_SAMPLES_MIN = 8;

export interface UnitCost {
  readonly tests: number;
  readonly cpu: number;

  readonly max?: number;
}

export type Costs = Map<string, UnitCost>;

export function addCost(costs: Costs, unit: string, tests: number, cpu: number, max = 0): void {
  const before = costs.get(unit) ?? { tests: 0, cpu: 0 };
  costs.set(unit, { tests: before.tests + tests, cpu: before.cpu + cpu, max: Math.max(before.max ?? 0, max) });
}

const HEADER = "unit\ttests\tcpu_s";

export function readBaseline(path: string): Costs {
  const costs: Costs = new Map();
  if (!existsSync(path)) return costs;
  for (const line of readFileSync(path, "utf8").split("\n").slice(1)) {
    const [unit, tests, cpu] = line.split("\t");
    if (unit !== undefined && unit !== "" && tests !== undefined && cpu !== undefined) costs.set(unit, { tests: Number(tests), cpu: Number(cpu) });
  }
  return costs;
}

function writeBaseline(path: string, costs: Costs): void {
  const rows = [...costs].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([unit, cost]) => `${unit}\t${cost.tests}\t${cost.cpu.toFixed(3)}`);
  writeFileSync(path, `${[HEADER, ...rows].join("\n")}\n`);
}






export function speedFactor(measured: Costs, baseline: Costs): number {
  const ratios: number[] = [];
  const shorter: number[] = [];
  for (const [unit, cost] of measured) {
    const base = baseline.get(unit);
    if (base !== undefined && base.tests === cost.tests && base.cpu >= 0.01 && cost.cpu > 0) {
      (base.cpu >= SPEED_SAMPLE_MIN_S ? ratios : shorter).push(cost.cpu / base.cpu);
    }
  }
  if (ratios.length < SPEED_SAMPLES_MIN) ratios.push(...shorter);
  ratios.sort((a, b) => a - b);
  const middle = Math.floor(ratios.length / 2);
  const upper = ratios[middle] ?? 1;
  return ratios.length % 2 === 1 ? upper : ((ratios[middle - 1] ?? upper) + upper) / 2;
}

export interface Judgement {

  readonly risen: readonly string[];
  readonly factor: number;
  readonly summary: string;

  readonly heaviest: string;

  readonly updated: number;
}






export function judge(options: {
  readonly label: string;
  readonly measured: Costs;
  readonly baselinePath: string;
  readonly project: string;
  readonly totalCpu?: number;




  readonly whole?: boolean;
}): Judgement {
  const { label, measured, baselinePath, project } = options;
  const baseline = readBaseline(baselinePath);
  const factor = speedFactor(measured, baseline);
  const risen: string[] = [];
  const rewriteAll = process.env.TEST_COST_UPDATE === "1";
  const next: Costs = new Map(baseline);
  let updated = 0;
  let tests = 0;
  let cpu = 0;
  let baseTests = 0;
  let baseCpu = 0;
  for (const [unit, cost] of [...measured].sort(([a], [b]) => (a < b ? -1 : 1))) {
    if (cost.tests === 0) continue;
    tests += cost.tests;
    cpu += cost.cpu;
    const base = baseline.get(unit);
    if (base !== undefined) {
      baseTests += base.tests;
      baseCpu += base.cpu;
    }
    if (options.whole === false) continue;
    if (base !== undefined && base.tests === cost.tests && !rewriteAll) {
      const allowed = base.cpu * factor * (1 + RISE);
      if (cost.cpu > allowed && cost.cpu - base.cpu * factor > NOISE_S) {
        const rise = (cost.cpu / (base.cpu * factor) - 1) * 100;
        risen.push(`${unit}: ${(cost.cpu / cost.tests).toFixed(2)} s CPU per test, ${rise.toFixed(0)}% over its baseline ${((base.cpu * factor) / base.tests).toFixed(2)} s; shrink it or move it to the farm`);
      }
      continue;
    }
    next.set(unit, { tests: cost.tests, cpu: cost.cpu / factor });
    console.log(`test cost baseline row: ${unit}\t${cost.tests}\t${(cost.cpu / factor).toFixed(3)}`);
    updated++;
  }
  for (const unit of next.keys()) {
    if (options.whole !== false && !existsSync(resolve(project, unit))) {
      next.delete(unit);
      updated++;
    }
  }
  if (updated > 0) writeBaseline(baselinePath, next);
  const perTest = tests === 0 ? 0 : cpu / tests;
  const basePerTest = baseTests === 0 ? 0 : (baseCpu * factor) / baseTests;
  const change = basePerTest === 0 ? "" : ` (${perTest >= basePerTest ? "+" : ""}${((perTest / basePerTest - 1) * 100).toFixed(0)}%)`;
  const total = options.totalCpu === undefined ? "" : `, ${options.totalCpu.toFixed(1)} s in all with process start-up`;
  const summary = `${label} CPU: ${cpu.toFixed(1)} s for ${tests} tests${total}; ${perTest.toFixed(3)} s per test against the baseline's ${basePerTest.toFixed(3)} s${change}, this machine at ${factor.toFixed(2)}x the reference`;
  const heaviest = [...measured].filter(([, cost]) => (cost.max ?? 0) > 0).sort(([, a], [, b]) => (b.max ?? 0) - (a.max ?? 0)).slice(0, 5)
    .map(([unit, cost]) => `${unit} ${(cost.max ?? 0).toFixed(2)} s`).join(", ");
  return { risen, factor, summary, updated, heaviest: `${label} heaviest tests (CPU): ${heaviest}` };
}
