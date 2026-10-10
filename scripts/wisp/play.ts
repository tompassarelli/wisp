import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { Clock, Context, Effect, Exit, Schema, type Scope } from "effect";
import {
  type LaunchOutcome, type PrefixUse, type ProcessInfo, documentsFolder, launchOptions, launchOutcome, launchRequested, launcherConfig, launcherLogDirectory, loadMapOption,
  newestLauncherLog, prefixUse, shortcutAppId, shortcutUrl, signedIn, withLaunchOptions,
} from "../warcraft/battleNet";
import type { Ink, Word } from "../warcraft/desktop";
import { type DisplaySettings, absentSettings, displayChanges, preferencesBackupPath, preferencesPath, withGraphicsMode, withDisplaySettings } from "../warcraft/preferences";
import { SCAN_QUIET_MS, importFailures, ladderScan, sessionStart, war3LogPath } from "../warcraft/war3Log";
import { pollFor } from "./hostProcess";
import { step } from "./timings";
import { type MenuSocket, hostLobby, startLobby } from "./menus";
import { ClientWatch, unlessLost } from "./watch";

export class PlayProblem extends Schema.TaggedError<PlayProblem>()("PlayProblem", {
  problem: Schema.String,
}) {
  override get message(): string {
    return this.problem;
  }
}

export class PlayFailure extends Schema.TaggedError<PlayFailure>()("PlayFailure", {
  step: Schema.Int,
  title: Schema.String,
  problem: Schema.String,
}) {
  override get message(): string {
    return `${this.step}/${STEPS} ${this.title} stopped: ${this.problem}`;
  }
}

export interface DesktopWindow {
  readonly id: number;
  readonly title: string;
  readonly appId: string;
  readonly focused: boolean;
  readonly width: number;
  readonly height: number;

  readonly output?: { readonly name: string; readonly width: number; readonly height: number };
}

export interface XWindow {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface Screen {
  readonly width: number;
  readonly height: number;
  readonly words: readonly Word[];
}

export class PlayMachine extends Context.Service<PlayMachine, {
  readonly processes: Effect.Effect<readonly ProcessInfo[], PlayProblem>;

  readonly serverDirectory: (prefix: string) => Effect.Effect<string, PlayProblem>;
  readonly signal: (pids: readonly number[], signal: "SIGTERM" | "SIGKILL") => Effect.Effect<void>;

  readonly launch: (launcher: ProcessInfo, client: string) => Effect.Effect<void, PlayProblem>;

  readonly openSteam: (url: string) => Effect.Effect<void, PlayProblem>;

  readonly start: (command: readonly string[], log?: string) => Effect.Effect<number, PlayProblem>;

  readonly startService: (unit: string, command: readonly string[], log?: string) => Effect.Effect<void, PlayProblem>;

  readonly startLock: (holder: string, print: (line: string) => void) => Effect.Effect<Effect.Effect<void>, PlayProblem>;

  readonly read: (path: string, from?: number) => Effect.Effect<string | undefined, PlayProblem>;
  readonly size: (path: string) => Effect.Effect<number | undefined, PlayProblem>;

  readonly modified: (path: string) => Effect.Effect<number | undefined, PlayProblem>;

  readonly digest: (path: string) => Effect.Effect<string | undefined, PlayProblem>;
  readonly list: (directory: string) => Effect.Effect<readonly string[], PlayProblem>;

  readonly write: (path: string, text: string) => Effect.Effect<void, PlayProblem>;

  readonly copy: (from: string, to: string) => Effect.Effect<void, PlayProblem>;
}>()("wisp/PlayMachine") {}

export class PlayDesktop extends Context.Service<PlayDesktop, {
  readonly windows: Effect.Effect<readonly DesktopWindow[], PlayProblem>;
  readonly focus: (window: number) => Effect.Effect<void, PlayProblem>;
  readonly toggleFullscreen: (window: number) => Effect.Effect<void, PlayProblem>;

  readonly read: (output: string, ink: Ink) => Effect.Effect<Screen, PlayProblem>;

  readonly xWindow: (title: string, pid?: number) => Effect.Effect<XWindow | undefined, PlayProblem>;
  readonly keys: (window: XWindow, ...keys: string[]) => Effect.Effect<void, PlayProblem>;

  readonly menus: (reportPort: number) => Effect.Effect<MenuSocket | undefined, never, Scope.Scope>;
}>()("wisp/PlayDesktop") {}

export interface PlayGame {

  readonly documents: string;

  readonly pid: number;

  readonly window: number;
  readonly xWindow: XWindow;

  readonly display: string;
}

export interface PlayDeclaration<R = never> {

  readonly prefix: string;

  readonly display: string;

  readonly shortcut: { readonly appId: number; readonly name: string };

  readonly map: { readonly folder: string; readonly file: string; readonly title: string; readonly source?: string };

  readonly gameName: string;

  readonly menuReportPort: number;

  readonly displaySettings?: DisplaySettings;

  readonly graphicsMode?: "classic" | "reforged" | "definitive";

  readonly recommendedSettings?: DisplaySettings;

  readonly prepare: (documents: string) => Effect.Effect<void, PlayProblem, R>;

  readonly cleanup: (documents: string) => Effect.Effect<void, PlayProblem, R>;

  readonly started: (game: PlayGame, since: number) => Effect.Effect<void, PlayProblem, R>;

  readonly match: (game: PlayGame) => Effect.Effect<string, PlayProblem, R>;
  readonly helper: {

    readonly service: (game: PlayGame) => Effect.Effect<string, PlayProblem, R>;
  } | {

    readonly binary: string;

    readonly args: (game: PlayGame) => Effect.Effect<readonly string[], PlayProblem, R>;

    readonly ready: RegExp;

    readonly log: string;
  };
}

const STEPS = 7;

const RESTORE_PREFERENCES = fileURLToPath(new URL("./restorePreferences.ts", import.meta.url));

export const PLAY_TIMEOUTS = {
  runtimeExit: 20,
  launcherStart: 90,
  signIn: 90,
  request: 15,
  next: 10,
  gameFullscreen: 45,
  launch: 45,
  gameWindow: 60,

  gameSignIn: 120,

  ladderScan: 30,
  mainMenu: 120,
  screen: 20,
  started: 120,
  helper: 10,
  fullscreen: 5,
} as const;

const POLL = "250 millis";

const poll = <A, R>(seconds: number, observe: Effect.Effect<A | undefined, PlayProblem, R>) => pollFor(seconds, POLL, observe);

const until = <A, R>(seconds: number, observe: Effect.Effect<A | undefined, PlayProblem, R>, problem: () => string) =>
  poll(seconds, observe).pipe(Effect.filterOrFail((value): value is A => value !== undefined, () => new PlayProblem({ problem: problem() })));

const fail = (problem: string) => Effect.fail(new PlayProblem({ problem }));

const fold = (text: string) => text.toUpperCase().replace(/[^A-Z0-9.]/g, "").replace(/O/g, "0").replace(/[IL]/g, "1");

const isIconNoise = (word: Word | undefined, line: string | undefined) => word === undefined || word.line !== line || fold(word.text).length <= 3;

export function findPhrase(words: readonly Word[], phrase: string, entry = false): readonly { readonly x: number; readonly y: number }[] {
  const target = fold(phrase);
  const found: { x: number; y: number }[] = [];
  if (target === "") return found;
  for (let start = 0; start < words.length; start++) {
    const first = words[start]!;
    let joined = "";
    for (let end = start; end < words.length && words[end]!.line === first.line; end++) {
      joined += fold(words[end]!.text);
      if (joined.length < target.length) continue;
      const last = words[end]!;
      const before = [words[start - 1], words[start - 2]];
      const after = [words[end + 1], words[end + 2]];
      const alone = !entry || (isIconNoise(before[0], first.line) && (before[0]?.line !== first.line || before[1]?.line !== first.line)
        && isIconNoise(after[0], first.line) && (after[0]?.line !== first.line || after[1]?.line !== first.line));
      if (joined === target && alone) found.push({ x: Math.round((first.x + last.x) / 2), y: Math.round((first.y + last.y) / 2) });
      break;
    }
  }
  return found;
}

const isFullscreen = (window: DesktopWindow) =>
  window.output !== undefined && window.width === window.output.width && window.height === window.output.height;

export const play = <R>(declaration: PlayDeclaration<R>, print: (line: string) => void) => Effect.gen(function*() {
  const machine = yield* PlayMachine;
  const desktop = yield* PlayDesktop;
  const { prefix, display, shortcut } = declaration;
  const appId = shortcutAppId(shortcut.appId);
  const logs = launcherLogDirectory(prefix);
  const documents = documentsFolder(prefix);
  const serverDirectory = yield* machine.serverDirectory(prefix).pipe(Effect.mapError(({ problem }) => new PlayFailure({ step: 1, title: "Wine prefix", problem })));

  const status = (step: number, title: string, text: string) => Effect.sync(() => print(`${step}/${STEPS} ${title}: ${text}`));

  const prefixState = machine.processes.pipe(Effect.map((processes) => prefixUse(processes, prefix, serverDirectory)));
  const pidList = (processes: readonly ProcessInfo[]) => processes.map(({ pid }) => pid).join(" ");
  const twoRuntimes = (use: PrefixUse) =>
    `${use.runtimes.length} Wine runtimes are using ${prefix} (wineserver pids ${pidList(use.runtimes)}). A launcher started beside another runtime can't start the game. ` +
    `Close them with: kill ${pidList(use.runtimes)}   then run play again.`;

  const checkPrefix = Effect.gen(function*() {
    let use = yield* prefixState;
    if (use.runtimes.length > 1) return yield* fail(twoRuntimes(use));
    const [runtime] = use.runtimes;
    if (runtime === undefined) return yield* status(1, "Wine prefix", "free");
    if (runtime.display !== undefined && runtime.display !== display) {
      return yield* fail(`${prefix} is in use on display ${runtime.display} (wineserver pid ${runtime.pid}), not this desktop's ${display}. Close that client with: kill ${runtime.pid}   then run play again.`);
    }
    if (use.launcher === undefined) {

      use = yield* until(PLAY_TIMEOUTS.runtimeExit, prefixState.pipe(Effect.map((now) => (now.runtimes.length === 0 || now.launcher !== undefined ? now : undefined))),
        () => `a Wine runtime (wineserver pid ${runtime.pid}) is using ${prefix} without Battle.net. Close it with: kill ${runtime.pid}   then run play again.`);
      if (use.runtimes.length === 0) return yield* status(1, "Wine prefix", "free");
    }
    yield* status(1, "Wine prefix", `Battle.net already running in its only runtime (pid ${use.launcher?.pid})`);
  });

  const loginLog = Effect.gen(function*() {
    const names = (yield* machine.list(logs)).filter((name) => newestLauncherLog([name]) !== undefined).sort().reverse();
    for (const name of names) {
      if (/\[BNLogin\]/.test((yield* machine.read(join(logs, name))) ?? "")) return name;
    }
    return names[0];
  });
  const waitSignedIn = (newerThan: string | undefined) => until(PLAY_TIMEOUTS.signIn, Effect.gen(function*() {
    const log = yield* loginLog;
    if (log === undefined || (newerThan !== undefined && log <= newerThan)) return undefined;
    return signedIn((yield* machine.read(join(logs, log))) ?? "") ? log : undefined;
  }), () => `Battle.net didn't sign in within ${PLAY_TIMEOUTS.signIn} s. Sign in in its window (keep "Keep me logged in" ticked), then run play again.`);

  const startLauncher = (step: number, title: string) => Effect.gen(function*() {
    const before = newestLauncherLog(yield* machine.list(logs));
    const url = shortcutUrl(shortcut.appId);
    yield* machine.openSteam(url);
    yield* status(step, title, `starting the Steam shortcut "${shortcut.name}"`);
    const started = yield* Clock.currentTimeMillis;
    yield* until(PLAY_TIMEOUTS.launcherStart, prefixState.pipe(Effect.flatMap((use) => (use.runtimes.length > 1 ? fail(twoRuntimes(use)) : Effect.succeed(use.launcher)))),
      () => `Steam didn't start Battle.net within ${PLAY_TIMEOUTS.launcherStart} s. Check that Steam is running and still has the shortcut "${shortcut.name}" (steam ${url}).`);
    yield* waitSignedIn(before);
    return Math.round(((yield* Clock.currentTimeMillis) - started) / 1000);
  });

  const configPath = launcherConfig(prefix);
  const mapPath = join(documents, "Maps", declaration.map.folder, declaration.map.file);
  const loadOption = loadMapOption(prefix, mapPath);
  const settings = machine.read(configPath).pipe(Effect.flatMap((text) => (text === undefined
    ? fail(`Battle.net has no settings at ${configPath}; start it once from Steam, then run play again`)
    : Effect.try({ try: () => ({ text, options: launchOptions(text) }), catch: () => new PlayProblem({ problem: `Battle.net's settings at ${configPath} aren't JSON` }) }))));
  const setLaunchOptions = (options: string | undefined) => settings.pipe(Effect.flatMap(({ text }) => machine.write(configPath, withLaunchOptions(text, options))));

  const launcher = Effect.gen(function*() {
    const use = yield* prefixState;
    if (use.game !== undefined) {
      yield* waitSignedIn(undefined);
      yield* status(2, "Battle.net", "signed in; Warcraft III already runs");
      return;
    }
    const { options: previous } = yield* settings;
    if (previous === loadOption) {
      yield* status(2, "Battle.net", "clearing an earlier run's startup map from Warcraft III's launch options");
      if (use.launcher !== undefined) yield* stopPrefix;
      yield* setLaunchOptions(undefined);
    } else if (previous !== undefined && /(?:^|\s)-loadfile(?:\s|$)/i.test(previous)) {
      return yield* fail("Battle.net is set to load another map at startup. Clear its additional command line arguments for Warcraft III and restart Battle.net, then run play again.");
    }
    if (use.launcher !== undefined && previous !== loadOption) {
      yield* waitSignedIn(undefined);
      yield* status(2, "Battle.net", "signed in; reusing it");
    } else {
      const seconds = yield* startLauncher(2, "Battle.net");
      yield* status(2, "Battle.net", `started and signed in (${seconds} s)`);
    }
  });

  const windowTitled = (title: string) => desktop.windows.pipe(Effect.map((windows) => windows.find((window) => window.title === title && window.appId === appId)));
  const windowById = (id: number) => desktop.windows.pipe(Effect.flatMap((windows) => {
    const window = windows.find((candidate) => candidate.id === id);
    return window === undefined ? fail(`window ${id} closed`) : Effect.succeed(window);
  }));

  const asked = new Set<number>();
  const askFullscreen = (id: number) => Effect.gen(function*() {
    yield* desktop.focus(id);
    if (isFullscreen(yield* windowById(id)) || asked.has(id)) return false;
    yield* desktop.toggleFullscreen(id);
    asked.add(id);
    return true;
  });
  const fullscreen = (id: number, what: string, seconds: number = PLAY_TIMEOUTS.fullscreen) => Effect.gen(function*() {
    const toggled = yield* askFullscreen(id);
    yield* until(seconds, windowById(id).pipe(Effect.map((window) => (isFullscreen(window) ? true : undefined))),
      () => `${what} didn't become fullscreen within ${seconds} s`);
    return toggled;
  });
  const leaveFullscreen = (id: number) => desktop.toggleFullscreen(id).pipe(Effect.tap(() => Effect.sync(() => asked.delete(id))));
  const outputOf = (id: number, what: string) => windowById(id).pipe(Effect.flatMap((window) =>
    window.output === undefined ? fail(`${what} isn't on any output`) : Effect.succeed(window.output.name)));

  const launchGame = Effect.gen(function*() {
    const { launcher } = yield* prefixState;
    if (launcher === undefined) return yield* fail("Battle.net isn't running in the prefix");
    const log = yield* loginLog;
    if (log === undefined) return yield* fail(`Battle.net has no log in ${logs}`);
    const path = join(logs, log);
    const offset = (yield* machine.size(path)) ?? 0;
    yield* machine.launch(launcher, "play");
    const since = machine.read(path, offset).pipe(Effect.map((text) => text ?? ""));
    const requested = yield* poll(PLAY_TIMEOUTS.request, since.pipe(Effect.map((text) => (launchRequested(text) || launchOutcome(text) !== undefined ? true : undefined))));
    if (requested === undefined) {
      return yield* fail(`Battle.net didn't launch Warcraft III within ${PLAY_TIMEOUTS.request} s of being asked (its log: ${path}). Check that it is signed in to an account that owns Warcraft III and that the game is installed and up to date, then run play again.`);
    }
    const outcome: LaunchOutcome = (yield* poll(PLAY_TIMEOUTS.launch, since.pipe(Effect.map(launchOutcome))))
      ?? { kind: "failed", reason: `Battle.net reported no launch within ${PLAY_TIMEOUTS.launch} s` };
    return { outcome, log: path };
  });

  const stopPrefix = Effect.gen(function*() {
    const use = yield* prefixState;
    yield* machine.signal(use.processes.map(({ pid }) => pid), "SIGTERM");
    const gone = prefixState.pipe(Effect.map((now) => (now.processes.length === 0 ? true : undefined)));
    if ((yield* poll(PLAY_TIMEOUTS.runtimeExit, gone)) === undefined) {
      yield* machine.signal((yield* prefixState).processes.map(({ pid }) => pid), "SIGKILL");
      yield* until(PLAY_TIMEOUTS.runtimeExit, gone, () => `Battle.net's runtime didn't exit. Close it with: kill -9 ${pidList(use.processes)}   then run play again.`);
    }
    const launch = `AppId=${shortcut.appId}`;
    yield* until(PLAY_TIMEOUTS.runtimeExit, machine.processes.pipe(Effect.map((processes) =>
      (processes.some((process) => process.args.includes("SteamLaunch") && process.args.includes(launch)) ? undefined : true))),
    () => `Steam still runs the shortcut "${shortcut.name}" after Battle.net exited`);
  });

  const installMap = Effect.gen(function*() {
    const { file, source } = declaration.map;
    const installed = yield* machine.digest(mapPath);
    if (source === undefined) return installed === undefined ? yield* fail(`the map isn't installed: ${mapPath}`) : undefined;
    const built = yield* machine.digest(source);
    if (built === undefined) return installed === undefined ? yield* fail(`the map isn't installed (${mapPath}) and its build is missing: ${source}`) : undefined;
    if (installed === built) return;
    yield* machine.copy(source, mapPath);
    if ((yield* machine.digest(mapPath)) !== built) return yield* fail(`the installed map differs from its build after copying: ${mapPath}`);
    yield* status(3, "Warcraft III", `${installed === undefined ? "installed" : "replaced"} ${file} from ${source}`);
  });

  const war3Log = war3LogPath(documents);
  const watched = { name: "the game", documents, menuReportPort: declaration.menuReportPort };
  const clientState = Effect.gen(function*() {
    const watch = yield* Effect.serviceOption(ClientWatch);
    if (watch._tag === "None") return undefined;
    const view = yield* watch.value.view(watched).pipe(Effect.mapError((cause) => new PlayProblem({ problem: cause.message })));
    return view.source === "socket" ? view.state : undefined;
  });
  const preferences = preferencesPath(documents);
  const backup = preferencesBackupPath(documents);

  const savePreferences = Effect.gen(function*() {
    const saved = yield* machine.read(backup);
    const found = saved ?? (yield* machine.read(preferences));
    if (found === undefined) return;
    const declared = declaration.displaySettings;
    const changes = declared === undefined ? [] : displayChanges(found, declared);
    const restored = declared === undefined || changes.length === 0 ? found : withDisplaySettings(found, declared);
    if (changes.length > 0) yield* status(3, "Warcraft III", `restored the declared display settings (${changes.map((change) => `${change.key} was ${change.actual ?? "unset"}`).join(", ")})`);
    const absent = declaration.recommendedSettings === undefined ? {} : absentSettings(restored, declaration.recommendedSettings);
    const video = Object.keys(absent).length === 0 ? restored : withDisplaySettings(restored, absent);
    const text = declaration.graphicsMode === undefined ? video : withGraphicsMode(video, declaration.graphicsMode);
    if (Object.keys(absent).length > 0) yield* status(3, "Warcraft III", `added the recommended settings the file has no value for (${Object.keys(absent).join(", ")})`);
    if (saved === undefined || text !== saved) yield* machine.write(backup, text);
    if (saved !== undefined || text !== found) yield* machine.write(preferences, text);
    yield* status(3, "Warcraft III", `saved ${preferences} as ${backup}; it is put back when the game exits`);
  });
  const restorePreferencesOnExit = (pid: number) => Effect.gen(function*() {
    if ((yield* machine.read(backup)) === undefined) return;
    yield* machine.start([process.execPath, RESTORE_PREFERENCES, String(pid), documents]);
  });
  const game = Effect.gen(function*() {
    yield* installMap;
    yield* declaration.prepare(documents);
    const since = yield* Clock.currentTimeMillis;
    const running = (yield* prefixState).game;

    if (running === undefined) yield* savePreferences;

    let earlierSession: string | undefined;
    if (running !== undefined) {
      yield* status(3, "Warcraft III", `already running (pid ${running.pid})`);
    } else {
      earlierSession = sessionStart((yield* machine.read(war3Log)) ?? "");
      let attempt = yield* launchGame;
      if (attempt.outcome.kind === "failed") {
        yield* status(3, "Warcraft III", `${attempt.outcome.reason}; restarting Battle.net alone, once`);
        yield* stopPrefix;
        yield* startLauncher(3, "Warcraft III");
        attempt = yield* launchGame;
        if (attempt.outcome.kind === "failed") return yield* fail(`${attempt.outcome.reason}, also after restarting Battle.net. Its log: ${attempt.log}`);
      }
      yield* status(3, "Warcraft III", "Battle.net started it");
    }
    const process = yield* until(PLAY_TIMEOUTS.gameWindow, prefixState.pipe(Effect.map((use) => use.game)),
      () => `Battle.net reported Warcraft III running, but its process didn't appear within ${PLAY_TIMEOUTS.gameWindow} s`);
    yield* restorePreferencesOnExit(process.pid);
    const window = yield* until(PLAY_TIMEOUTS.gameWindow, windowTitled("Warcraft III"), () => `Warcraft III's window didn't appear within ${PLAY_TIMEOUTS.gameWindow} s`);

    yield* askFullscreen(window.id);
    const xWindow = yield* until(PLAY_TIMEOUTS.gameWindow, desktop.xWindow("Warcraft III", process.pid),
      () => `Warcraft III's window isn't on display ${display}`);
    yield* status(3, "Warcraft III", `running (pid ${process.pid}), asked to go fullscreen`);
    return { game: { documents, pid: process.pid, window: window.id, xWindow, display } satisfies PlayGame, since, earlierSession };
  });

  const host = (game: PlayGame) => Effect.scoped(Effect.gen(function*() {
    const { folder, title } = declaration.map;
    if ((yield* clientState)?.kind === "in match") {
      yield* fullscreen(game.window, "Warcraft III's window", PLAY_TIMEOUTS.gameFullscreen);
      const output = yield* outputOf(game.window, "Warcraft III's window");
      const hasText = (phrase: string) => desktop.read(output, "gold").pipe(Effect.map((screen) => findPhrase(screen.words, phrase).length > 0 ? true : undefined));
      const key = (...keys: string[]) => pressInGame(game, ...keys);
      yield* key("Escape", "F10");
      yield* until(5, hasText("Game Menu"), () => "The current match didn't open Game Menu");
      yield* key("e");
      yield* until(5, hasText("Quit Mission"), () => "End Game didn't show Quit Mission");
      yield* key("q");
      yield* until(15, clientState.pipe(Effect.map((state) => state?.kind === "results" ? true : undefined)), () => "Quit Mission didn't reach the results screen");

      yield* key("Escape");
      yield* until(10, clientState.pipe(Effect.map((state) => state?.kind === "menus" ? true : undefined)), () => "Results didn't return to the menus");
    }
    const menus = yield* desktop.menus(declaration.menuReportPort);
    if (menus === undefined) {
      return yield* fail(`Warcraft III's menu page didn't report on port ${declaration.menuReportPort}. play hosts only a private game through it, never a listed one by clicks: install the page once, with the owner's agreement, with \`wisp menus install RETAIL_DIR --port ${declaration.menuReportPort}\` (wisp:docs/driving-warcraft.md)`);
    }
    yield* Effect.gen(function*() {
      yield* hostLobby(menus, { folder, file: declaration.map.file, gameName: declaration.gameName, password: "" });
      const since = yield* Clock.currentTimeMillis;
      yield* startLobby(menus);
      yield* declaration.started(game, since);
    }).pipe(Effect.mapError((cause) => cause._tag === "MenuFailure" ? new PlayProblem({ problem: cause.message }) : cause));
    yield* status(4, "Map", `"${declaration.gameName}" of ${title} hosted as a private game through the menus`);
  }));

  const ladderScanned = (earlierSession: string | undefined) => Effect.gen(function*() {
    let quiet: { readonly last: number; readonly count: number; readonly since: number } | undefined;
    let signedInAt: number | undefined;
    const signIn = PLAY_TIMEOUTS.gameSignIn;
    return yield* until(signIn + PLAY_TIMEOUTS.ladderScan, Effect.gen(function*() {
      const text = (yield* machine.read(war3Log)) ?? "";
      const now = yield* Clock.currentTimeMillis;

      if (earlierSession !== undefined && sessionStart(text) === earlierSession) return undefined;
      const state = yield* clientState;
      const authenticated = state !== undefined && (state.kind === "menus" || state.kind === "lobby" || state.kind === "loading" || state.kind === "in match" || state.kind === "results");
      const scan = ladderScan(text, authenticated);
      switch (scan.kind) {
        case "signing in":
          return undefined;
        case "waiting":
          signedInAt ??= now;

          return now - signedInAt >= PLAY_TIMEOUTS.ladderScan * 1000 || (scan.sinceLogin ?? 0) >= PLAY_TIMEOUTS.ladderScan * 1000 ? { text, scanned: false } : undefined;
        case "done":
          return { text, scanned: true };
        case "scanning":
          if (quiet === undefined || quiet.last !== scan.last || quiet.count !== scan.count) quiet = { last: scan.last, count: scan.count, since: now };
          return now - quiet.since >= SCAN_QUIET_MS ? { text, scanned: true } : undefined;
      }
    }), () => signedInAt === undefined
      ? `Warcraft III didn't sign in within ${signIn} s (its log, ${war3Log}, shows no LoginDoorClose)`
      : `Warcraft III didn't finish reading its ladder maps (its log: ${war3Log})`);
  });

  const checkImports = (from: number) => Effect.gen(function*() {
    const failures = importFailures(((yield* machine.read(war3Log)) ?? "").slice(from));
    if (failures.count === 0) return;
    return yield* fail(`Warcraft III couldn't create ${failures.count} of the map's imported models (its log: ${war3Log}, first "model creation failed - ${failures.first}"), so the stage and fighters won't draw. ` +
      "Quit Warcraft III and run play again.");
  });

  const loadMap = (game: PlayGame, since: number, earlierSession: string | undefined) => Effect.gen(function*() {
    const { text, scanned } = yield* ladderScanned(earlierSession);
    const waited = Math.round(((yield* Clock.currentTimeMillis) - since) / 1000);
    yield* status(4, "Map", scanned
      ? `Warcraft III signed in and read its ladder maps (${waited} s); hosting the map`
      : `Warcraft III signed in and read no ladder maps within ${PLAY_TIMEOUTS.ladderScan} s; hosting the map`);
    yield* host(game);
    yield* checkImports(text.length);
    const seconds = Math.round(((yield* Clock.currentTimeMillis) - since) / 1000);
    yield* status(4, "Map", `fighter selection ${seconds} s after launch`);
    return text.length;
  });

  const helper = (game: PlayGame) => Effect.gen(function*() {
    if ("service" in declaration.helper) return yield* status(5, "Controller helper", yield* declaration.helper.service(game));
    const { binary, ready, log } = declaration.helper;
    const earlier = (yield* machine.processes).filter((process) => process.args[0] === binary);
    const mine = earlier.find((process) => process.args.some((arg, index) => arg === "--pid" && process.args[index + 1] === String(game.pid)));
    if (mine !== undefined) return yield* status(5, "Controller helper", `already running for this game (pid ${mine.pid})`);
    if (earlier.length > 0) return yield* fail(`an earlier controller helper is running (pid ${pidList(earlier)}). Stop it with: kill ${pidList(earlier)}   then run play again.`);
    const args = yield* declaration.helper.args(game);
    const offset = (yield* machine.size(log)) ?? 0;
    const pid = yield* machine.start([binary, ...args], log);
    const output = machine.read(log, offset).pipe(Effect.map((text) => text ?? ""));
    yield* until(PLAY_TIMEOUTS.helper, Effect.gen(function*() {
      const text = yield* output;
      if (ready.test(text)) return true;
      if (!(yield* machine.processes).some((process) => process.pid === pid)) {
        const last = text.trim().split("\n").at(-1) ?? "";
        return yield* fail(`the controller helper stopped${last === "" ? "" : `: ${last}`} (log: ${log})`);
      }
      return undefined;
    }), () => `the controller helper didn't report ready within ${PLAY_TIMEOUTS.helper} s (log: ${log})`);
    yield* status(5, "Controller helper", `running (pid ${pid}), log ${log}`);
  });

  yield* Effect.gen(function*() {
    yield* checkPrefix.pipe(inStep(1, "Wine prefix"));
    yield* launcher.pipe(inStep(2, "Battle.net"));
    const { game: running, since, earlierSession } = yield* game.pipe(inStep(3, "Warcraft III"));

    const watching = <A, R2>(effect: Effect.Effect<A, PlayProblem, R2>) => unlessLost(watched, effect).pipe(Effect.mapError((cause) => (cause._tag === "WatchFailure" ? new PlayProblem({ problem: `Warcraft III ${cause.problem}` }) : cause)));
    const hosted = yield* watching(loadMap(running, since, earlierSession)).pipe(inStep(4, "Map"));

    yield* helper(running).pipe(inStep(5, "Controller helper"));
    const match = yield* Effect.gen(function*() {
      const match = yield* watching(declaration.match(running));

      yield* checkImports(hosted);
      return match;
    }).pipe(inStep(6, "Match"));
    yield* status(6, "Match", match);
    yield* Effect.gen(function*() {
      yield* fullscreen(running.window, "Warcraft III's window", PLAY_TIMEOUTS.gameFullscreen);
      yield* until(PLAY_TIMEOUTS.fullscreen, windowById(running.window).pipe(Effect.map((window) => (window.focused ? true : undefined))),
        () => "Warcraft III's window didn't take focus");
      yield* status(7, "Fullscreen", "Warcraft III is fullscreen and focused. Ready to fight.");
    }).pipe(inStep(7, "Fullscreen"));
  }).pipe(Effect.onExit((exit) => (Exit.isFailure(exit)
    ? declaration.cleanup(documents).pipe(Effect.ignore)
    : Effect.void)));
});

const pressInGame = (game: { readonly window: number; readonly xWindow: XWindow }, ...keys: string[]) =>
  Effect.gen(function*() {
    const desktop = yield* PlayDesktop;
    yield* desktop.focus(game.window);
    yield* desktop.keys(game.xWindow, ...keys);
  });

export const leaveScoreScreen = (declaration: { readonly prefix: string; readonly shortcut: { readonly appId: number } }) => Effect.gen(function*() {
  const machine = yield* PlayMachine;
  const desktop = yield* PlayDesktop;
  const serverDirectory = yield* machine.serverDirectory(declaration.prefix);
  const { game } = prefixUse(yield* machine.processes, declaration.prefix, serverDirectory);
  if (game === undefined) return yield* fail("Warcraft III isn't running, so its score screen can't be left");
  const appId = shortcutAppId(declaration.shortcut.appId);
  const window = (yield* desktop.windows).find((candidate) => candidate.title === "Warcraft III" && candidate.appId === appId);
  const xWindow = yield* desktop.xWindow("Warcraft III", game.pid);
  if (window === undefined || xWindow === undefined) return yield* fail("Warcraft III's window isn't on this desktop, so its score screen can't be left");
  yield* pressInGame({ window: window.id, xWindow }, "Escape");
});

const inStep = (number: number, title: string) => <A, R>(effect: Effect.Effect<A, PlayProblem, R>) =>
  effect.pipe(Effect.mapError(({ problem }) => new PlayFailure({ step: number, title, problem })), step(`${number}/${STEPS} ${title}`));
