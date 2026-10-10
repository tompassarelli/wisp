import { expect, test } from "bun:test";
import { launchOutcome, newestLauncherLog, shortcutUrl } from "../scripts/warcraft/battleNet";

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
