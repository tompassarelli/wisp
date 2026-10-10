





import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ladderScan } from "../scripts/warcraft/war3Log";

const fixture = (name: string) => readFileSync(join(import.meta.dir, "fixtures/war3log", name), "utf8");

const until = (log: string, time: string) => {
  const lines = log.split("\r\n");
  return lines.slice(0, lines.findLastIndex((line) => line !== "" && line.slice(5, 17) <= time) + 1).join("\r\n");
};
const loadfile = fixture("loadfile-scan-mid-load.txt");
const menus = fixture("menus-after-scan.txt");

test("[native] the ladder scan comes after the login doors close; the startup scan of the same folders doesn't count", () => {
  expect(ladderScan(until(loadfile, "20:34:57.138")).kind).toBe("signing in");

  expect(ladderScan(until(loadfile, "20:35:14.431"))).toMatchObject({ kind: "waiting" });
  expect(ladderScan(until(loadfile, "20:35:18.925"))).toMatchObject({ kind: "scanning", count: 20 });

  expect(ladderScan(loadfile).kind).toBe("done");
});
