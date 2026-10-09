/** CPU seconds one test may use (wisp:AGENTS.md). Only Tom raises it. */
export const TEST_CEILING_S = 4;

export const TEST_COST_OUT_ENV = "WISP_TEST_COST_OUT";

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

export interface CostReport {
  readonly summary: string;
  readonly heaviest: string;
}

export function report(label: string, measured: Costs): CostReport {
  let tests = 0;
  let cpu = 0;
  for (const cost of measured.values()) {
    tests += cost.tests;
    cpu += cost.cpu;
  }
  const perTest = tests === 0 ? 0 : cpu / tests;
  const summary = `${label} CPU: ${cpu.toFixed(1)} s for ${tests} tests; ${perTest.toFixed(3)} s per test`;
  const heaviest = [...measured].filter(([, cost]) => (cost.max ?? 0) > 0).sort(([, a], [, b]) => (b.max ?? 0) - (a.max ?? 0)).slice(0, 5)
    .map(([unit, cost]) => `${unit} ${(cost.max ?? 0).toFixed(2)} s`).join(", ");
  return { summary, heaviest: `${label} heaviest tests (CPU): ${heaviest}` };
}
