








import { afterAll, afterEach, beforeEach } from "bun:test";
import { appendFileSync, readFileSync } from "node:fs";
import { relative } from "node:path";
import { FARM_TEST_RUNNING } from "./farmTest";
import { TEST_CEILING_S, TEST_COST_OUT_ENV } from "./testCost";
import { BUSY_PRESSURE } from "./testRunner";

const out = process.env[TEST_COST_OUT_ENV] ?? "";
/** Linux's USER_HZ: /proc reports child CPU in these ticks. */
const TICKS_PER_SECOND = 100;


const seconds = (): number => {
  const { user, system } = process.cpuUsage();
  let children = 0;
  try {
    const stat = readFileSync("/proc/self/stat", "utf8");
    // Fields after the parenthesized command name; cutime and cstime are fields 16 and 17.
    const fields = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
    children = (Number(fields[13]) + Number(fields[14])) / TICKS_PER_SECOND;
  } catch {
    children = 0;
  }
  return (user + system) / 1e6 + children;
};

const pressure = (): number => {
  try {
    return Number(/^some avg10=([\d.]+)/m.exec(readFileSync("/proc/pressure/cpu", "utf8"))?.[1] ?? "0");
  } catch {
    return 0;
  }
};

{
  const costs = new Map<string, { tests: number; cpu: number; max: number }>();
  const charge = (unit: string, tests: number, cpu: number) => {
    const before = costs.get(unit) ?? { tests: 0, cpu: 0, max: 0 };
    costs.set(unit, { tests: before.tests + tests, cpu: before.cpu + cpu, max: tests > 0 ? Math.max(before.max, cpu) : before.max });
  };
  const write = (line: string) => {
    if (out !== "") appendFileSync(out, `${line}\n`);
  };
  const file = () => relative(process.cwd(), Bun.main);
  let mark = seconds();
  beforeEach(() => {
    const now = seconds();
    charge(file(), 0, now - mark);
    mark = now;
  });
  afterEach(() => {
    const now = seconds();
    const used = now - mark;
    mark = now;
    charge(file(), 1, used);
    const globals = globalThis as Record<string, unknown>;
    const farm = globals[FARM_TEST_RUNNING] === true;
    globals[FARM_TEST_RUNNING] = false;
    if (!farm && used > TEST_CEILING_S) {
      const line = `${file()}: this test used ${used.toFixed(2)} s CPU, over the ${TEST_CEILING_S} s ceiling per test; shrink it or move it to the farm`;
      const current = pressure();
      if (current > BUSY_PRESSURE && out !== "") write(JSON.stringify({ inconclusive: `${line} (inconclusive: CPU pressure ${current.toFixed(0)}%)` }));
      else throw new Error(line);
    }
  });
  afterAll(() => {
    charge(file(), 0, seconds() - mark);
    for (const [unit, cost] of costs) write(JSON.stringify({ unit, ...cost }));
  });
}
