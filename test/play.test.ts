// `play` against a simulated desktop: Steam, the Battle.net launcher and its
// log, the process table, niri's windows and Warcraft's menus are fakes with
// the recorded shapes (the 6 Oct primary-display session: a 2880x1920 output
// at scale 2, Steam shortcut 3775098022, Battle.net 2.53 log lines). Each step
// has its success and its plain failure message.
import { Cause, Clock, Effect, Exit, Layer, Option } from "effect";
import { TestClock } from "effect/testing";
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { hostNsenter } from "../scripts/wisp/playHost";
import { ClientWatch } from "../scripts/wisp/watch";
import { type ProcessInfo, launchOptions, launchOutcome, loadMapOption, newestLauncherLog, prefixUse, shortcutUrl, windowsPath, withLaunchOptions } from "../scripts/warcraft/battleNet";
import type { Word } from "../scripts/warcraft/desktop";
import { type DesktopWindow, type PlayDeclaration, PlayDesktop, PlayMachine, PlayProblem, type XWindow, findPhrase, expectedGain, measuredGain, play, spotTargets, steer, steerPointer, offScreen } from "../scripts/wisp/play";

const PREFIX = "/home/u/compatdata/3516115571/pfx";
const SERVER = "server-24-18d2b7ec";
const LOGS = `${PREFIX}/drive_c/users/steamuser/AppData/Local/Battle.net/Logs`;
const MAP = `${PREFIX}/drive_c/users/steamuser/Documents/Warcraft III/Maps/00-Smashcraft/Smashcraft 0.0.47.w3x`;
const HELPER = "/inputs/wc3-journal";
const HELPER_LOG = "/state/helper.log";
const DEBUG = "/state/play-debug";

test("launch resolves nsenter on the host, before adopting the launcher's PATH", () => {
  const configured = Bun.which("sh")!;
  expect(hostNsenter(configured)).toBe(configured);
  expect(hostNsenter("sh")).toBe(configured);
  expect(() => hostNsenter("wisp-nonexistent-nsenter")).toThrow("host PATH");
});

test("play ignores a newer --exec request log and follows the signed-in launcher's log", async () => {
  const result = await world({ runtimes: "launcher", execRequestLog: true }).run();
  expect(result.failure).toBeUndefined();
  expect(result.events).toContain("launch");
});
const SOURCE = "/inputs/playable-0047/Smashcraft 0.0.47.w3x";
const CONFIG = `${PREFIX}/drive_c/users/steamuser/AppData/Roaming/Battle.net/Battle.net.config`;
const DOCUMENTS = `${PREFIX}/drive_c/users/steamuser/Documents/Warcraft III`;
const PREFERENCES = `${DOCUMENTS}/War3Preferences.txt`;
const BACKUP = `${DOCUMENTS}/War3Preferences-before-play.txt`;
const WAR3LOG = `${PREFIX}/drive_c/users/steamuser/Documents/Warcraft III/Logs/War3Log.txt`;
/** Battle.net's settings, in its own layout: four-space indents, CRLF lines, string values. */
const SETTINGS = JSON.stringify({ Client: { AutoLogin: "true" }, Games: { w3: { LastPlayed: "1791240000", ServerUid: "w3" } } }, null, 4).replaceAll("\n", "\r\n");
const LOAD_MAP = `-loadfile "C:\\users\\steamuser\\Documents\\Warcraft III\\Maps\\00-Smashcraft\\Smashcraft 0.0.47.w3x"`;
const OUTPUT = { name: "eDP-1", width: 1440, height: 960 };
const FRAME = { width: 2880, height: 1920 };
const APP = "steam_app_3775098022";

const line = (component: string, text: string) => `I 2026-10-06 01:47:49.901612 [${component}] {Main} ${text}\n`;
const SIGNED_IN = line("BNLogin", "Logged into Battle.net successfully. |bnet=1:0:0|game=2:0:0");
const REQUESTED = line("GameLaunchController", "LaunchBinary: uid=w3 selectedRegion=US binaryType=game");
const LAUNCHED = line("InstallManager", "Launched C:/Program Files (x86)/Warcraft III/_retail_/x86_64/Warcraft III.exe with args: -launch -uid w3, pid: 2852")
  + line("InstallManager", "Game is running: w3");
const COULD_NOT = line("InstallManager", "Could not launch C:/Program Files (x86)/Warcraft III/_retail_/x86_64/Warcraft III.exe (FAILED)");

const wineserver = (pid: number, extra: Partial<ProcessInfo> = {}): ProcessInfo =>
  ({ pid, name: "wineserver", args: ["/steam/GE-Proton11-7/files/bin/wineserver"], prefix: PREFIX, display: ":0", cwd: `/tmp/.wine-1000/${SERVER}`, ...extra });
const launcher = (pid: number): ProcessInfo =>
  ({ pid, name: "CrBrowserMain", args: ["C:\\Program Files (x86)\\Battle.net\\Battle.net.exe", "--from-launcher"], prefix: PREFIX, display: ":0" });
const launcherChild = (pid: number): ProcessInfo =>
  ({ pid, name: "CrRendererMain", args: ["C:\\Program Files (x86)\\Battle.net\\Battle.net.exe", "--type=renderer"], prefix: PREFIX, display: ":0" });
const gameProcess = (pid: number): ProcessInfo =>
  ({ pid, name: "Warcraft III.ex", args: ["C:\\Program Files (x86)\\Warcraft III\\_retail_\\x86_64\\Warcraft III.exe -launch -uid w3"], prefix: PREFIX, display: ":0" });
const reaper = (pid: number): ProcessInfo => ({ pid, name: "reaper", args: ["/steam/reaper", "SteamLaunch", "AppId=3775098022", "--", "/steam/_v2-entry-point"] });

/** Words of one screen line, centred around `x`. */
function words(id: string, x: number, y: number, text: string): Word[] {
  const parts = text.split(" ");
  return parts.map((part, index) => ({ text: part, x: x + (index - (parts.length - 1) / 2) * 140, y, line: id }));
}

interface Scenario {
  readonly execRequestLog?: boolean;
  /** War3Preferences.txt as the desktop finds it, and a backup an earlier play left. */
  readonly preferences?: string;
  readonly backup?: string;
  readonly runtimes?: "none" | "launcher" | "two" | "other display" | "lingering" | "lingering exits";
  readonly signsIn?: boolean;
  readonly steamStarts?: boolean;
  /** What each launch request logs. */
  readonly launches?: readonly ("running" | "failed" | "ignored")[];
  /** How many first clicks on a phrase Warcraft ignores. */
  readonly ignoredClicks?: Readonly<Record<string, number>>;
  /** Create Game labels its name field "GAME NAME", away from the 2560x1440 position. */
  readonly nameLabel?: boolean;
  readonly mapInstalled?: boolean;
  /** The installed map is an older build than the declared one. */
  readonly mapStale?: boolean;
  /** The copy lands damaged. */
  readonly copyDamaged?: boolean;
  /** Whether the declaration names the map's build, and whether that file is there. */
  readonly mapSource?: "present" | "missing";
  readonly mainMenu?: boolean;
  readonly helper?: "ready" | "exits" | "earlier" | "this game's" | "service" | "service fails";
  readonly fullscreens?: boolean;
  readonly gameRunning?: boolean;
  readonly initialMenu?: "main" | "battle.net";
  readonly matchFails?: boolean;
  /** False: another window takes focus back once the helper runs. */
  readonly gameKeepsFocus?: boolean;
  /** Warcraft III's launch options in Battle.net's settings before the run. */
  readonly launchOptions?: string;
  /** Seconds the game window takes to follow a fullscreen request. */
  readonly gameFullscreenAfter?: number;
  /** False: Warcraft III's log never shows its login doors closing. */
  readonly gameSignsIn?: boolean;
  readonly socketSignedIn?: boolean;
  /** "none": no ladder scan follows the sign-in. */
  readonly ladderScan?: "scans" | "none";
  /** An already running game's log after its scan: nothing more (idle in its menus), or an earlier game. */
  readonly runningLog?: "idle" | "played" | "played unscanned";
  /** The hosted map's imported models fail to load, as in the 6 Oct -loadfile runs. */
  readonly importFailures?: "loading" | "match";
}

/** War3Log's lines as Warcraft III writes them, CRLF ended, timed from 20:34:53 plus the simulated clock. */
const war3Line = (ms: number, text: string) => {
  const at = new Date(Date.UTC(2026, 9, 6, 20, 34, 53) + ms);
  const two = (value: number) => String(value).padStart(2, "0");
  return `10/6 ${two(at.getUTCHours())}:${two(at.getUTCMinutes())}:${two(at.getUTCSeconds())}.${String(at.getUTCMilliseconds()).padStart(3, "0")}  ${text}\r\n`;
};
const ladder = (season: number, maps: readonly string[]) =>
  maps.flatMap((map) => ["map", "mod"].map((kind) => `Opening ${kind} - C:/users/steamuser/Documents/Warcraft III/Maps/Download/Season${season}/${map}.w3x`));
/** The 6 Oct post-login ladder scan's batches (abridged). */
const SEASON1 = ladder(1, ["(2)NorthernIsles_S2", "(4)LostTemple_S2", "(2)ConcealedHill_S2"]);
const SEASON9 = ladder(9, ["(2)EchoIsles_S2_v2.2", "(4)TwistedMeadows_S2_v1.1", "(2)Hammerfall_S3"]);

interface Button {
  readonly phrase: string;
  /** Text the reader separates as white; all else is light. */
  readonly white?: boolean;
  readonly x: number;
  readonly y: number;
  /** The words the reader makes of it, when recorded; otherwise the phrase's words around x. */
  readonly read?: readonly Word[];
  readonly press: () => void;
}

/** A desktop and machine that behave like the recorded ones. */
function world(scenario: Scenario = {}) {
  let processes: ProcessInfo[] = [];
  const logs = new Map<string, string>();
  const windows = new Map<number, DesktopWindow>();
  const pending: { at: number; run: () => void }[] = [];
  const events: string[] = [];
  let now = 0;
  let focused: number | undefined;
  let menu: string = scenario.initialMenu ?? "main";
  let name = "Tompas's game";
  let started = false;
  let presses = 0;
  let battleNetReads = 0;
  const ignored = new Map(Object.entries(scenario.ignoredClicks ?? {}));
  let mapInstalled = scenario.mapInstalled !== false;
  const prefFiles = new Map<string, string>([...(scenario.preferences === undefined ? [] : [[PREFERENCES, scenario.preferences] as [string, string]]), ...(scenario.backup === undefined ? [] : [[BACKUP, scenario.backup] as [string, string]])]);
  let mapDigest = scenario.mapStale === true ? "old build" : "this build";
  let config = withLaunchOptions(SETTINGS, scenario.launchOptions);
  /** What Battle.net read from its settings when it started. */
  let launcherOptions = launchOptions(config);
  const shots: string[] = [];
  const clickLog: string[] = [];
  let helperLog = "";
  let helperStarted = false;
  let nextPid = 3000;
  const launchesLeft = [...(scenario.launches ?? ["running"])];
  /** Warcraft III's log: an earlier session's, which a new launch replaces. */
  let war3Log = [
    war3Line(-600_000, "GameMain Started"), war3Line(-586_000, "[CLoginCallbacks] LoginDoorClose called"),
    ...[...SEASON1, ...SEASON9].map((text) => war3Line(-577_000, text)), war3Line(-500_000, "GameMain Ended"),
  ].join("");
  const logged = (...lines: string[]) => { war3Log += lines.map((text) => war3Line(now, text)).join(""); };

  const later = (seconds: number, run: () => void) => pending.push({ at: now + seconds * 1000, run });
  const tick = Clock.currentTimeMillis.pipe(Effect.map((time) => {
    now = time;
    for (const event of pending.filter(({ at }) => at <= time)) {
      pending.splice(pending.indexOf(event), 1);
      event.run();
    }
  }));
  const tiled = (id: number, title: string): DesktopWindow => ({ id, title, appId: APP, focused: false, width: 1424, height: 920, output: OUTPUT });
  const startLauncher = () => {
    const log = `battle.net-20261006T0${2 + logs.size}0000.000000.log`;
    processes.push(reaper(90), wineserver(100), launcher(101), launcherChild(102));
    launcherOptions = launchOptions(config);
    logs.set(log, line("Main", "Logging started for Battle.net build 2.53.4.17896"));
    windows.set(758, tiled(758, "Battle.net"));
    if (scenario.signsIn !== false) later(2, () => logs.set(log, logs.get(log)! + SIGNED_IN));
  };
  const newestLog = () => newestLauncherLog([...logs.keys()])!;
  /** A new session's log, as on 6 Oct: the login doors close 14 s after start, the ladder scan 9 s later. */
  const signIn = () => {
    // The launch's own log replaces the earlier one a moment after the process starts.
    later(1, () => {
      war3Log = "";
      logged("GameMain Started", "Opening mod - War3.w3mod", ...SEASON1, ...SEASON9);
    });
    if (scenario.gameSignsIn === false) return;
    later(14, () => logged("[CLoginCallbacks] LoginDoorClose called", "Activating WebUI"));
    if (scenario.ladderScan === "none") return;
    later(23, () => logged(...SEASON1));
    later(23.5, () => logged(...SEASON9));
    later(24, () => events.push("ladder maps read"));
  };
  const startGame = () => {
    processes.push(gameProcess(2852));
    windows.set(762, tiled(762, "Warcraft III"));
    signIn();
  };

  switch (scenario.runtimes ?? "none") {
    case "launcher":
      startLauncher();
      logs.set(newestLog(), logs.get(newestLog())! + (scenario.execRequestLog ? readFileSync(join(import.meta.dir, "fixtures/doctor/launcher-played.log"), "utf8") : SIGNED_IN));
      if (scenario.execRequestLog) logs.set("battle.net-20261006T235959.000000.log", readFileSync(join(import.meta.dir, "fixtures/doctor/launcher-exec.log"), "utf8"));
      pending.length = 0;
      break;
    case "two":
      startLauncher();
      // A second Steam runtime's wineserver: its own namespace, the same prefix directory.
      processes.push({ pid: 200, name: "wineserver", args: ["/steam/GE-Proton11-7/files/bin/wineserver"], cwd: `/tmp/.wine-1000/${SERVER}` });
      break;
    case "other display":
      processes.push(wineserver(100, { display: ":1" }), launcher(101));
      break;
    case "lingering":
    case "lingering exits":
      processes.push(wineserver(100));
      if (scenario.runtimes === "lingering exits") later(3, () => { processes = []; });
      break;
  }
  if (scenario.gameRunning === true) {
    processes.push(gameProcess(2852));
    windows.set(762, tiled(762, "Warcraft III"));
    const unscanned = scenario.runningLog === "played unscanned";
    war3Log = [war3Line(-60_000, "GameMain Started"), ...(scenario.socketSignedIn === true ? [] : [war3Line(-46_000, "[CLoginCallbacks] LoginDoorClose called")]), ...(unscanned ? [] : [...SEASON1, ...SEASON9].map((text) => war3Line(-37_000, text))),
      ...(scenario.runningLog === "played" || unscanned ? [war3Line(unscanned ? -10_000 : -20_000, "Opening map - C:/users/steamuser/Documents/Warcraft III/Maps/00-Smashcraft/Smashcraft 0.0.47.w3x")] : [])].join("");
  }
  if (scenario.helper === "earlier") processes.push({ pid: 400, name: "wc3-journal", args: [HELPER, "--pid", "1"] });
  if (scenario.helper === "this game's") processes.push({ pid: 401, name: "wc3-journal", args: [HELPER, "--pid", "2852"] });

  const gameButtons = (): Button[] => {
    const go = (next: string) => () => { menu = next; };
    switch (menu) {
      case "main": return scenario.mainMenu === false ? [] : [
        { phrase: "SINGLE PLAYER", x: 2218, y: 750, press: go("single") },
        { phrase: "MULTIPLAYER", x: 2218, y: 965, press: go("battle.net") },
      ];
      // Recorded 6 Oct: the tabs slide 32 px down within 0.3 s of appearing.
      case "battle.net": return [
        { phrase: "VERSUS", x: 610, y: battleNetReads <= 1 ? 132 : 153, press: () => {} },
        { phrase: "CUSTOM GAMES", x: 1058, y: battleNetReads <= 1 ? 132 : 164, press: go("custom games") },
      ];
      case "custom games": return [{ phrase: "CUSTOM GAMES", x: 800, y: 120, press: () => {} }, { phrase: "CREATE GAME", x: 2013, y: 1601, press: go("create") }];
      case "create":
      case "folder":
      case "selected": {
        const list: Button[] = menu === "create"
          ? [{ phrase: "00-SMASHCRAFT", x: 1550, y: 490, press: go("folder") }, { phrase: "DOWNLOAD", x: 1550, y: 560, press: () => {} }]
          : [{ phrase: "SMASHCRAFT 0.0.47", x: 1550, y: 490, press: go("selected") }, { phrase: "SMASHCRAFT INPUT PROBE", x: 1550, y: 560, press: () => {} }];
        return [
          { phrase: "REATE GAME", x: 300, y: 243, press: () => {} },
          ...(scenario.nameLabel === true
            ? [{ phrase: "GAME NAME", x: 200, y: 400, press: () => {} }, { phrase: name, x: 200, y: 453, press: () => events.push("name field") }]
            : [{ phrase: name, x: 533, y: 453, press: () => events.push("name field") }]),
          ...list,
          ...(menu === "selected" ? [{ phrase: "SMASHCRAFT 0.0.47", x: 2600, y: 240, press: () => {} }, { phrase: "SUGGESTED PLAYERS: 4", x: 2600, y: 970, press: () => {} }] : []),
          { phrase: "CREATE GAME", x: 2600, y: 1501, press: () => { if (menu === "selected") menu = "lobby"; } },
        ];
      }
      case "lobby": return [{ phrase: "SMASHCRAFT 0.0.47", x: 2600, y: 240, press: () => {} }, { phrase: "START GAME", x: 2593, y: 1503, press: () => {
        menu = "selection";
        logged("Opening map - C:/users/steamuser/Documents/Warcraft III/Maps/00-Smashcraft/Smashcraft 0.0.47.w3x");
        if (scenario.importFailures === "loading") later(4, () => logged(...["ImpactHit", "StageMainDeck", "IllidanOriginalClip39"].map((model) => `model creation failed - war3mapImported/${model}-14ab984c.mdx`)));
        later(8, () => { started = true; });
      } }];
      default: return [];
    }
  };
  const requestLaunch = () => {
    presses++;
    events.push("launch");
    const outcome = launchesLeft.shift() ?? "running";
    later(1, () => {
      const ownerLog = [...logs.keys()].findLast((name) => logs.get(name)!.includes("[BNLogin]")) ?? newestLog();
      if (outcome !== "ignored") logs.set(ownerLog, logs.get(ownerLog)! + REQUESTED + (outcome === "running" ? LAUNCHED : COULD_NOT));
      if (outcome === "running") startGame();
    });
  };
  const screenOf = () => {
    const window = focused === undefined ? undefined : windows.get(focused);
    if (window === undefined || window.width !== OUTPUT.width) return [];
    return window.title === "Battle.net" ? [] : gameButtons();
  };

  const machine = PlayMachine.of({
    processes: tick.pipe(Effect.map(() => [...processes])),
    serverDirectory: () => Effect.succeed(SERVER),
    signal: (pids, signal) => Effect.sync(() => {
      events.push(`${signal} ${pids.join(" ")}`);
      later(1, () => { processes = processes.filter((process) => !pids.includes(process.pid) && process.pid !== 90); });
    }),
    launch: (launcher) => Effect.sync(() => {
      expect(processes.some(({ pid }) => pid === launcher.pid)).toBe(true);
      requestLaunch();
    }),
    openSteam: (url) => Effect.sync(() => {
      events.push(`steam ${url}`);
      if (scenario.steamStarts !== false) later(1, startLauncher);
    }),
    start: (command, log) => Effect.sync(() => {
      const pid = nextPid++;
      events.push(`start ${command.join(" ")} > ${log}`);
      helperStarted = true;
      processes.push({ pid, name: "wc3-journal", args: command });
      if (scenario.helper === "exits") {
        helperLog += "wc3-journal: no controller at /dev/input/event9\n";
        processes = processes.filter((process) => process.pid !== pid);
      } else later(1, () => { helperLog += "waiting_for_match build=b slot=0 start_before=final-match-confirmation\n"; });
      return pid;
    }),
    read: (path, from = 0) => tick.pipe(Effect.map(() => {
      if (path === HELPER_LOG) return helperLog.slice(from);
      if (path === CONFIG) return config.slice(from);
      if (prefFiles.has(path)) return prefFiles.get(path)!.slice(from);
      if (path === WAR3LOG) return war3Log.slice(from);
      const text = path.startsWith(`${LOGS}/`) ? logs.get(path.slice(LOGS.length + 1)) : undefined;
      return text?.slice(from);
    })),
    size: (path) => Effect.sync(() => {
      if (path === MAP) return mapInstalled ? 38_579_096 : undefined;
      if (path === SOURCE) return scenario.mapSource === "present" ? 38_579_096 : undefined;
      if (path === HELPER_LOG) return helperLog.length;
      return path.startsWith(`${LOGS}/`) ? logs.get(path.slice(LOGS.length + 1))?.length : undefined;
    }),
    digest: (path) => Effect.sync(() => {
      if (path === MAP) return mapInstalled ? mapDigest : undefined;
      if (path === SOURCE) return scenario.mapSource === "present" ? "this build" : undefined;
      return undefined;
    }),
    list: (directory) => Effect.sync(() => (directory === LOGS ? [...logs.keys(), "libcef-20261006T014728.217325.log"] : [])),
    write: (path, text) => Effect.sync(() => {
      if (path === PREFERENCES || path === BACKUP) {
        events.push(`write ${path.slice(DOCUMENTS.length + 1)}`);
        prefFiles.set(path, text);
        return;
      }
      expect(path).toBe(CONFIG);
      expect(text).toContain("\r\n    \"Client\": {");
      config = text;
      events.push(`launch options: ${launchOptions(text) ?? "none"}`);
    }),
    copy: (from, to) => Effect.sync(() => {
      events.push(`copy ${from} -> ${to}`);
      mapInstalled = true;
      mapDigest = scenario.copyDamaged === true ? "truncated" : "this build";
    }),
    append: (path, text) => Effect.sync(() => {
      expect(path).toBe(`${DEBUG}/1970-01-01T00-00-00-000Z/clicks.log`);
      clickLog.push(text);
    }),
  });

  const desktop = PlayDesktop.of({
    windows: tick.pipe(Effect.map(() => [...windows.values()].map((window) => ({ ...window, focused: window.id === focused })))),
    focus: (id) => Effect.sync(() => { focused = scenario.gameKeepsFocus === false && helperStarted ? 758 : id; }),
    toggleFullscreen: (id) => Effect.sync(() => {
      const window = windows.get(id)!;
      events.push(`fullscreen ${window.title}`);
      if (scenario.fullscreens === false) return;
      const flip = () => {
        const now = windows.get(id)!;
        windows.set(id, now.width === OUTPUT.width ? { ...now, width: 1424, height: 920 } : { ...now, width: OUTPUT.width, height: OUTPUT.height });
      };
      // Run 10, 6 Oct: the game loading its map took more than 5 s to follow.
      if (window.title === "Warcraft III" && scenario.gameFullscreenAfter !== undefined) later(scenario.gameFullscreenAfter, flip);
      else flip();
    }),
    read: (output, ink) => Effect.sync(() => {
      expect(output).toBe(OUTPUT.name);
      if (menu === "battle.net") battleNetReads++;
      const shown = screenOf().filter((button) => (button.white === true) === (ink === "white"));
      return { ...FRAME, words: shown.flatMap((button, index) => button.read ?? words(`b${index}`, button.x, button.y, button.phrase)) };
    }),
    snapshot: (output, path) => Effect.sync(() => {
      expect(output).toBe(OUTPUT.name);
      shots.push(path.slice(path.lastIndexOf("/") + 1));
    }),
    xWindow: (title) => Effect.succeed<XWindow | undefined>(
      [...windows.values()].some((window) => window.title === title) ? { id: title, x: 0, y: 0, ...FRAME } : undefined),
    click: (spot) => Effect.sync(() => {
      expect(spot.output).toBe(OUTPUT.name);
      // The spot's image and window cover the output, so the target is in the capture's pixels.
      const { root } = spotTargets(spot, { x: 0, y: 0, width: OUTPUT.width, height: OUTPUT.height });
      // Within the words of the phrase, which words() spaces 140 pixels apart.
      const hit = screenOf().find((button) => Math.abs(button.x - root.x) <= 70 * (button.phrase.split(" ").length - 1) + 60 && Math.abs(button.y - root.y) <= 30);
      events.push(`click ${spot.window.id} ${hit?.phrase ?? `${root.x},${root.y}`}`);
      const ignoring = hit === undefined ? 0 : ignored.get(hit.phrase) ?? 0;
      if (hit !== undefined && ignoring > 0) {
        ignored.set(hit.phrase, ignoring - 1);
        events.push("ignored");
      } else hit?.press();
      return [`moved to X ${root.x},${root.y}`];
    }),
    keys: (_window, ...keys) => Effect.sync(() => events.push(`keys ${keys.join(" ")}`)),
    typeText: (_window, text) => Effect.sync(() => {
      events.push(`type ${text}`);
      name = text;
    }),
  });

  const declaration: PlayDeclaration = {
    prefix: PREFIX,
    display: ":0",
    shortcut: { appId: 3775098022, name: "Warcraft III (Battle.net)" },
    map: { folder: "00-Smashcraft", file: "Smashcraft 0.0.47.w3x", title: "Smashcraft 0.0.47", ...(scenario.mapSource === undefined ? {} : { source: SOURCE }) },
    gameName: "Smashcraft",
    debugDirectory: DEBUG,
    prepare: (documents) => Effect.sync(() => {
      expect(documents).toBe(`${PREFIX}/drive_c/users/steamuser/Documents/Warcraft III`);
      events.push("prepare");
    }),
    cleanup: () => Effect.sync(() => { events.push("cleanup"); }),
    started: () => Effect.gen(function*() {
      for (let waited = 0; !started; waited++) {
        if (waited > 480) return yield* new PlayProblem({ problem: "the map didn't reach fighter selection within 120 s" });
        yield* Effect.sleep("250 millis");
        yield* tick;
      }
    }),
    match: () => Effect.gen(function*() {
      events.push("match");
      if (scenario.importFailures === "match") logged("model creation failed - war3mapImported/ImpactHit-14ab984c.mdx");
      if (scenario.matchFails === true) return yield* new PlayProblem({ problem: "the map refused the playtest request" });
      return "computer as Player 3";
    }),
    helper: scenario.helper === "service" || scenario.helper === "service fails"
      ? { service: (game) => scenario.helper === "service" ? Effect.succeed(`the controller service serves this game (pid ${game.pid})`) : Effect.fail(new PlayProblem({ problem: "the controller service isn't running" })) }
      : { binary: HELPER, ready: /waiting_for_match/, log: HELPER_LOG, args: (game) => Effect.succeed(["--pid", String(game.pid)]) },
  };

  const run = async () => {
    const lines: string[] = [];
    const playing = play(declaration, (status) => lines.push(status));
    const watched = scenario.socketSignedIn === true ? playing.pipe(Effect.provideService(ClientWatch, ClientWatch.of({ view: () => Effect.succeed({ client: "the game", state: { kind: "menus", screen: "MAIN_MENU" }, source: "socket", evidence: "SetGlueScreen MAIN_MENU", at: now * 1000, scan: "signing in", loadErrors: { count: 0 } }) }))) : playing;
    const program = watched.pipe(
      Effect.provide(Layer.merge(Layer.succeed(PlayMachine, machine), Layer.succeed(PlayDesktop, desktop))),
    );
    const exit = await Effect.runPromise(Effect.gen(function*() {
      const fiber = yield* Effect.forkChild(program);
      for (let step = 0; step < 4000 && fiber.pollUnsafe() === undefined; step++) {
        yield* Effect.yieldNow;
        yield* TestClock.adjust("250 millis");
      }
      return fiber.pollUnsafe();
    }).pipe(Effect.provide(TestClock.layer())));
    if (exit === undefined) throw new Error("play did not finish within 1000 simulated seconds");
    const error = Exit.isFailure(exit) ? Cause.findErrorOption(exit.cause) : Option.none();
    if (Exit.isFailure(exit) && Option.isNone(error)) throw new Error(Cause.pretty(exit.cause));
    const failure = Option.isSome(error) ? error.value.message : undefined;
    return { lines, failure, events, prefFiles, presses: () => presses, windows, shots, clickLog, options: () => launchOptions(config) };
  };
  return { run };
}

test("recorded Battle.net and Steam facts: the shortcut's game id, sign-in and launch lines, the newest log", () => {
  expect(shortcutUrl(3775098022)).toBe("steam://rungameid/16213922543717842944");
  expect(launchOutcome(LAUNCHED)).toEqual({ kind: "running" });
  expect(launchOutcome(COULD_NOT)).toEqual({ kind: "failed", reason: "Battle.net could not start Warcraft III.exe" });
  expect(launchOutcome(line("GameLaunchController", "Pending game launch expired before Agent reported it running. uid=w3"))?.kind).toBe("failed");
  expect(launchOutcome(line("GameLaunchController", "LaunchBinary: uid=w3 selectedRegion=US binaryType=game"))).toBeUndefined();
  expect(newestLauncherLog(["battle.net-20261003T153242.438979.log", "libcef-20261006T014728.217325.log", "battle.net-20261006T014725.384229.log"])).toBe("battle.net-20261006T014725.384229.log");
});

test("Warcraft III's launch options live in Battle.net's settings as Games.w3.AdditionalLaunchArguments, in its own layout", () => {
  // As an older Battle.net install recorded StarCraft II's: Games.s2.AdditionalLaunchArguments "-Displaymode 1".
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

test("a prefix's runtimes are its wineservers, found by WINEPREFIX or by the server directory a namespaced one keeps", () => {
  const other: ProcessInfo = { pid: 7, name: "wineserver", args: ["wineserver"], prefix: "/home/u/client-b/pfx", cwd: "/tmp/.wine-1000/server-24-197e7cc9" };
  const namespaced: ProcessInfo = { pid: 8, name: "wineserver", args: ["wineserver"], cwd: `/tmp/.wine-1000/${SERVER}` };
  const use = prefixUse([wineserver(1), launcher(2), launcherChild(3), gameProcess(4), other, namespaced, reaper(5)], `${PREFIX}/`, SERVER);
  expect(use.runtimes.map(({ pid }) => pid)).toEqual([1, 8]);
  expect(use.launcher?.pid).toBe(2);
  expect(use.game?.pid).toBe(4);
  expect(use.processes.map(({ pid }) => pid)).toEqual([1, 2, 3, 4, 8]);
});

test("phrases are found however the reader split or misread them, and list entries only as a whole line", () => {
  const seen = [
    ...words("a", 1550, 490, "00- SMASHCRAFT"),
    ...words("b", 1550, 560, "SMASHCRAFT O.0.47"),
    ...words("c", 1550, 630, "SMASHCRAFT 0.0.47 PROBE"),
    ...words("d", 2218, 965, "MULTlPLAYER"),
  ];
  expect(findPhrase(seen, "00-Smashcraft", true)).toEqual([{ x: 1550, y: 490 }]);
  expect(findPhrase(seen, "Smashcraft 0.0.47", true)).toEqual([{ x: 1550, y: 560 }]);
  expect(findPhrase(seen, "Smashcraft 0.0.47")).toHaveLength(2);
  expect(findPhrase(seen, "Multiplayer")).toEqual([{ x: 2218, y: 965 }]);
  expect(findPhrase(seen, "Smash")).toEqual([]);
});

test("a click target maps to the compositor's logical pixels and the X root's pixels of the scaled owner's desktop", () => {
  // 6 Oct: eDP-1 is 1440x960 logical at scale 2; grim's capture and the X root are 2880x1920. The
  // launcher's Play read at 2075,1518 while the X pointer sat at 1194,882, where the compositor's pointer was.
  const output = { x: 0, y: 0, width: 1440, height: 960 };
  const spot = { output: "eDP-1", area: FRAME, x: 2075, y: 1518, window: { id: "100663313", x: 0, y: 0, ...FRAME } };
  expect(spotTargets(spot, output)).toEqual({ logical: { x: 1037.5, y: 759 }, root: { x: 2075, y: 1518 } });
  expect(steer({ x: 1194, y: 882 }, spotTargets(spot, output).root, expectedGain(spot, output))).toEqual({ dx: 440.5, dy: 318 });
  // A second output to the right: logical positions shift, X pixels follow the window.
  const right = { ...spot, output: "HDMI-A-1", window: { ...spot.window, x: 2880 } };
  expect(spotTargets(right, { ...output, x: 1440 })).toEqual({ logical: { x: 2477.5, y: 759 }, root: { x: 4955, y: 1518 } });
  // An output capture's coordinates do not change when its target window is letterboxed.
  const letterboxed = { ...spot, x: 480, y: 82, window: { ...spot.window, x: 690, y: 40, width: 1500, height: 1840 } };
  expect(spotTargets(letterboxed, output)).toEqual({ logical: { x: 240, y: 41 }, root: { x: 480, y: 82 } });
  expect(expectedGain(letterboxed, output)).toEqual({ x: 2, y: 2 });
});

/** A compositor pointer whose moves reach the X pointer at `gain` X pixels per logical pixel, rounded as Xwayland reports them. */
const simulatedPointer = (start: { x: number; y: number }, gain: number, moves: string[]) => {
  let at = start;
  return (dx: number, dy: number) => Effect.sync(() => {
    at = { x: at.x + Math.round(dx * gain), y: at.y + Math.round(dy * gain) };
    moves.push(`${dx.toFixed(1)},${dy.toFixed(1)}`);
    return at;
  });
};

test("the pointer is steered by the gain each move shows: 2 over the launcher, 1 over fullscreen Warcraft III holding the pointer", async () => {
  const output = { x: 0, y: 0, width: 1440, height: 960 };
  const spot = (x: number, y: number) => ({ output: "eDP-1", area: FRAME, x, y, window: { id: "w", x: 0, y: 0, ...FRAME } });
  // Run 5, 6 Oct: Custom Games at 1049,132 from 2218,966. At the assumed gain 2 every move went half way:
  // -584.5,-417.0 -> 1634,549; -292.5,-208.5 -> 1342,341; -146.5,-104.5 -> 1196,237; -73.5,-52.5 -> 1123,185.
  expect(measuredGain({ x: 2, y: 2 }, { dx: -584.5, dy: -417 }, { x: 1634 - 2218, y: 549 - 966 })).toEqual({ x: 584 / 584.5, y: 1 });
  const target = spot(1049, 132);
  const moves: string[] = [];
  const steered = await Effect.runPromise(steerPointer({ x: 2218, y: 966 }, target, expectedGain(target, output), 2, simulatedPointer({ x: 2218, y: 966 }, 1, moves)));
  expect(steered.arrived).toBe(true);
  expect(moves).toEqual(["-584.5,-417.0", "-585.5,-417.0"]);
  expect(steered.trace[1]).toBe("moved -584.5,-417.0 -> X 1634,549 (gain 1.00,1.00)");
  // Run 5's first click, Multiplayer at 2219,966 from 232,1762, went in one move at gain 2.
  const multiplayer: string[] = [];
  const first = await Effect.runPromise(steerPointer({ x: 232, y: 1762 }, { x: 2219, y: 966 }, expectedGain(spot(2219, 966), output), 2, simulatedPointer({ x: 232, y: 1762 }, 2, multiplayer)));
  expect(first.arrived).toBe(true);
  expect(multiplayer).toEqual(["993.5,-398.0"]);
  // A pointer that doesn't move keeps its gain and stops after the cap.
  const stuck = await Effect.runPromise(steerPointer({ x: 10, y: 10 }, { x: 500, y: 500 }, { x: 2, y: 2 }, 2, () => Effect.succeed({ x: 10, y: 10 })));
  expect(stuck.arrived).toBe(false);
  expect(stuck.trace).toHaveLength(9);
});

test("from a cold desktop: Battle.net, its launch of Warcraft III, the map hosted once Warcraft III has read its ladder maps, the helper, the match, the game fullscreen", async () => {
  const result = await world().run();
  expect(result.failure).toBeUndefined();
  expect(result.lines).toEqual([
    "Captures and click log: /state/play-debug/1970-01-01T00-00-00-000Z",
    "1/7 Wine prefix: free",
    "2/7 Battle.net: starting the Steam shortcut \"Warcraft III (Battle.net)\"",
    "2/7 Battle.net: started and signed in (3 s)",
    "3/7 Warcraft III: Battle.net started it",
    "3/7 Warcraft III: running (pid 2852), asked to go fullscreen",
    "4/7 Map: Warcraft III signed in and read its ladder maps (27 s); hosting the map",
    "4/7 Map: \"Smashcraft\" of Smashcraft 0.0.47 hosted through the menus (joining by name is case-sensitive)",
    "4/7 Map: fighter selection 35 s after launch",
    "5/7 Controller helper: running (pid 3000), log /state/helper.log",
    "6/7 Match: computer as Player 3",
    "7/7 Fullscreen: Warcraft III is fullscreen and focused. Ready to fight.",
  ]);
  // The earlier session's log, which says its scan was over, doesn't count: nothing in the game is clicked
  // before this launch's scan. Battle.net's launch options stay untouched and no key reaches the game.
  const scanned = result.events.indexOf("ladder maps read");
  expect(scanned).toBeGreaterThan(result.events.indexOf("launch"));
  expect(result.events.findIndex((event) => event.startsWith("click Warcraft III"))).toBeGreaterThan(scanned);
  expect(result.events.filter((event) => event.startsWith("launch options") || event.startsWith("press"))).toEqual([]);
  // The launcher's window is neither clicked, read nor resized: Battle.net launches the game on request.
  expect(result.events.filter((event) => event.includes("Battle.net"))).toEqual([]);
  // A picture before and after every click, and one click log line each with its pointer moves.
  expect(result.shots.slice(0, 2)).toEqual(["01-multiplayer-before.jpg", "01-multiplayer-after.jpg"]);
  expect(result.windows.get(758)?.width).toBe(1424);
  expect(result.windows.get(762)?.width).toBe(OUTPUT.width);
});

test("a warm launcher is reused; an earlier run's startup map argument is cleared and another map's refused", async () => {
  const warm = await world({ runtimes: "launcher", launchOptions: "-windowmode 0" }).run();
  expect(warm.failure).toBeUndefined();
  expect(warm.lines[2]).toBe("2/7 Battle.net: signed in; reusing it");
  expect(warm.events.filter((event) => event.startsWith("SIG") || event.startsWith("steam") || event.startsWith("launch options"))).toEqual([]);
  expect(warm.options()).toBe("-windowmode 0");
  // Earlier Wisp runs could keep -loadfile for this map; Battle.net reads it at its start, so it restarts once.
  const kept = await world({ runtimes: "launcher", launchOptions: LOAD_MAP }).run();
  expect(kept.failure).toBeUndefined();
  expect(kept.lines[2]).toBe("2/7 Battle.net: clearing an earlier run's startup map from Warcraft III's launch options");
  expect(kept.events.filter((event) => event.startsWith("SIG") || event.startsWith("steam") || event.startsWith("launch options"))).toEqual([
    "SIGTERM 100 101 102", "launch options: none", "steam steam://rungameid/16213922543717842944",
  ]);
  expect(kept.options()).toBeUndefined();
  const otherMap = await world({ runtimes: "launcher", launchOptions: '-loadfile "C:\\other.w3x"' }).run();
  expect(otherMap.failure).toBe("2/7 Battle.net stopped: Battle.net is set to load another map at startup. Clear its additional command line arguments for Warcraft III and restart Battle.net, then run play again.");
  expect(otherMap.events.filter((event) => event.startsWith("SIG") || event.startsWith("launch options"))).toEqual([]);
  // A run that stops removes what prepare left, and only then.
  const stopped = await world({ helper: "exits" }).run();
  expect(stopped.events.at(-1)).toBe("cleanup");
  expect(warm.events).not.toContain("cleanup");
});

test("Warcraft III already past its ladder scan is hosted without waiting for one", async () => {
  // An earlier game after the scan: the log shows the scan over at once.
  const played = await world({ runtimes: "launcher", gameRunning: true, runningLog: "played" }).run();
  expect(played.failure).toBeUndefined();
  expect(played.lines.slice(1, 6)).toEqual([
    "1/7 Wine prefix: Battle.net already running in its only runtime (pid 101)",
    "2/7 Battle.net: signed in; Warcraft III already runs",
    "3/7 Warcraft III: already running (pid 2852)",
    "3/7 Warcraft III: running (pid 2852), asked to go fullscreen",
    "4/7 Map: Warcraft III signed in and read its ladder maps (0 s); hosting the map",
  ]);
  expect(played.events.filter((event) => event.startsWith("steam") || event === "launch" || event.startsWith("launch options"))).toEqual([]);
  expect(played.events).toContain("click Warcraft III START GAME");
  // A game that never scanned but has played since, more than 30 s after its sign-in by its log, isn't made to wait 30 s more.
  const unscanned = await world({ runtimes: "launcher", gameRunning: true, runningLog: "played unscanned" }).run();
  expect(unscanned.failure).toBeUndefined();
  expect(unscanned.lines[5]).toBe("4/7 Map: Warcraft III signed in and read no ladder maps within 30 s; hosting the map");
  expect(unscanned.lines.find((line) => line.includes("fighter selection"))).toBe(played.lines.find((line) => line.includes("fighter selection")));
  // Idle in its menus since the scan, the log ends with it: 2 s of quiet decide.
  const idle = await world({ runtimes: "launcher", gameRunning: true }).run();
  expect(idle.failure).toBeUndefined();
  expect(idle.lines[5]).toBe("4/7 Map: Warcraft III signed in and read its ladder maps (2 s); hosting the map");
});

test("menu hosting resumes a warm Warcraft client already showing Custom Games", async () => {
  const result = await world({ runtimes: "launcher", gameRunning: true, initialMenu: "battle.net" }).run();
  expect(result.failure).toBeUndefined();
  expect(result.events).toContain("click Warcraft III CUSTOM GAMES");
  expect(result.events).not.toContain("click Warcraft III MULTIPLAYER");
});

test("socket-authenticated menus can host when the running game's log lacks LoginDoorClose", async () => {
  const result = await world({ runtimes: "launcher", gameRunning: true, socketSignedIn: true }).run();
  expect(result.failure).toBeUndefined();
  expect(result.events).toContain("match");
});

test("a game that scans no ladder maps is hosted 30 s after its sign-in; one that never signs in stops play", async () => {
  const unscanned = await world({ ladderScan: "none" }).run();
  expect(unscanned.failure).toBeUndefined();
  expect(unscanned.lines).toContain("4/7 Map: Warcraft III signed in and read no ladder maps within 30 s; hosting the map");
  const unsigned = await world({ gameSignsIn: false }).run();
  expect(unsigned.failure).toBe(`4/7 Map stopped: Warcraft III didn't sign in within 120 s (its log, ${WAR3LOG}, shows no LoginDoorClose)`);
  expect(unsigned.events.some((event) => event.startsWith("click Warcraft III"))).toBe(false);
});

test("play stops when Warcraft III's log shows the map's imported models failing, at load or once the match starts", async () => {
  const loading = await world({ importFailures: "loading" }).run();
  expect(loading.failure).toBe(`4/7 Map stopped: Warcraft III couldn't create 3 of the map's imported models (its log: ${WAR3LOG}, first "model creation failed - war3mapImported/ImpactHit-14ab984c.mdx"), so the stage and fighters won't draw. Quit Warcraft III and run play again.`);
  expect(loading.events.some((event) => event.startsWith(`start ${HELPER}`))).toBe(false);
  expect(loading.events.at(-1)).toBe("cleanup");
  const match = await world({ importFailures: "match" }).run();
  expect(match.failure).toStartWith("6/7 Match stopped: Warcraft III couldn't create 1 of the map's imported models");
  // Failures an earlier map logged in a running game's session are not this map's.
  const earlier = await world({ runtimes: "launcher", gameRunning: true }).run();
  expect(earlier.failure).toBeUndefined();
});

test("a game window that takes 30 s to go fullscreen is waited for before its menus are read", async () => {
  const result = await world({ gameFullscreenAfter: 30 }).run();
  expect(result.failure).toBeUndefined();
  expect(result.events.filter((event) => event === "fullscreen Warcraft III")).toHaveLength(1);
  expect(result.windows.get(762)?.width).toBe(OUTPUT.width);
  expect((await world({ gameFullscreenAfter: 90 }).run()).failure).toBe("4/7 Map stopped: Warcraft III's window didn't become fullscreen within 45 s");
});

test("Warcraft III's menus are clicked in order: Multiplayer, Custom Games, Create Game, the folder, the map, the name, Create, Start", async () => {
  const result = await world().run();
  expect(result.failure).toBeUndefined();
  expect(result.events.filter((event) => event.startsWith("click Warcraft III"))).toEqual([
    "click Warcraft III MULTIPLAYER", "click Warcraft III CUSTOM GAMES", "click Warcraft III CREATE GAME", "click Warcraft III 00-SMASHCRAFT",
    "click Warcraft III SMASHCRAFT 0.0.47", "click Warcraft III Tompas's game", "click Warcraft III CREATE GAME", "click Warcraft III START GAME",
  ]);
  const notReady = await world({ mainMenu: false }).run();
  expect(notReady.failure).toBe("4/7 Map stopped: Warcraft III didn't show its main menu within 120 s");
});

test("step 1 refuses two runtimes on the prefix, a runtime on another display, and a runtime without Battle.net", async () => {
  expect((await world({ runtimes: "two" }).run()).failure).toBe(
    `1/7 Wine prefix stopped: 2 Wine runtimes are using ${PREFIX} (wineserver pids 100 200). A launcher started beside another runtime can't start the game. Close them with: kill 100 200   then run play again.`);
  expect((await world({ runtimes: "other display" }).run()).failure).toBe(
    `1/7 Wine prefix stopped: ${PREFIX} is in use on display :1 (wineserver pid 100), not this desktop's :0. Close that client with: kill 100   then run play again.`);
  expect((await world({ runtimes: "lingering" }).run()).failure).toBe(
    `1/7 Wine prefix stopped: a Wine runtime (wineserver pid 100) is using ${PREFIX} without Battle.net. Close it with: kill 100   then run play again.`);
  const exits = await world({ runtimes: "lingering exits" }).run();
  expect(exits.failure).toBeUndefined();
  expect(exits.lines[1]).toBe("1/7 Wine prefix: free");
});

test("step 2 stops when Steam doesn't start Battle.net or Battle.net doesn't sign in", async () => {
  expect((await world({ steamStarts: false }).run()).failure).toBe(
    "2/7 Battle.net stopped: Steam didn't start Battle.net within 90 s. Check that Steam is running and still has the shortcut \"Warcraft III (Battle.net)\" (steam steam://rungameid/16213922543717842944).");
  expect((await world({ signsIn: false }).run()).failure).toBe(
    "2/7 Battle.net stopped: Battle.net didn't sign in within 90 s. Sign in in its window (keep \"Keep me logged in\" ticked), then run play again.");
});

test("step 3 restarts Battle.net alone once when it can't launch the game, and stops when it still can't", async () => {
  const recovered = await world({ launches: ["failed", "running"] }).run();
  expect(recovered.failure).toBeUndefined();
  expect(recovered.lines).toContain("3/7 Warcraft III: Battle.net could not start Warcraft III.exe; restarting Battle.net alone, once");
  expect(recovered.events.filter((event) => event.startsWith("SIGTERM") || event.startsWith("steam") || event === "launch")).toEqual([
    "steam steam://rungameid/16213922543717842944", "launch", "SIGTERM 100 101 102", "steam steam://rungameid/16213922543717842944", "launch",
  ]);
  const failed = await world({ launches: ["failed", "failed"] }).run();
  expect(failed.failure).toBe(
    `3/7 Warcraft III stopped: Battle.net could not start Warcraft III.exe, also after restarting Battle.net. Its log: ${LOGS}/battle.net-20261006T030000.000000.log`);
  expect(failed.presses()).toBe(2);
});

test("step 3 stops without a restart when Battle.net doesn't take the launch request", async () => {
  const ignored = await world({ launches: ["ignored"] }).run();
  expect(ignored.failure).toBe(
    `3/7 Warcraft III stopped: Battle.net didn't launch Warcraft III within 15 s of being asked (its log: ${LOGS}/battle.net-20261006T020000.000000.log). Check that it is signed in to an account that owns Warcraft III and that the game is installed and up to date, then run play again.`);
  expect(ignored.events.filter((event) => event.startsWith("SIGTERM"))).toEqual([]);
});

test("the menus are clicked once they stop moving, once more when a click doesn't take, and the name field is found by its label", async () => {
  // Run 6, 6 Oct: Custom Games was read at 1058,132 and clicked there while the tabs slid down to y=164.
  const result = await world().run();
  expect(result.failure).toBeUndefined();
  expect(result.clickLog[1]).toStartWith("02-custom-games: 1058,164 of 2880x1920");
  const retried = await world({ ignoredClicks: { "CUSTOM GAMES": 1, "START GAME": 1 } }).run();
  expect(retried.failure).toBeUndefined();
  expect(retried.events.filter((event) => event === "click Warcraft III CUSTOM GAMES" || event === "click Warcraft III START GAME" || event === "ignored")).toEqual([
    "click Warcraft III CUSTOM GAMES", "ignored", "click Warcraft III CUSTOM GAMES", "click Warcraft III START GAME", "ignored", "click Warcraft III START GAME",
  ]);
  expect(retried.clickLog.some((line) => line.startsWith("03-custom-games-again:"))).toBe(true);
  expect((await world({ ignoredClicks: { "CUSTOM GAMES": 2 } }).run()).failure).toBe(
    "4/7 Map stopped: Custom Games didn't show Create Game (pictures and click log: /state/play-debug/1970-01-01T00-00-00-000Z)");
  const labelled = await world({ nameLabel: true }).run();
  expect(labelled.failure).toBeUndefined();
  expect(labelled.events).toContain("name field");
});

test("a missing map is installed from its declared build before the launch, and play stops when it can't be", async () => {
  expect((await world({ mapInstalled: false }).run()).failure).toBe(`3/7 Warcraft III stopped: the map isn't installed: ${MAP}`);
  expect((await world({ mapInstalled: false, mapSource: "missing" }).run()).failure).toBe(
    `3/7 Warcraft III stopped: the map isn't installed (${MAP}) and its build is missing: ${SOURCE}`);
  // Run 4, 6 Oct: the map's folder had been emptied; play installs the declared build and goes on.
  const copied = await world({ mapInstalled: false, mapSource: "present" }).run();
  expect(copied.failure).toBeUndefined();
  expect(copied.lines).toContain(`3/7 Warcraft III: installed Smashcraft 0.0.47.w3x from ${SOURCE}`);
  expect(copied.events.indexOf(`copy ${SOURCE} -> ${MAP}`)).toBeLessThan(copied.events.indexOf("launch"));
  // Run 11, 6 Oct: an installed map that differs from the declared build is replaced before Play, then verified.
  const stale = await world({ mapStale: true, mapSource: "present" }).run();
  expect(stale.failure).toBeUndefined();
  expect(stale.lines).toContain(`3/7 Warcraft III: replaced Smashcraft 0.0.47.w3x from ${SOURCE}`);
  expect(stale.events.indexOf(`copy ${SOURCE} -> ${MAP}`)).toBeLessThan(stale.events.indexOf("launch"));
  expect((await world({ mapStale: true, mapSource: "present", copyDamaged: true }).run()).failure).toBe(
    `3/7 Warcraft III stopped: the installed map differs from its build after copying: ${MAP}`);
  // An installed map identical to its build is left as it is.
  expect((await world({ mapSource: "present" }).run()).events.filter((event) => event.startsWith("copy"))).toEqual([]);
});

test("step 5 reuses this game's helper, refuses an earlier one and reports a helper that stops", async () => {
  const reused = await world({ helper: "this game's" }).run();
  expect(reused.failure).toBeUndefined();
  expect(reused.lines).toContain("5/7 Controller helper: already running for this game (pid 401)");
  expect((await world({ helper: "earlier" }).run()).failure).toBe(
    "5/7 Controller helper stopped: an earlier controller helper is running (pid 400). Stop it with: kill 400   then run play again.");
  expect((await world({ helper: "exits" }).run()).failure).toBe(
    `5/7 Controller helper stopped: the controller helper stopped: wc3-journal: no controller at /dev/input/event9 (log: ${HELPER_LOG})`);
});

test("step 5 with an always-on controller service waits on it and starts no helper of its own", async () => {
  const served = await world({ helper: "service" }).run();
  expect(served.failure).toBeUndefined();
  expect(served.lines).toContain("5/7 Controller helper: the controller service serves this game (pid 2852)");
  expect((await world({ helper: "service fails" }).run()).failure).toBe("5/7 Controller helper stopped: the controller service isn't running");
});

test("a problem in the game's own step stops play with that step's name", async () => {
  expect((await world({ matchFails: true }).run()).failure).toBe("6/7 Match stopped: the map refused the playtest request");
});

test("a click outside the screen is refused before the pointer moves", () => {
  // Run 7's retry was aimed at 1307,-29 and pinned the pointer at the top edge for eight moves.
  const spot = (x: number, y: number) => ({ output: "eDP-1", area: FRAME, x, y, window: { id: "w", x: 0, y: 0, ...FRAME } });
  expect(offScreen(spot(1307, -29))).toBe(true);
  expect(offScreen(spot(2880, 10))).toBe(true);
  expect(offScreen(spot(1307, 93))).toBe(false);
});

test("step 7 stops when the game's window won't take focus", async () => {
  expect((await world({ gameKeepsFocus: false }).run()).failure).toBe("7/7 Fullscreen stopped: Warcraft III's window didn't take focus");
});

test("play saves War3Preferences.txt before Warcraft III starts and has a detached helper put it back when the game exits", async () => {
  const before = "[Video]\nwindowmode=2\nreswidth=1280\n";
  const result = await world({ preferences: before }).run();
  expect(result.failure).toBeUndefined();
  expect(result.prefFiles.get(BACKUP)).toBe(before);
  expect(result.lines).toContain(`3/7 Warcraft III: saved ${PREFERENCES} as ${BACKUP}; it is put back when the game exits`);
  const restore = result.events.findIndex((event) => event.includes("restorePreferences.ts"));
  expect(result.events.indexOf("write War3Preferences-before-play.txt")).toBeLessThan(result.events.indexOf("launch"));
  expect(result.events[restore]).toEndWith(` 2852 ${DOCUMENTS} > undefined`);
  expect(restore).toBeGreaterThan(result.events.indexOf("launch"));
});

test("a backup an earlier play left is the file to keep: it goes back before the game starts and stays for the helper", async () => {
  const kept = "[Video]\nwindowmode=2\n";
  const result = await world({ preferences: "[Video]\nwindowmode=1\n", backup: kept }).run();
  expect(result.failure).toBeUndefined();
  expect(result.prefFiles.get(PREFERENCES)).toBe(kept);
  expect(result.prefFiles.get(BACKUP)).toBe(kept);
  expect(result.events.filter((event) => event.startsWith("write "))).toEqual(["write War3Preferences.txt"]);
});

test("a game already running keeps its own backup and helper: play saves and starts nothing for it", async () => {
  const result = await world({ runtimes: "launcher", gameRunning: true, runningLog: "played", preferences: "[Video]\nwindowmode=2\n" }).run();
  expect(result.failure).toBeUndefined();
  expect(result.events.filter((event) => event.startsWith("write ") || event.includes("restorePreferences"))).toEqual([]);
  expect(result.prefFiles.has(BACKUP)).toBe(false);
});
