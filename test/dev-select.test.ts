import { expect, test } from "bun:test";
import { selectRun, type SelectablePlan } from "../scripts/wisp/dev/select";
import { elapsedLabel } from "../scripts/wisp/dev/summary";
import type { Changes, Selection, TestUnit } from "../scripts/wisp/dev/testSelection";

const ROOT = "/project";
const UNITS: readonly TestUnit[] = [{ path: "/project/a.test.ts", kind: "file" }, { path: "/project/b.test.ts", kind: "registry" }];

const plan: SelectablePlan = {
  all: () => UNITS,
  select: (changes: Changes, reach): Selection => {
    expect(reach).toBe("direct");
    const unread = changes.changed.filter((path) => path.endsWith("data.json"));
    return { units: UNITS.slice(0, changes.changed.length), deferred: changes.changed.length === 2 ? 3 : 0, unread };
  },
  everything: (reason: string): Selection => ({ units: UNITS, full: reason }),
};

const changes = (partial: Partial<Changes>): Changes => ({ changed: [], created: [], deleted: [], ...partial });

const table: readonly {
  readonly name: string;
  readonly changes: Changes | undefined;
  readonly full: string | undefined;
  readonly units: number;
  readonly reopen: boolean;
  readonly modules: readonly string[];
  readonly announce: readonly string[];
}[] = [
  { name: "the first run selects every unit", changes: undefined, full: "the first run", units: 2, reopen: false, modules: [], announce: ["first run"] },
  { name: "an edited source selects through the plan", changes: changes({ changed: ["/project/src/x.ts"] }), full: undefined, units: 1, reopen: false, modules: ["/project/src/x.ts"], announce: ["saved src/x.ts"] },
  {
    name: "tests left to the landing gate are announced after the save",
    changes: changes({ changed: ["/project/src/x.ts", "/project/src/data.json"] }),
    full: undefined,
    units: 2,
    reopen: false,
    modules: ["/project/src/x.ts", "/project/src/data.json"],
    announce: [
      "saved src/x.ts, src/data.json",
      "left to the landing gate: 3 test files that import the saved files only through other modules",
      "left to the landing gate: src/data.json, which no test declares reading",
    ],
  },
  { name: "a created source reopens the projects", changes: changes({ created: ["/project/src/y.ts"] }), full: undefined, units: 0, reopen: true, modules: [], announce: ["saved src/y.ts"] },
  { name: "a deleted source reopens the projects", changes: changes({ deleted: ["/project/src/y.ts"] }), full: undefined, units: 0, reopen: true, modules: [], announce: ["saved src/y.ts"] },
  { name: "an edited tsconfig runs everything and reopens", changes: changes({ changed: ["/project/tsconfig.json"] }), full: "tsconfig.json changed", units: 2, reopen: true, modules: [], announce: ["saved tsconfig.json"] },
  {
    name: "an edited package.json also asks for a restart",
    changes: changes({ changed: ["/project/package.json", "/project/src/x.ts"] }),
    full: "package.json changed",
    units: 2,
    reopen: true,
    modules: ["/project/src/x.ts"],
    announce: ["saved package.json, src/x.ts", "packages changed: restart wisp dev to load them"],
  },
  { name: "a lockfile asks for a restart", changes: changes({ changed: ["/project/bun.lock"] }), full: "bun.lock changed", units: 2, reopen: true, modules: [], announce: ["saved bun.lock", "packages changed: restart wisp dev to load them"] },
];

for (const row of table) {
  test(`[scenario] selectRun: ${row.name}`, () => {
    const picked = selectRun(row.changes, plan, ROOT);
    expect(picked.selection.full).toBe(row.full);
    expect(picked.selection.units.length).toBe(row.units);
    expect(picked.reopen).toBe(row.reopen);
    expect(picked.changedModules).toEqual(row.modules);
    expect(picked.announce).toEqual(row.announce);
  });
}

test("[scenario] the elapsed label comes from the injected clock readings", () => {
  const readings = [1000, 1250];
  const now = () => readings.shift() ?? 0;
  const since = now();
  expect(elapsedLabel(now() - since)).toBe("   0.250 s  ");
});
