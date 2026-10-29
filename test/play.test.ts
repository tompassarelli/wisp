import { expect, test } from "bun:test";
import { type LaunchRequest, launchCommand } from "../host/play/linuxLaunch";
import { launchOutcome, newestLauncherLog, shortcutUrl } from "../host/os/warcraft/battleNet";

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

test("a Proton launch into a clone's container unsets before it assigns, finds its directory inside, and doesn't wait for the running wineserver", () => {
  const env = Bun.which("env")!;
  const request: LaunchRequest = {
    bun: "bun", capacity: "capacity.mjs", client: "clone-c", env, nsenter: Bun.which("true")!, wine: "/proton", proton: true,
    launcher: { pid: 4242, cwd: "/home/tester", env: { PATH: "/usr/bin:/bin" } }, host: { PATH: "/host/bin" },
  };
  const { command } = launchCommand(request);
  expect(command[0]).toBe("systemd-run");
  expect(command).toContain("--wait");
  expect(command).not.toContain("--scope");
  expect(command).toContain("--setenv=DISPLAY=");
  expect(command).toContain("--setenv=WAYLAND_DISPLAY=");
  const outer = command.slice(command.indexOf(env));
  expect(Bun.spawnSync([...outer], { stderr: "pipe" }).exitCode).toBe(0);
  expect(outer).toContain("--wdns=/home/tester");
  expect(outer.slice(outer.indexOf("/proton"), outer.indexOf("/proton") + 2)).toEqual(["/proton", "runinprefix"]);
});
