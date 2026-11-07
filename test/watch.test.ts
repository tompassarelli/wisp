import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { prefixUse } from "../host/os/warcraft/battleNet";
import { type ProcessInfo } from "../host/contract/processInfo";
import { sessionStart } from "../host/os/warcraft/war3Log";
import { type CrashReport, type Sources, changes, crashSummary, decide, eventLine } from "../host/dev/watch";

const fixture = (path: string) => readFileSync(join(import.meta.dir, "fixtures", path), "utf8");
const PREFIX = "/clients/a/pfx";
const process = (pid: number, exe: string): ProcessInfo => ({ pid, name: exe.split("\\").at(-1)!, args: [exe], prefix: PREFIX });
const GAME = process(52713, "C:\\Program Files (x86)\\Warcraft III\\_retail_\\x86_64\\Warcraft III.exe");
const LAUNCHER = process(43924, "C:\\Program Files (x86)\\Battle.net\\Battle.net.exe");

const on6Oct = (time: string) => {
  const [hours, minutes, seconds = "0"] = time.split(":");
  return new Date(2026, 9, 6, Number(hours), Number(minutes), Number(seconds)).getTime();
};
const sources = (now: number, processes: readonly ProcessInfo[], extra: Partial<Sources> = {}): Sources => ({
  now,
  prefix: prefixUse(processes, PREFIX, ""),
  crashes: [],
  socket: { connected: false },
  ...extra,
});

const crashFolder = "2026-10-06 13.30.33 f80136c8";
const crash: CrashReport = {
  folder: crashFolder,
  session: sessionStart(fixture(`watch/errors/${crashFolder}/War3Log.txt`))!,
  summary: crashSummary(fixture(`watch/errors/${crashFolder}/Crash.txt`)),
  written: on6Oct("20:30:35"),
};

test("[native] the bad -loadfile run: signed in, ladder scan done, its map's imported models failing", () => {
  const log = fixture("war3log/loadfile-scan-mid-load.txt");
  const seen = decide("a", sources(on6Oct("20:36"), [LAUNCHER, GAME], { log }));
  expect(seen.state).toEqual({ kind: "signed in" });
  expect(seen.source).toBe("log");
  expect(seen.scan).toBe("done");
  expect(seen.loadErrors).toEqual({ count: 7, first: "war3mapImported/ImpactHit-14ab984c85a771b2c9feb68275c44577ceb14d0f5c5f2e3801cbc00c2decd594.mdx" });
  const events = changes(undefined, seen);
  expect(events.map(({ type }) => type)).toEqual(["state", "ladder scan", "load errors"]);
  expect(eventLine(events[2]!)).toContain("load errors: 7 models failed, first war3mapImported/ImpactHit-");
});
