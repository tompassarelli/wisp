import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dir, "..");
const waits = /Bun\.spawn|spawnSync|setTimeout|Bun\.sleep|fetch\(|new Promise/;
const importsEffect = /(?:from|import)\s*\(?\s*["'](?:effect|@effect\/[^"'/]+)(?:\/[^"']*)?["']/;
// Pages served to a browser run there, not under Bun.
const browserPages = (file: string) => file.startsWith("scripts/wisp/browser/") || file === "scripts/wisp/reproViewerPage.ts" || file === "scripts/wisp/tunePage.ts";
// Written before the rule. This list only shrinks: convert a file, then remove it.
const notYetEffect = [
  "scripts/package.ts",
  "scripts/wisp/engine/stopWatch.ts",
  "scripts/wisp/lan/dummy.ts",
  "scripts/wisp/lan/map.ts",
  "scripts/wisp/lan/pairSession.ts",
  "scripts/wisp/panelServer.ts",
  "scripts/wisp/restorePreferences.ts",
];

// AGENTS.md: host tools that start processes or wait are Effect programs.
test("[spec AGENTS.md] host tools under scripts/ that start processes or wait import Effect", async () => {
  const problems: string[] = [];
  let scanned = 0;
  for (const file of new Bun.Glob("scripts/**/*.ts").scanSync(root)) {
    if (/\.tests?\.ts$/.test(file) || browserPages(file)) continue;
    scanned++;
    const source = await Bun.file(join(root, file)).text();
    if (notYetEffect.includes(file)) {
      if (importsEffect.test(source)) problems.push(`${file} now imports Effect; remove it from notYetEffect in test/effect-host-tools.test.ts`);
    } else if (!importsEffect.test(source) && waits.test(source)) {
      problems.push(`${file} starts processes or waits; write it as an Effect program (see AGENTS.md, load effect-development)`);
    }
  }
  for (const file of notYetEffect) {
    if (!existsSync(join(root, file))) problems.push(`${file} no longer exists; remove it from notYetEffect in test/effect-host-tools.test.ts`);
  }
  // Guards the scan: a moved scripts/ must not pass with nothing read.
  expect(scanned).toBeGreaterThanOrEqual(100);
  expect(problems).toEqual([]);
});
