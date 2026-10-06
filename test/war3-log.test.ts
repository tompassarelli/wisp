// Warcraft III's own log, recorded on 6 Oct 2026 (abridged, CRLF as written):
// loadfile-scan-mid-load.txt is a primary-display `wisp play` whose -loadfile
// map loaded before the ladder scan (326 import failures in the full log);
// menus-after-scan.txt a client hosting from its menus long after the scan (0);
// menus-listing-during-scan.txt the `play --menus` run that crashed, whose map
// listing ran between the scan's Season1 and Season9 batches.
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { importFailures, ladderScan, sessionStart } from "../scripts/warcraft/war3Log";

const fixture = (name: string) => readFileSync(join(import.meta.dir, "fixtures/war3log", name), "utf8");
/** The log as it stood once every line up to `time` was written. */
const until = (log: string, time: string) => {
  const lines = log.split("\r\n");
  return lines.slice(0, lines.findLastIndex((line) => line !== "" && line.slice(5, 17) <= time) + 1).join("\r\n");
};
const loadfile = fixture("loadfile-scan-mid-load.txt");
const menus = fixture("menus-after-scan.txt");
const interleaved = fixture("menus-listing-during-scan.txt");

test("the ladder scan comes after the login doors close; the startup scan of the same folders doesn't count", () => {
  expect(ladderScan(until(loadfile, "20:34:57.138")).kind).toBe("signing in");
  // Signed in, the -loadfile map already opening: the scan hasn't started (it did 6 s later).
  expect(ladderScan(until(loadfile, "20:35:14.431"))).toMatchObject({ kind: "waiting" });
  expect(ladderScan(until(loadfile, "20:35:18.925"))).toMatchObject({ kind: "scanning", count: 20 });
  // The failures 2.2 s after the scan's last ladder line end it.
  expect(ladderScan(loadfile).kind).toBe("done");
});

test("the scan's batches are one scan: a pause between them, or other lines in it, don't end it", () => {
  // Season1's batch ended at 16:21:19.644, Season9's began 0.6 s later.
  expect(ladderScan(until(menus, "16:21:19.644"))).toMatchObject({ kind: "scanning" });
  expect(ladderScan(until(menus, "16:21:20.318"))).toMatchObject({ kind: "scanning", count: 24 + 20 });
  expect(ladderScan(menus)).toMatchObject({ kind: "done" });
  // The crashed run's Create Game listing opened maps between the batches, under 2 s after Season1's last.
  expect(ladderScan(until(interleaved, "20:30:21.386")).kind).toBe("scanning");
  expect(ladderScan(until(interleaved, "20:30:21.529")).kind).toBe("scanning");
});

test("only the newest session counts, and its start tells one launch's log from the next", () => {
  const next = "10/6 21:00:00.000  GameMain Started\r\n10/6 21:00:01.000  Opening mod - War3.w3mod\r\n";
  expect(ladderScan(`${menus}\r\n${next}`).kind).toBe("signing in");
  expect(sessionStart(menus)).toBeDefined();
  expect(sessionStart(`${menus}\r\n${next}`)).not.toBe(sessionStart(menus));
  expect(sessionStart("")).toBeUndefined();
});

test("socket sign-in permits scan evidence without inventing a missing login line", () => {
  const buffered = "10/6 23:08:33.000  GameMain Started\n10/6 23:08:36.000  Opening map - C:/Maps/Download/Season9/a.w3x\n";
  expect(ladderScan(buffered).kind).toBe("signing in");
  expect(ladderScan(buffered, true)).toMatchObject({ kind: "scanning", count: 1 });
  expect(ladderScan(`${buffered}10/6 23:08:40.000  Opening map - C:/Maps/00-Smashcraft/old.w3x\n`, true)).toMatchObject({ kind: "done" });
  expect(ladderScan("", true)).toEqual({ kind: "waiting" });
});

test("import failures are counted with the first model named; a clean load has none", () => {
  expect(importFailures(loadfile)).toEqual({ count: 7, first: "war3mapImported/ImpactHit-14ab984c85a771b2c9feb68275c44577ceb14d0f5c5f2e3801cbc00c2decd594.mdx" });
  expect(importFailures(menus)).toEqual({ count: 0 });
  expect(importFailures(interleaved)).toEqual({ count: 0 });
});
