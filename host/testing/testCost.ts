/** Lua32 VM instructions one test's Lua children may run: 4 s at the reference runner's 70M per second (wisp:AGENTS.md). Only Tom raises it. */
export const TEST_CEILING_LUA_INSTRUCTIONS = 280_000_000;
/** Headless client frames one test may step, about 4 s on a farm runner (wisp:AGENTS.md). Only Tom raises it. */
export const TEST_CEILING_FRAMES = 80_000;

export const TEST_COST_OUT_ENV = "WISP_TEST_COST_OUT";

export interface UnitCost {
  readonly tests: number;
  readonly cpu: number;

  readonly max?: number;
  readonly maxLuaInstructions?: number;
  readonly maxFrames?: number;
}

export type Costs = Map<string, UnitCost>;

export function addCost(costs: Costs, unit: string, tests: number, cpu: number, max = 0, maxLuaInstructions = 0, maxFrames = 0): void {
  const before = costs.get(unit) ?? { tests: 0, cpu: 0 };
  costs.set(unit, {
    tests: before.tests + tests, cpu: before.cpu + cpu, max: Math.max(before.max ?? 0, max),
    maxLuaInstructions: Math.max(before.maxLuaInstructions ?? 0, maxLuaInstructions), maxFrames: Math.max(before.maxFrames ?? 0, maxFrames),
  });
}

export interface CostReport {
  readonly summary: string;
  readonly heaviest: string;
  readonly deterministic: string;
}

const top = (measured: Costs, of: (cost: UnitCost) => number, show: (value: number) => string) =>
  [...measured].filter(([, cost]) => of(cost) > 0).sort(([, a], [, b]) => of(b) - of(a)).slice(0, 5).map(([unit, cost]) => `${unit} ${show(of(cost))}`).join(", ");

export function report(label: string, measured: Costs): CostReport {
  let tests = 0;
  let cpu = 0;
  for (const cost of measured.values()) {
    tests += cost.tests;
    cpu += cost.cpu;
  }
  const perTest = tests === 0 ? 0 : cpu / tests;
  const summary = `${label} CPU: ${cpu.toFixed(1)} s for ${tests} tests; ${perTest.toFixed(3)} s per test (reported, not gated)`;
  const heaviest = `${label} heaviest tests (CPU): ${top(measured, (cost) => cost.max ?? 0, (value) => `${value.toFixed(2)} s`)}`;
  const deterministic = `${label} heaviest tests (Lua32 instructions, ceiling ${TEST_CEILING_LUA_INSTRUCTIONS / 1e6}M): ${top(measured, (cost) => cost.maxLuaInstructions ?? 0, (value) => `${value / 1e6}M`)}; (frames, ceiling ${TEST_CEILING_FRAMES}): ${top(measured, (cost) => cost.maxFrames ?? 0, String)}`;
  return { summary, heaviest, deterministic };
}
