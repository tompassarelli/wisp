import { expect, test } from "bun:test";
import { launchOptions, launchOutcome, loadMapOption, newestLauncherLog, shortcutUrl, windowsPath, withLaunchOptions } from "../scripts/warcraft/battleNet";

const PREFIX = "/observed/compatdata/pfx";
const MAP = PREFIX + "/drive_c/users/steamuser/Documents/Warcraft III/Maps/00-Smashcraft/Smashcraft 0.0.47.w3x";
const SETTINGS = JSON.stringify({ Client: { AutoLogin: "true" }, Games: { w3: { LastPlayed: "1791240000", ServerUid: "w3" } } }, null, 4).replaceAll("\n", "\r\n");
const LOAD_MAP = '-loadfile "C:\\users\\steamuser\\Documents\\Warcraft III\\Maps\\00-Smashcraft\\Smashcraft 0.0.47.w3x"';
const line = (component: string, text: string) => "I 2026-10-06 01:47:49.901612 [" + component + "] {Main} " + text + "\n";
const LAUNCHED = line("InstallManager", "Game is running: w3");
const COULD_NOT = line("InstallManager", "Could not launch Warcraft III.exe");

test("[native] recorded Battle.net and Steam facts: the shortcut's game id, sign-in and launch lines, the newest log", () => {
  expect(shortcutUrl(3775098022)).toBe("steam://rungameid/16213922543717842944");
  expect(launchOutcome(LAUNCHED)).toEqual({ kind: "running" });
  expect(launchOutcome(COULD_NOT)).toEqual({ kind: "failed", reason: "Battle.net could not start Warcraft III.exe" });
  expect(launchOutcome(line("GameLaunchController", "Pending game launch expired before Agent reported it running. uid=w3"))?.kind).toBe("failed");
  expect(launchOutcome(line("GameLaunchController", "LaunchBinary: uid=w3 selectedRegion=US binaryType=game"))).toBeUndefined();
  expect(newestLauncherLog(["battle.net-20261003T153242.438979.log", "libcef-20261006T014728.217325.log", "battle.net-20261006T014725.384229.log"])).toBe("battle.net-20261006T014725.384229.log");
});

test("[native] Warcraft III's launch options live in Battle.net's settings as Games.w3.AdditionalLaunchArguments, in its own layout", () => {

  expect(launchOptions(JSON.stringify({ Games: { s2: { AdditionalLaunchArguments: "-Displaymode 1" } } }))).toBeUndefined();
  expect(launchOptions(SETTINGS)).toBeUndefined();
  const set = withLaunchOptions(SETTINGS, LOAD_MAP);
  expect(launchOptions(set)).toBe(LOAD_MAP);
  expect(set.split("\r\n")).toContain(`            "AdditionalLaunchArguments": ${JSON.stringify(LOAD_MAP)}`);
  expect(JSON.parse(set).Games.w3.LastPlayed).toBe("1791240000");
  expect(JSON.parse(set).Client.AutoLogin).toBe("true");
  expect(withLaunchOptions(set, undefined)).toBe(SETTINGS);
  expect(loadMapOption(PREFIX, MAP)).toBe(LOAD_MAP);
  expect(windowsPath(PREFIX, `${PREFIX}/drive_c/users/steamuser/Documents/Warcraft III/Maps`)).toBe("C:\\users\\steamuser\\Documents\\Warcraft III\\Maps");
  expect(() => windowsPath(PREFIX, "/home/u/elsewhere.w3x")).toThrow();
});
