// `play` against a simulated desktop: Steam, the Battle.net launcher and its
// log, the process table, niri's windows and Warcraft's menus are fakes with
// the recorded shapes (the 6 Oct primary-display session: a 2880x1920 output
// at scale 2, Steam shortcut 3775098022, Battle.net 2.53 log lines). Each step
// has its success and its plain failure message.
import { Cause, Clock, Effect, Exit, Layer, Option } from "effect";
import { TestClock } from "effect/testing";
import { expect, test } from "bun:test";
import { type ProcessInfo, launchOptions, launchOutcome, loadMapOption, newestLauncherLog, prefixUse, shortcutUrl, windowsPath, withLaunchOptions } from "../scripts/warcraft/battleNet";
import type { Word } from "../scripts/warcraft/desktop";
import { type DesktopWindow, type PlayDeclaration, PlayDesktop, PlayMachine, PlayProblem, type XWindow, findPhrase, expectedGain, measuredGain, play, spotTargets, steer, steerPointer, gridLabel, type PlayOptions, offScreen, tileArt, topmost, warcraftPlay, warcraftThree } from "../scripts/wisp/play";

const PREFIX = "/home/u/compatdata/3516115571/pfx";
const SERVER = "server-24-18d2b7ec";
const LOGS = `${PREFIX}/drive_c/users/steamuser/AppData/Local/Battle.net/Logs`;
const MAP = `${PREFIX}/drive_c/users/steamuser/Documents/Warcraft III/Maps/00-Smashcraft/Smashcraft 0.0.47.w3x`;
const HELPER = "/inputs/wc3-journal";
const HELPER_LOG = "/state/helper.log";
const DEBUG = "/state/play-debug";
const SOURCE = "/inputs/playable-0047/Smashcraft 0.0.47.w3x";
const CONFIG = `${PREFIX}/drive_c/users/steamuser/AppData/Roaming/Battle.net/Battle.net.config`;
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
  readonly runtimes?: "none" | "launcher" | "two" | "other display" | "lingering" | "lingering exits";
  readonly signsIn?: boolean;
  readonly steamStarts?: boolean;
  /** What each press of Play logs. */
  readonly launches?: readonly ("running" | "failed" | "ignored")[];
  /** The game Battle.net shows when it opens; 6 Oct it opened on WoW: Forever. */
  readonly launcherPage?: "warcraft" | "other";
  /** Warcraft III's button on its page. */
  readonly warcraftButton?: "Play" | "Update";
  /** Which click on Warcraft III's tile art opens its page; 0 for none. */
  readonly tileOpensOn?: number;
  /** How many first clicks on a phrase Warcraft ignores. */
  readonly ignoredClicks?: Readonly<Record<string, number>>;
  /** Create Game labels its name field "GAME NAME", away from the 2560x1440 position. */
  readonly nameLabel?: boolean;
  readonly playShown?: boolean;
  readonly mapInstalled?: boolean;
  /** Whether the declaration names the map's build, and whether that file is there. */
  readonly mapSource?: "present" | "missing";
  readonly mainMenu?: boolean;
  readonly helper?: "ready" | "exits" | "earlier" | "this game's";
  readonly fullscreens?: boolean;
  readonly gameRunning?: boolean;
  readonly matchFails?: boolean;
  /** False: another window takes focus back once the helper runs. */
  readonly gameKeepsFocus?: boolean;
  /** Warcraft III's launch options in Battle.net's settings before the run. */
  readonly launchOptions?: string;
  /** Whether Warcraft III loads the map its launch options name, or shows its main menu. */
  readonly loadfile?: "honored" | "ignored";
  /** False: the loaded map goes on to fighter selection without a key. */
  readonly waitsForKey?: boolean;
}

/**
 * Battle.net's Games tab as the reader read it on 6 Oct (third run, 2880x1920):
 * each tile's label is its own line under its art, then its install state.
 */
const GAMES_TAB: readonly Word[] = [
  { text: "My", x: 411, y: 299, line: "18" }, { text: "Games", x: 510, y: 295, line: "18" },
  { text: "Installed", x: 102, y: 439, line: "26" }, { text: "Favorites", x: 105, y: 489, line: "30" },
  { text: "REFORGED", x: 549, y: 729, line: "69" },
  { text: "Warcraft", x: 428, y: 818, line: "79" }, { text: "lll", x: 488, y: 818, line: "79" },
  { text: "WoW:", x: 794, y: 818, line: "80" }, { text: "Forever", x: 871, y: 818, line: "80" },
  { text: "World", x: 1176, y: 818, line: "81" }, { text: "of", x: 1224, y: 818, line: "81" }, { text: "Warcraft", x: 1285, y: 818, line: "81" }, { text: "Classic", x: 1374, y: 818, line: "81" },
  { text: "World", x: 1557, y: 818, line: "82" }, { text: "of", x: 1605, y: 818, line: "82" }, { text: "Warcraft", x: 1666, y: 818, line: "82" },
  { text: "Installed", x: 453, y: 848, line: "85" }, { text: "Installed", x: 835, y: 848, line: "88" }, { text: "Installed", x: 1216, y: 848, line: "91" },
];
/** Warcraft III's tile art in that capture, measured from its pixels: x 385-715, y 400-785. */
const WARCRAFT_ART = { width: 165, height: 192 };
/** Run 7 read the "World of Warcraft" logo in World of Warcraft Classic's tile art as a word of its own. */
const ART_LOGO: readonly Word[] = [{ text: "WORLD", x: 1300, y: 660, line: "58" }, { text: "WARCRAFT", x: 1307, y: 703, line: "66" }];

interface Button {
  readonly phrase: string;
  /** Launcher text the reader separates as white, like Play on its blue button; all else is light. */
  readonly white?: boolean;
  readonly x: number;
  readonly y: number;
  /** The words the reader makes of it, when recorded; otherwise the phrase's words around x. */
  readonly read?: readonly Word[];
  /** Half its size, for what isn't text, like a tile's art. */
  readonly half?: { readonly width: number; readonly height: number };
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
  let menu = "main";
  let name = "Tompas's game";
  let started = false;
  let presses = 0;
  let tileClicks = 0;
  let battleNetReads = 0;
  const ignored = new Map(Object.entries(scenario.ignoredClicks ?? {}));
  let mapInstalled = scenario.mapInstalled !== false;
  let config = withLaunchOptions(SETTINGS, scenario.launchOptions);
  /** What Battle.net read from its settings when it started. */
  let launcherOptions = launchOptions(config);
  let page: "warcraft" | "other" | "games" = scenario.launcherPage ?? "other";
  const shots: string[] = [];
  const clickLog: string[] = [];
  let helperLog = "";
  let helperStarted = false;
  let nextPid = 3000;
  const launchesLeft = [...(scenario.launches ?? ["running"])];

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
    page = scenario.launcherPage ?? "other";
    launcherOptions = launchOptions(config);
    tileClicks = 0;
    logs.set(log, line("Main", "Logging started for Battle.net build 2.53.4.17896"));
    windows.set(758, tiled(758, "Battle.net"));
    if (scenario.signsIn !== false) later(2, () => logs.set(log, logs.get(log)! + SIGNED_IN));
  };
  const newestLog = () => newestLauncherLog([...logs.keys()])!;
  const startGame = () => {
    processes.push(gameProcess(2852));
    windows.set(762, tiled(762, "Warcraft III"));
    if (launcherOptions?.startsWith("-loadfile ") === true && scenario.loadfile !== "ignored") {
      menu = "loading";
      // Run 9, 6 Oct: the loaded map waits on "PRESS ANY KEY TO CONTINUE".
      later(8, () => { menu = scenario.waitsForKey === false ? "selection" : "press any key"; started = scenario.waitsForKey === false; });
    }
  };

  switch (scenario.runtimes ?? "none") {
    case "launcher":
      startLauncher();
      logs.set(newestLog(), logs.get(newestLog())! + SIGNED_IN);
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
  if (scenario.gameRunning === true) startGame();
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
      case "press any key": return [{ phrase: "PRESS ANY KEY TO CONTINUE", x: 1440, y: 1700, press: () => {} }];
      case "lobby": return [{ phrase: "SMASHCRAFT 0.0.47", x: 2600, y: 240, press: () => {} }, { phrase: "START GAME", x: 2593, y: 1503, press: () => { menu = "selection"; later(8, () => { started = true; }); } }];
      default: return [];
    }
  };
  const pressWarcraftPlay = () => {
    presses++;
    events.push("Play");
    const outcome = launchesLeft.shift() ?? "running";
    later(1, () => {
      if (outcome !== "ignored") logs.set(newestLog(), logs.get(newestLog())! + REQUESTED + (outcome === "running" ? LAUNCHED : COULD_NOT));
      if (outcome === "running") startGame();
    });
  };
  // Positions from the 6 Oct capture of Battle.net 2.53 on the 2880x1920 output.
  const launcherButtons = (): Button[] => {
    if (scenario.playShown === false) return [];
    const nav: Button[] = [
      { phrase: "HOME", x: 1705, y: 146, press: () => {} },
      { phrase: "GAMES", x: 1843, y: 146, press: () => { page = "games"; } },
      { phrase: "SHOP", x: 1979, y: 146, press: () => {} },
    ];
    switch (page) {
      case "games": return [...nav,
        { phrase: "Games tab text", x: -10_000, y: -10_000, read: [...GAMES_TAB, ...ART_LOGO], press: () => {} },
        { phrase: "Warcraft III art", x: 550, y: 592, half: WARCRAFT_ART, read: [], press: () => {
          tileClicks++;
          if (tileClicks === (scenario.tileOpensOn ?? 1)) page = "warcraft";
        } },
        { phrase: "WoW: Forever art", x: 550 + 381, y: 592, half: WARCRAFT_ART, read: [], press: () => { page = "other"; } }];
      case "other": return [...nav,
        { phrase: "World of Warcraft: Forever Gameplay Trailer", x: 2224, y: 875, press: () => {} },
        { phrase: "Play Now", x: 2510, y: 1470, white: true, press: () => events.push("store") },
        { phrase: "GAME VERSION", x: 1493, y: 1618, press: () => {} },
        { phrase: "WoW: Forever Beta", x: 1537, y: 1665, press: () => {} },
        { phrase: "Play", x: 1598, y: 1746, white: true, press: () => events.push("Play WoW") }];
      case "warcraft": return [...nav,
        { phrase: "GAME VERSION", x: 1493, y: 1618, press: () => {} },
        { phrase: "Warcraft III", x: 1537, y: 1665, press: () => {} },
        { phrase: scenario.warcraftButton ?? "Play", x: 1598, y: 1746, white: true, press: () => { if (scenario.warcraftButton !== "Update") pressWarcraftPlay(); } }];
    }
  };
  const screenOf = () => {
    const window = focused === undefined ? undefined : windows.get(focused);
    if (window === undefined || window.width !== OUTPUT.width) return [];
    return window.title === "Battle.net" ? launcherButtons() : gameButtons();
  };

  const machine = PlayMachine.of({
    processes: tick.pipe(Effect.map(() => [...processes])),
    serverDirectory: () => Effect.succeed(SERVER),
    signal: (pids, signal) => Effect.sync(() => {
      events.push(`${signal} ${pids.join(" ")}`);
      later(1, () => { processes = processes.filter((process) => !pids.includes(process.pid) && process.pid !== 90); });
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
      const text = path.startsWith(`${LOGS}/`) ? logs.get(path.slice(LOGS.length + 1)) : undefined;
      return text?.slice(from);
    })),
    size: (path) => Effect.sync(() => {
      if (path === MAP) return mapInstalled ? 38_579_096 : undefined;
      if (path === SOURCE) return scenario.mapSource === "present" ? 38_579_096 : undefined;
      if (path === HELPER_LOG) return helperLog.length;
      return path.startsWith(`${LOGS}/`) ? logs.get(path.slice(LOGS.length + 1))?.length : undefined;
    }),
    list: (directory) => Effect.sync(() => (directory === LOGS ? [...logs.keys(), "libcef-20261006T014728.217325.log"] : [])),
    write: (path, text) => Effect.sync(() => {
      expect(path).toBe(CONFIG);
      expect(text).toContain("\r\n    \"Client\": {");
      config = text;
      events.push(`launch options: ${launchOptions(text) ?? "none"}`);
    }),
    copy: (from, to) => Effect.sync(() => {
      events.push(`copy ${from} -> ${to}`);
      mapInstalled = true;
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
      windows.set(id, window.width === OUTPUT.width ? { ...window, width: 1424, height: 920 } : { ...window, width: OUTPUT.width, height: OUTPUT.height });
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
      const hit = screenOf().find((button) => (button.half === undefined
        ? Math.abs(button.x - root.x) <= 70 * (button.phrase.split(" ").length - 1) + 60 && Math.abs(button.y - root.y) <= 30
        : Math.abs(button.x - root.x) <= button.half.width && Math.abs(button.y - root.y) <= button.half.height));
      events.push(`click ${spot.window.id} ${hit?.phrase ?? `${root.x},${root.y}`}`);
      const ignoring = hit === undefined ? 0 : ignored.get(hit.phrase) ?? 0;
      if (hit !== undefined && ignoring > 0) {
        ignored.set(hit.phrase, ignoring - 1);
        events.push("ignored");
      } else hit?.press();
      return [`moved to X ${root.x},${root.y}`];
    }),
    keys: (_window, ...keys) => Effect.sync(() => events.push(`keys ${keys.join(" ")}`)),
    pressKey: (_window, key) => Effect.sync(() => {
      events.push(`press ${key}`);
      if (menu === "press any key") later(2, () => { menu = "selection"; started = true; });
    }),
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
    started: () => Effect.gen(function*() {
      for (let waited = 0; !started; waited++) {
        if (waited > 480) return yield* new PlayProblem({ problem: "the map didn't reach fighter selection within 120 s" });
        yield* Effect.sleep("250 millis");
        yield* tick;
      }
    }),
    match: () => Effect.gen(function*() {
      events.push("match");
      if (scenario.matchFails === true) return yield* new PlayProblem({ problem: "the map refused the playtest request" });
      return "computer as Player 3";
    }),
    helper: { binary: HELPER, ready: /waiting_for_match/, log: HELPER_LOG, args: (game) => Effect.succeed(["--pid", String(game.pid)]) },
  };

  const run = async (options: PlayOptions = {}) => {
    const lines: string[] = [];
    const program = play(declaration, (status) => lines.push(status), options).pipe(
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
    return { lines, failure, events, presses: () => presses, windows, shots, clickLog };
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

test("Warcraft III's Play is the Play under a game version box naming Warcraft III; WoW: Forever's and other Warcraft games' are not", () => {
  const screen = (width: number, height: number, ...lines: Word[][]) => ({ width, height, words: lines.flat() });
  // Tom's launcher on 6 Oct (2880x1920), as the reader read it: WoW: Forever was selected.
  const wow = {
    light: screen(2880, 1920, words("a", 1493, 1618, "GAME VERSION"), words("b", 1537, 1665, "WoW: Forever Beta"), words("c", 2224, 875, "World of Warcraft: Forever")),
    white: screen(2880, 1920, words("d", 2510, 1460, "Play"), words("e", 1598, 1746, "Play")),
  };
  expect(warcraftPlay(wow)).toBeUndefined();
  // A 3 Oct private desktop (2560x1440): the reader dropped III from the box's "Warcraft III".
  const warcraft = {
    light: screen(2560, 1440, words("a", 128, 673, "GAME VERSION"), [{ text: "Warcraft", x: 114, y: 720, line: "b" }]),
    white: screen(2560, 1440, [{ text: "Play", x: 234, y: 801, line: "c" }]),
  };
  expect(warcraftPlay(warcraft)).toEqual({ x: 234, y: 801 });
  const games = [...words("a", 600, 500, "World of Warcraft"), ...words("b", 1100, 500, "Warcraft Ill: Reforged"), ...words("c", 1600, 500, "Warcraft II: Remastered"), ...words("d", 2100, 500, "Warcraft Rumble")];
  expect(warcraftThree(games)).toEqual([{ x: 1030, y: 500 }]);
});

test("a Games tab tile is clicked on its art above the label, which on 6 Oct didn't take the click", () => {
  const label = warcraftThree(GAMES_TAB)[0]!;
  expect(label).toEqual({ x: 458, y: 818 });
  const tile = tileArt(GAMES_TAB, label);
  // The labels' first words are 366, 382 and 381 px apart: the tiles' pitch is 381.
  expect(tile).toEqual({ first: { x: 458, y: 628 }, retry: { x: 458, y: 589 } });
  for (const point of [tile.first, tile.retry]) {
    expect(point.x).toBeGreaterThanOrEqual(385);
    expect(point.x).toBeLessThanOrEqual(715);
    expect(point.y).toBeGreaterThanOrEqual(400);
    expect(point.y).toBeLessThanOrEqual(785);
  }
  // A row with one tile falls back to that pitch.
  expect(tileArt(GAMES_TAB.filter(({ line }) => line !== "80" && line !== "81" && line !== "82"), label).first).toEqual({ x: 458, y: 628 });
});

test("Warcraft III's tile label is the one in the Games grid with its install state below, not a logo in another tile's art", () => {
  // Run 7, 6 Oct: "WARCRAFT" read in World of Warcraft Classic's art at 1307,703 was taken for the label.
  const read = [...GAMES_TAB, ...ART_LOGO];
  expect(topmost(warcraftThree(read))).toEqual({ x: 1307, y: 703 });
  expect(gridLabel(read)).toEqual({ x: 458, y: 818 });
  // The grid isn't drawn yet: no header, no label.
  expect(gridLabel(ART_LOGO)).toBeUndefined();
  // A label without its install state below isn't taken either.
  expect(gridLabel(read.filter(({ text }) => text !== "Installed"))).toBeUndefined();
  // The logo's row has gaps that aren't tiles' (run 7 made a 1220 px pitch of them): the recorded pitch stands in.
  const art = tileArt([{ text: "WARCRAFT", x: 1307, y: 703, line: "a" }, { text: "x", x: 87, y: 703, line: "b" }, { text: "y", x: 2527, y: 703, line: "c" }], { x: 1307, y: 703 });
  expect(art.first).toEqual({ x: 1307, y: 513 });
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

test("from a cold desktop: Battle.net set to load the map, Play, the map loaded, the helper, the match, the game fullscreen", async () => {
  const result = await world().run();
  expect(result.failure).toBeUndefined();
  expect(result.lines).toEqual([
    "Captures and click log: /state/play-debug/1970-01-01T00-00-00-000Z",
    "1/7 Wine prefix: free",
    "2/7 Battle.net: starting the Steam shortcut \"Warcraft III (Battle.net)\"",
    "2/7 Battle.net: started and signed in (3 s), with Warcraft III set to load the map",
    "3/7 Warcraft III: Battle.net's Play started it",
    "3/7 Warcraft III: Battle.net's launch options for it put back; its own Play no longer loads the map",
    "3/7 Warcraft III: running (pid 2852), fullscreen",
    "4/7 Map: Warcraft III loaded Smashcraft 0.0.47.w3x from its launch options; fighter selection 13 s after Play (5 key presses to continue)",
    "5/7 Controller helper: running (pid 3000), log /state/helper.log",
    "6/7 Match: computer as Player 3",
    "7/7 Fullscreen: Warcraft III is fullscreen and focused. Ready to fight.",
  ]);
  // Battle.net opened on WoW: Forever, as on 6 Oct: its Games tab leads to Warcraft III's Play. Nothing after Play is clicked;
  // space goes to the game every 2 s until the loaded map has passed "Press any key".
  const presses = result.events.filter((event) => event === "press space");
  expect(presses.length).toBe(5);
  expect(result.events.indexOf("press space")).toBeGreaterThan(result.events.indexOf("fullscreen Warcraft III"));
  expect(result.events.lastIndexOf("press space")).toBeLessThan(result.events.indexOf(`start ${HELPER} --pid 2852 > ${HELPER_LOG}`));
  expect(result.events.filter((event) => event !== "press space")).toEqual([
    `launch options: ${LOAD_MAP}`,
    "steam steam://rungameid/16213922543717842944",
    "prepare",
    "fullscreen Battle.net",
    "click Battle.net GAMES",
    "click Battle.net Warcraft III art",
    "click Battle.net Play",
    "Play",
    "fullscreen Battle.net",
    "launch options: none",
    "fullscreen Warcraft III",
    `start ${HELPER} --pid 2852 > ${HELPER_LOG}`,
    "match",
  ]);
  // A picture before and after every click, and one click log line each with its pointer moves.
  expect(result.shots).toEqual([
    "01-battle-net-games-before.jpg", "01-battle-net-games-after.jpg", "02-battle-net-warcraft-iii-tile-before.jpg", "02-battle-net-warcraft-iii-tile-after.jpg",
    "03-battle-net-play-before.jpg", "03-battle-net-play-after.jpg",
  ]);
  expect(result.clickLog[2]).toBe("03-battle-net-play: 1598,1746 of 2880x1920 on eDP-1; moved to X 1598,1746\n");
  // The launcher went back to its tile; the game stays fullscreen.
  expect(result.windows.get(758)?.width).toBe(1424);
  expect(result.windows.get(762)?.width).toBe(OUTPUT.width);
});

test("Battle.net's launch options: kept on request, reused by a launcher that read them, set by restarting one that didn't", async () => {
  const kept = await world().run({ keepLaunchOptions: true });
  expect(kept.failure).toBeUndefined();
  expect(kept.events.filter((event) => event.startsWith("launch options"))).toEqual([`launch options: ${LOAD_MAP}`]);
  // Warm: the launcher started with the options from a kept run, so nothing restarts.
  const warm = await world({ runtimes: "launcher", launchOptions: LOAD_MAP }).run({ keepLaunchOptions: true });
  expect(warm.failure).toBeUndefined();
  expect(warm.lines[2]).toBe("2/7 Battle.net: signed in, with Warcraft III set to load the map");
  expect(warm.events.filter((event) => event.startsWith("steam") || event.startsWith("SIG") || event.startsWith("launch options"))).toEqual([]);
  // A running launcher without them is restarted alone, after they are written.
  const restarted = await world({ runtimes: "launcher", launchOptions: "-windowmode 0" }).run();
  expect(restarted.failure).toBeUndefined();
  expect(restarted.lines[2]).toBe("2/7 Battle.net: restarting it to set Warcraft III's launch options, which it reads when it starts");
  expect(restarted.events.filter((event) => event.startsWith("steam") || event.startsWith("SIG") || event.startsWith("launch options"))).toEqual([
    "SIGTERM 100 101 102", `launch options: ${LOAD_MAP}`, "steam steam://rungameid/16213922543717842944", "launch options: -windowmode 0",
  ]);
});

test("a launcher already showing Warcraft III gets one click, on Play; with Warcraft III already running the map is hosted through its menus", async () => {
  const shown = await world({ launcherPage: "warcraft" }).run();
  expect(shown.failure).toBeUndefined();
  expect(shown.events.filter((event) => event.startsWith("click Battle.net"))).toEqual(["click Battle.net Play"]);
  const result = await world({ runtimes: "launcher", gameRunning: true }).run();
  expect(result.failure).toBeUndefined();
  expect(result.lines.slice(1, 6)).toEqual([
    "1/7 Wine prefix: Battle.net already running in its only runtime (pid 101)",
    "2/7 Battle.net: signed in; Warcraft III already runs, so the map is hosted through its menus",
    "3/7 Warcraft III: already running (pid 2852)",
    "3/7 Warcraft III: running (pid 2852), fullscreen",
    "4/7 Map: \"Smashcraft\" of Smashcraft 0.0.47 hosted through the menus (joining by name is case-sensitive)",
  ]);
  expect(result.events.filter((event) => event.startsWith("steam") || event === "Play" || event.startsWith("launch options"))).toEqual([]);
  expect(result.events).toContain("click Warcraft III START GAME");
});

test("a map that goes on without a key is timed the same, keys during loading changing nothing; one that never loads stops play after 120 s", async () => {
  const direct = await world({ waitsForKey: false }).run();
  expect(direct.failure).toBeUndefined();
  expect(direct.lines[7]).toBe("4/7 Map: Warcraft III loaded Smashcraft 0.0.47.w3x from its launch options; fighter selection 9 s after Play (4 key presses to continue)");
  const stuck = await world({ loadfile: "ignored", mainMenu: false }).run();
  expect(stuck.failure).toBe("4/7 Map stopped: the map didn't reach fighter selection within 120 s");
  expect(stuck.events.filter((event) => event === "press space").length).toBeLessThanOrEqual(60);
});

test("Warcraft III that shows its main menu instead of loading the map has it hosted through the menus, with no key sent to the menu", async () => {
  const result = await world({ loadfile: "ignored" }).run();
  expect(result.failure).toBeUndefined();
  expect(result.events).not.toContain("press space");
  expect(result.lines).toContain("4/7 Map: Warcraft III showed its main menu instead of loading the map; hosting it through the menus");
  expect(result.events.filter((event) => event.startsWith("click Warcraft III"))).toEqual([
    "click Warcraft III MULTIPLAYER", "click Warcraft III CUSTOM GAMES", "click Warcraft III CREATE GAME", "click Warcraft III 00-SMASHCRAFT",
    "click Warcraft III SMASHCRAFT 0.0.47", "click Warcraft III Tompas's game", "click Warcraft III CREATE GAME", "click Warcraft III START GAME",
  ]);
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
  expect(recovered.events.filter((event) => event.startsWith("SIGTERM") || event.startsWith("steam") || event === "Play")).toEqual([
    "steam steam://rungameid/16213922543717842944", "Play", "SIGTERM 100 101 102", "steam steam://rungameid/16213922543717842944", "Play",
  ]);
  const failed = await world({ launches: ["failed", "failed"] }).run();
  expect(failed.failure).toBe(
    `3/7 Warcraft III stopped: Battle.net could not start Warcraft III.exe, also after restarting Battle.net. Its log: ${LOGS}/battle.net-20261006T030000.000000.log`);
  expect(failed.presses()).toBe(2);
});

test("step 3 stops without a restart when Battle.net doesn't take the Play click, can't show Warcraft III's Play, or won't go fullscreen", async () => {
  const ignored = await world({ launches: ["ignored"] }).run();
  expect(ignored.failure).toBe(
    "3/7 Warcraft III stopped: Battle.net didn't take the Play click: its log has no launch request within 15 s (pictures and click log: /state/play-debug/1970-01-01T00-00-00-000Z)");
  expect(ignored.events.filter((event) => event.startsWith("SIGTERM"))).toEqual([]);
  const stuck = "3/7 Warcraft III stopped: Battle.net didn't show Warcraft III's Play after two clicks on its Games tile. If it is installing or updating, let it finish, then run play again (pictures and click log: /state/play-debug/1970-01-01T00-00-00-000Z)";
  const updating = await world({ warcraftButton: "Update" }).run();
  expect(updating.failure).toBe(stuck);
  expect(updating.events).not.toContain("Play WoW");
  // The tile's art is clicked again once when the first click doesn't open its page, then play stops.
  const second = await world({ tileOpensOn: 2 }).run();
  expect(second.failure).toBeUndefined();
  expect(second.events.filter((event) => event.startsWith("click Battle.net"))).toEqual(
    ["click Battle.net GAMES", "click Battle.net Warcraft III art", "click Battle.net Warcraft III art", "click Battle.net Play"]);
  const never = await world({ tileOpensOn: 0 }).run();
  expect(never.failure).toBe(stuck);
  expect(never.events.filter((event) => event === "click Battle.net Warcraft III art")).toHaveLength(2);
  const blank = await world({ playShown: false }).run();
  expect(blank.failure).toBe("3/7 Warcraft III stopped: Battle.net's window shows neither its Games tab nor Warcraft III's Play button");
  expect(blank.windows.get(758)?.width).toBe(1424);
  expect((await world({ fullscreens: false }).run()).failure).toBe("3/7 Warcraft III stopped: Battle.net's window didn't become fullscreen within 5 s");
});

test("the menus are clicked once they stop moving, once more when a click doesn't take, and the name field is found by its label", async () => {
  // Run 6, 6 Oct: Custom Games was read at 1058,132 and clicked there while the tabs slid down to y=164.
  const result = await world({ loadfile: "ignored" }).run();
  expect(result.failure).toBeUndefined();
  expect(result.clickLog[4]).toStartWith("05-custom-games: 1058,164 of 2880x1920");
  const retried = await world({ loadfile: "ignored", ignoredClicks: { "CUSTOM GAMES": 1, "START GAME": 1 } }).run();
  expect(retried.failure).toBeUndefined();
  expect(retried.events.filter((event) => event === "click Warcraft III CUSTOM GAMES" || event === "click Warcraft III START GAME" || event === "ignored")).toEqual([
    "click Warcraft III CUSTOM GAMES", "ignored", "click Warcraft III CUSTOM GAMES", "click Warcraft III START GAME", "ignored", "click Warcraft III START GAME",
  ]);
  expect(retried.clickLog.some((line) => line.startsWith("06-custom-games-again:"))).toBe(true);
  expect((await world({ loadfile: "ignored", ignoredClicks: { "CUSTOM GAMES": 2 } }).run()).failure).toBe(
    "4/7 Map stopped: Custom Games didn't show Create Game (pictures and click log: /state/play-debug/1970-01-01T00-00-00-000Z)");
  const labelled = await world({ loadfile: "ignored", nameLabel: true }).run();
  expect(labelled.failure).toBeUndefined();
  expect(labelled.events).toContain("name field");
});

test("a missing map is installed from its declared build before Play; play stops when it can't be, or the map never loads", async () => {
  expect((await world({ mapInstalled: false }).run()).failure).toBe(`3/7 Warcraft III stopped: the map isn't installed: ${MAP}`);
  expect((await world({ mapInstalled: false, mapSource: "missing" }).run()).failure).toBe(
    `3/7 Warcraft III stopped: the map isn't installed (${MAP}) and its build is missing: ${SOURCE}`);
  // Run 4, 6 Oct: the map's folder had been emptied; play installs the declared build and goes on.
  const copied = await world({ mapInstalled: false, mapSource: "present" }).run();
  expect(copied.failure).toBeUndefined();
  expect(copied.lines).toContain(`3/7 Warcraft III: installed Smashcraft 0.0.47.w3x from ${SOURCE}`);
  expect(copied.events.indexOf(`copy ${SOURCE} -> ${MAP}`)).toBeLessThan(copied.events.indexOf("Play"));
  // An installed map is left as it is.
  expect((await world({ mapSource: "present" }).run()).events.filter((event) => event.startsWith("copy"))).toEqual([]);
  // Neither the map nor the main menu: the map's own wait decides.
  expect((await world({ loadfile: "ignored", mainMenu: false }).run()).failure).toBe("4/7 Map stopped: the map didn't reach fighter selection within 120 s");
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
