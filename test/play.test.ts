// `play` against a simulated desktop: Steam, the Battle.net launcher and its
// log, the process table, niri's windows and Warcraft's menus are fakes with
// the recorded shapes (the 6 Oct primary-display session: a 2880x1920 output
// at scale 2, Steam shortcut 3775098022, Battle.net 2.53 log lines). Each step
// has its success and its plain failure message.
import { Cause, Clock, Effect, Exit, Layer, Option } from "effect";
import { TestClock } from "effect/testing";
import { expect, test } from "bun:test";
import { type ProcessInfo, launchOutcome, newestLauncherLog, prefixUse, shortcutUrl } from "../scripts/warcraft/battleNet";
import type { Word } from "../scripts/warcraft/desktop";
import { type DesktopWindow, type PlayDeclaration, PlayDesktop, PlayMachine, PlayProblem, type XWindow, findPhrase, play, uiPoint } from "../scripts/wisp/play";

const PREFIX = "/home/u/compatdata/3516115571/pfx";
const SERVER = "server-24-18d2b7ec";
const LOGS = `${PREFIX}/drive_c/users/steamuser/AppData/Local/Battle.net/Logs`;
const MAP = `${PREFIX}/drive_c/users/steamuser/Documents/Warcraft III/Maps/00-Smashcraft/Smashcraft 0.0.47.w3x`;
const HELPER = "/inputs/wc3-journal";
const HELPER_LOG = "/state/helper.log";
const OUTPUT = { name: "eDP-1", width: 1440, height: 960 };
const FRAME = { width: 2880, height: 1920 };
const APP = "steam_app_3775098022";

const line = (component: string, text: string) => `I 2026-10-06 01:47:49.901612 [${component}] {Main} ${text}\n`;
const SIGNED_IN = line("BNLogin", "Logged into Battle.net successfully. |bnet=1:0:0|game=2:0:0");
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
  readonly launches?: readonly ("running" | "failed")[];
  readonly playShown?: boolean;
  readonly mapInstalled?: boolean;
  readonly mainMenu?: boolean;
  readonly helper?: "ready" | "exits" | "earlier" | "this game's";
  readonly fullscreens?: boolean;
  readonly gameRunning?: boolean;
  readonly opponentFails?: boolean;
  /** False: another window takes focus back once the helper runs. */
  readonly gameKeepsFocus?: boolean;
}

interface Button {
  readonly phrase: string;
  readonly x: number;
  readonly y: number;
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
    logs.set(log, line("Main", "Logging started for Battle.net build 2.53.4.17896"));
    windows.set(758, tiled(758, "Battle.net"));
    if (scenario.signsIn !== false) later(2, () => logs.set(log, logs.get(log)! + SIGNED_IN));
  };
  const newestLog = () => newestLauncherLog([...logs.keys()])!;
  const startGame = () => {
    processes.push(gameProcess(2852));
    windows.set(762, tiled(762, "Warcraft III"));
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
      case "battle.net": return [{ phrase: "VERSUS", x: 400, y: 120, press: () => {} }, { phrase: "CUSTOM GAMES", x: 800, y: 120, press: go("custom games") }];
      case "custom games": return [{ phrase: "CUSTOM GAMES", x: 800, y: 120, press: () => {} }, { phrase: "CREATE GAME", x: 2013, y: 1601, press: go("create") }];
      case "create":
      case "folder":
      case "selected": {
        const list: Button[] = menu === "create"
          ? [{ phrase: "00-SMASHCRAFT", x: 1550, y: 490, press: go("folder") }, { phrase: "DOWNLOAD", x: 1550, y: 560, press: () => {} }]
          : [{ phrase: "SMASHCRAFT 0.0.47", x: 1550, y: 490, press: go("selected") }, { phrase: "SMASHCRAFT INPUT PROBE", x: 1550, y: 560, press: () => {} }];
        return [
          { phrase: "REATE GAME", x: 300, y: 243, press: () => {} },
          { phrase: name, x: 533, y: 453, press: () => events.push("name field") },
          ...list,
          ...(menu === "selected" ? [{ phrase: "SMASHCRAFT 0.0.47", x: 2600, y: 240, press: () => {} }, { phrase: "SUGGESTED PLAYERS: 4", x: 2600, y: 970, press: () => {} }] : []),
          { phrase: "CREATE GAME", x: 2600, y: 1501, press: () => { if (menu === "selected") menu = "lobby"; } },
        ];
      }
      case "lobby": return [{ phrase: "SMASHCRAFT 0.0.47", x: 2600, y: 240, press: () => {} }, { phrase: "START GAME", x: 2593, y: 1503, press: () => { menu = "selection"; later(8, () => { started = true; }); } }];
      default: return [];
    }
  };
  const launcherButtons = (): Button[] => scenario.playShown === false ? [] : [{ phrase: "Play", x: 468, y: 1602, press: () => {
    presses++;
    events.push("Play");
    const outcome = launchesLeft.shift() ?? "running";
    later(1, () => {
      logs.set(newestLog(), logs.get(newestLog())! + (outcome === "running" ? LAUNCHED : COULD_NOT));
      if (outcome === "running") startGame();
    });
  } }];
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
      const text = path.startsWith(`${LOGS}/`) ? logs.get(path.slice(LOGS.length + 1)) : undefined;
      return text?.slice(from);
    })),
    size: (path) => Effect.sync(() => {
      if (path === MAP) return scenario.mapInstalled === false ? undefined : 38_579_096;
      if (path === HELPER_LOG) return helperLog.length;
      return path.startsWith(`${LOGS}/`) ? logs.get(path.slice(LOGS.length + 1))?.length : undefined;
    }),
    list: (directory) => Effect.sync(() => (directory === LOGS ? [...logs.keys(), "libcef-20261006T014728.217325.log"] : [])),
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
    read: (output) => Effect.sync(() => {
      expect(output).toBe(OUTPUT.name);
      return { ...FRAME, words: screenOf().flatMap((button, index) => words(`b${index}`, button.x, button.y, button.phrase)) };
    }),
    xWindow: (title) => Effect.succeed<XWindow | undefined>(
      [...windows.values()].some((window) => window.title === title) ? { id: title, x: 0, y: 0, ...FRAME } : undefined),
    click: (window, x, y) => Effect.sync(() => {
      const hit = screenOf().find((button) => Math.abs(button.x - x) <= 140 && Math.abs(button.y - y) <= 30);
      events.push(`click ${window.id} ${hit?.phrase ?? `${x},${y}`}`);
      hit?.press();
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
    map: { folder: "00-Smashcraft", file: "Smashcraft 0.0.47.w3x", title: "Smashcraft 0.0.47" },
    gameName: "Smashcraft",
    started: () => Effect.gen(function*() {
      while (!started) {
        yield* Effect.sleep("250 millis");
        yield* tick;
      }
    }),
    opponent: (game) => Effect.gen(function*() {
      yield* game.clickUi(0.485, 0.2565);
      if (scenario.opponentFails === true) return yield* new PlayProblem({ problem: "the computer opponent didn't appear in slot 3" });
      return "computer in slot 3";
    }),
    helper: { binary: HELPER, ready: /waiting_for_match/, log: HELPER_LOG, args: (game) => Effect.succeed(["--pid", String(game.pid)]) },
  };

  const run = async () => {
    const lines: string[] = [];
    const program = play(declaration, (status) => lines.push(status)).pipe(
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
    return { lines, failure, events, presses: () => presses, windows };
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

test("Warcraft's UI coordinates land on the centred 4:3 area of a 3:2 and a 16:9 window", () => {
  const window = (width: number, height: number): XWindow => ({ id: "w", x: 0, y: 0, width, height });
  // A slot tag Smashcraft clicked at 1484,824 on the 2560x1440 private desktop.
  expect(uiPoint(window(2560, 1440), 0.485, 0.2565)).toEqual({ x: 1484, y: 824 });
  expect(uiPoint(window(2880, 1920), 0.485, 0.2565)).toEqual({ x: 1712, y: 1099 });
});

test("from a cold desktop: Steam starts Battle.net, Play starts Warcraft III, the game is hosted, the opponent added, the helper started, the game fullscreen", async () => {
  const result = await world().run();
  expect(result.failure).toBeUndefined();
  expect(result.lines).toEqual([
    "1/7 Wine prefix: free",
    "2/7 Battle.net: starting the Steam shortcut \"Warcraft III (Battle.net)\"",
    "2/7 Battle.net: started and signed in (3 s)",
    "3/7 Warcraft III: Battle.net's Play started it",
    "3/7 Warcraft III: running (pid 2852), fullscreen",
    "4/7 Custom game: \"Smashcraft\" of Smashcraft 0.0.47 started (joining by name is case-sensitive)",
    "5/7 Opponent: computer in slot 3",
    "6/7 Controller helper: running (pid 3000), log /state/helper.log",
    "7/7 Fullscreen: Warcraft III is fullscreen and focused. Ready to fight.",
  ]);
  expect(result.events).toEqual([
    "steam steam://rungameid/16213922543717842944",
    "fullscreen Battle.net",
    "click Battle.net Play",
    "Play",
    "fullscreen Battle.net",
    "fullscreen Warcraft III",
    "click Warcraft III MULTIPLAYER",
    "click Warcraft III CUSTOM GAMES",
    "click Warcraft III CREATE GAME",
    "click Warcraft III 00-SMASHCRAFT",
    "click Warcraft III SMASHCRAFT 0.0.47",
    "click Warcraft III Tompas's game",
    "name field",
    "keys ctrl+a",
    "type Smashcraft",
    "click Warcraft III CREATE GAME",
    "click Warcraft III START GAME",
    "click Warcraft III 1712,1099",
    `start ${HELPER} --pid 2852 > ${HELPER_LOG}`,
  ]);
  // The launcher went back to its tile; the game stays fullscreen.
  expect(result.windows.get(758)?.width).toBe(1424);
  expect(result.windows.get(762)?.width).toBe(OUTPUT.width);
});

test("a signed-in launcher and a running game are reused: no Steam start, no Play", async () => {
  const result = await world({ runtimes: "launcher", gameRunning: true }).run();
  expect(result.failure).toBeUndefined();
  expect(result.lines.slice(0, 4)).toEqual([
    "1/7 Wine prefix: Battle.net already running in its only runtime (pid 101)",
    "2/7 Battle.net: signed in",
    "3/7 Warcraft III: already running (pid 2852)",
    "3/7 Warcraft III: running (pid 2852), fullscreen",
  ]);
  expect(result.events.filter((event) => event.startsWith("steam") || event === "Play")).toEqual([]);
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
  expect(exits.lines[0]).toBe("1/7 Wine prefix: free");
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
  const noPlay = await world({ playShown: false }).run();
  expect(noPlay.failure).toBe("3/7 Warcraft III stopped: Battle.net doesn't show a Play button. Select Warcraft III in Battle.net, then run play again.");
  expect(noPlay.windows.get(758)?.width).toBe(1424);
  expect((await world({ fullscreens: false }).run()).failure).toBe("3/7 Warcraft III stopped: Battle.net's window didn't become fullscreen within 5 s");
});

test("step 4 stops when the map isn't installed or Warcraft III never shows its main menu", async () => {
  expect((await world({ mapInstalled: false }).run()).failure).toBe(`4/7 Custom game stopped: the map isn't installed: ${MAP}`);
  expect((await world({ mainMenu: false }).run()).failure).toBe("4/7 Custom game stopped: Warcraft III didn't show its main menu within 120 s");
});

test("step 6 reuses this game's helper, refuses an earlier one and reports a helper that stops", async () => {
  const reused = await world({ helper: "this game's" }).run();
  expect(reused.failure).toBeUndefined();
  expect(reused.lines).toContain("6/7 Controller helper: already running for this game (pid 401)");
  expect((await world({ helper: "earlier" }).run()).failure).toBe(
    "6/7 Controller helper stopped: an earlier controller helper is running (pid 400). Stop it with: kill 400   then run play again.");
  expect((await world({ helper: "exits" }).run()).failure).toBe(
    `6/7 Controller helper stopped: the controller helper stopped: wc3-journal: no controller at /dev/input/event9 (log: ${HELPER_LOG})`);
});

test("a problem in the game's own step stops play with that step's name", async () => {
  expect((await world({ opponentFails: true }).run()).failure).toBe("5/7 Opponent stopped: the computer opponent didn't appear in slot 3");
});

test("step 7 stops when the game's window won't take focus", async () => {
  expect((await world({ gameKeepsFocus: false }).run()).failure).toBe("7/7 Fullscreen stopped: Warcraft III's window didn't take focus");
});
