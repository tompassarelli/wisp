import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { importFailures, ladderScan } from "../scripts/warcraft/war3Log";

const fixture = (name: string) => readFileSync(join(import.meta.dir, "fixtures/war3log", name), "utf8");

const until = (log: string, time: string) => {
  const lines = log.split("\r\n");
  return lines.slice(0, lines.findLastIndex((line) => line !== "" && line.slice(5, 17) <= time) + 1).join("\r\n");
};
const loadfile = fixture("loadfile-scan-mid-load.txt");
const menus = fixture("menus-after-scan.txt");
const interleaved = fixture("menus-listing-during-scan.txt");

test("[native] the ladder scan comes after the login doors close; the startup scan of the same folders doesn't count", () => {
  expect(ladderScan(until(loadfile, "20:34:57.138")).kind).toBe("signing in");

  expect(ladderScan(until(loadfile, "20:35:14.431"))).toMatchObject({ kind: "waiting" });
  expect(ladderScan(until(loadfile, "20:35:18.925"))).toMatchObject({ kind: "scanning", count: 20 });

  expect(ladderScan(loadfile).kind).toBe("done");
});

test("[native] the scan's batches are one scan: a pause between them, or other lines in it, don't end it", () => {

  expect(ladderScan(until(menus, "16:21:19.644"))).toMatchObject({ kind: "scanning" });
  expect(ladderScan(until(menus, "16:21:20.318"))).toMatchObject({ kind: "scanning", count: 24 + 20 });
  expect(ladderScan(menus)).toMatchObject({ kind: "done" });

  expect(ladderScan(until(interleaved, "20:30:21.386")).kind).toBe("scanning");
  expect(ladderScan(until(interleaved, "20:30:21.529")).kind).toBe("scanning");
});

test("[native] import failures are counted with the first model named; a clean load has none", () => {
  expect(importFailures(loadfile)).toEqual({ count: 7, first: "war3mapImported/ImpactHit-14ab984c85a771b2c9feb68275c44577ceb14d0f5c5f2e3801cbc00c2decd594.mdx" });
  expect(importFailures(menus)).toEqual({ count: 0 });
  expect(importFailures(interleaved)).toEqual({ count: 0 });
});
