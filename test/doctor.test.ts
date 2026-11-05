import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { launcherHealth } from "../host/os/warcraft/battleNet";
import { displayChanges, videoSettings, withDisplaySettings } from "../host/os/warcraft/preferences";

const fixture = (name: string) => readFileSync(join(import.meta.dir, "fixtures/doctor", name), "utf8");
const PLAYED = fixture("launcher-played.log");
const LOST = fixture("launcher-connection-lost.log");
const RECONNECTED = fixture("launcher-reconnected.log");
const REJECTED = fixture("launcher-login-rejected.log");
const SIGNED_IN = PLAYED.split("\n")[0]! + "\n";
const preferences = (name: string) => readFileSync(join(import.meta.dir, "fixtures/preferences", name), "utf8");
const PRIVATE = preferences("private-desktop.txt");
const MAIN = preferences("main-display.txt");
const DISPLAY = Object.fromEntries(["windowmode", "windowwidth", "windowheight", "windowx", "windowy", "reswidth", "resheight", "refreshrate", "maxfps"].map(key => [key, videoSettings(PRIVATE)[key]!]));

test("[native] recorded launcher logs: signed in, a lost connection, a reconnect, a rejected saved login", () => {
  expect(launcherHealth(PLAYED)).toEqual({ kind: "signed in" });
  expect(launcherHealth(LOST)).toEqual({ kind: "connection failing", reason: "its last 3 presence updates timed out (ERROR_RPC_REQUEST_TIMED_OUT)" });

  expect(launcherHealth(LOST.split("\n").slice(0, 3).join("\n")).kind).toBe("signed in");
  expect(launcherHealth(RECONNECTED)).toEqual({ kind: "signed in" });
  expect(launcherHealth(REJECTED).kind).toBe("sign-in needed");
  expect(launcherHealth(REJECTED.split("\n")[0]!)).toEqual({ kind: "not signed in" });

  expect(launcherHealth(`${SIGNED_IN}D 2026-10-06 12:33:38.741703 [CatalogVarStorage] {Main} Setting var from catalog Client.DisableLoginCredentialUIRegionList=CN\n`).kind).toBe("signed in");
});

test("[property seed 8058] preference edits are idempotent, add a missing key to [Video], keep CRLF endings and preserve every unrelated recorded setting", () => {
  for (const source of [MAIN, PRIVATE]) for (const newline of ["\n", "\r\n"]) for (const width of [640, 1280, 1920, 2876]) {
    const before = source.replace(/\r?\n/g, newline);
    const settings = { windowwidth: String(width), bogus: "1" };
    const after = withDisplaySettings(before, settings);
    expect(videoSettings(after)).toMatchObject(settings);
    expect(withDisplaySettings(after, settings)).toBe(after);
    expect(displayChanges(after, settings)).toEqual([]);
    const untouched = (text: string) => text.split(newline).filter(line => !/^(windowwidth|bogus)=/.test(line)).join(newline);
    expect(untouched(after)).toBe(untouched(before));
  }
  {
    expect(displayChanges(PRIVATE, { vsync: "1" })).toEqual([{ key: "vsync", expected: "1", actual: "0" }]);
    expect(displayChanges(PRIVATE, { bogus: "1" })).toEqual([{ key: "bogus", expected: "1" }]);
    const added = withDisplaySettings(PRIVATE, { bogus: "1" });
    expect(videoSettings(added).bogus).toBe("1");
    expect(added.indexOf("bogus=1")).toBeGreaterThan(added.indexOf("[Video]"));
    const crlf = withDisplaySettings(MAIN.replace(/\n/g, "\r\n"), DISPLAY);
    expect(crlf.split("\r\n").length).toBe(MAIN.split("\n").length);
    expect(displayChanges(crlf, DISPLAY)).toEqual([]);
    expect(crlf.replace(/\r\n/g, "\n").split("\n").every((line) => !line.includes("\r"))).toBe(true);

    expect(videoSettings("[Gameplay]\nwindowmode=9\n[Video]\nwindowmode=2\n").windowmode).toBe("2");
  }
});
