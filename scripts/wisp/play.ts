// `play`: one command from the owner's desktop to a match. It checks that at
// most one Wine runtime uses the game's prefix, starts or reuses the signed-in
// Battle.net launcher through its Steam shortcut, presses Play, hosts a custom
// game of the map, lets the game add its computer opponent at its first
// screen, starts the game's controller helper, and leaves Warcraft III
// fullscreen and focused so pointer focus can't leave it. Each step prints one
// status line; the first problem stops the run with a plain message.
//
// It never signs in or out, never starts Warcraft III.exe itself (only the
// launcher's Play does), and never starts a runtime while another uses the
// prefix: a launcher started beside another runtime can't start the game.
// Warcraft's menus are found by the text they show, so any screen size works.
// The game's window is fullscreen while play drives it, so a capture of its
// output is the game's frame.
import { join } from "node:path";
import { Clock, Context, Effect, Schema } from "effect";
import {
  type LaunchOutcome, type PrefixUse, type ProcessInfo, documentsFolder, launchOutcome, launchRequested, launcherLogDirectory, newestLauncherLog,
  prefixUse, shortcutAppId, shortcutUrl, signedIn,
} from "../warcraft/battleNet";
import type { Ink, Word } from "../warcraft/desktop";
import { step } from "./timings";

/** Why play can't go on, in words for the person who ran it. */
export class PlayProblem extends Schema.TaggedError<PlayProblem>()("PlayProblem", {
  problem: Schema.String,
}) {
  override get message(): string {
    return this.problem;
  }
}

/** The step a problem stopped play at. */
export class PlayFailure extends Schema.TaggedError<PlayFailure>()("PlayFailure", {
  step: Schema.Int,
  title: Schema.String,
  problem: Schema.String,
}) {
  override get message(): string {
    return `${this.step}/${STEPS} ${this.title} stopped: ${this.problem}`;
  }
}

/** A window of the owner's compositor. Sizes are logical pixels. */
export interface DesktopWindow {
  readonly id: number;
  readonly title: string;
  readonly appId: string;
  readonly focused: boolean;
  readonly width: number;
  readonly height: number;
  /** The output that shows the window's workspace. */
  readonly output?: { readonly name: string; readonly width: number; readonly height: number };
}

/** A window of the game's X display, in its root window's pixels. */
export interface XWindow {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** The words on an output, at the size it was read. */
export interface Screen {
  readonly width: number;
  readonly height: number;
  readonly words: readonly Word[];
}

/**
 * A place to click: a point of an image `area` that covers `output` exactly,
 * as its capture or the fullscreen X window on it does, and that X window.
 */
export interface Spot {
  readonly output: string;
  readonly area: { readonly width: number; readonly height: number };
  readonly x: number;
  readonly y: number;
  readonly window: XWindow;
}

/** An output's place in the compositor's logical pixels, which its pointer moves in. */
export interface OutputArea {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** Where a spot is in the compositor's logical pixels and in the X root window's pixels. */
export function spotTargets(spot: Spot, output: OutputArea) {
  const across = spot.x / spot.area.width;
  const down = spot.y / spot.area.height;
  return {
    logical: { x: output.x + across * output.width, y: output.y + down * output.height },
    root: { x: spot.window.x + Math.round(across * spot.window.width), y: spot.window.y + Math.round(down * spot.window.height) },
  };
}

/**
 * The compositor pointer move, in logical pixels, from where the X pointer is
 * to the spot. Over an X window the X pointer is where the compositor's is
 * (2880x1920 X pixels for a 1440x960 logical output at scale 2).
 */
export function pointerMove(spot: Spot, output: OutputArea, at: { readonly x: number; readonly y: number }) {
  const { logical } = spotTargets(spot, output);
  const now = { x: output.x + (at.x - spot.window.x) * output.width / spot.window.width, y: output.y + (at.y - spot.window.y) * output.height / spot.window.height };
  return { dx: logical.x - now.x, dy: logical.y - now.y };
}

/** The host: its processes and files. */
export class PlayMachine extends Context.Service<PlayMachine, {
  readonly processes: Effect.Effect<readonly ProcessInfo[], PlayProblem>;
  /** The name of the directory Wine's server for `prefix` lives in. */
  readonly serverDirectory: (prefix: string) => Effect.Effect<string, PlayProblem>;
  readonly signal: (pids: readonly number[], signal: "SIGTERM" | "SIGKILL") => Effect.Effect<void>;
  /** Hands Steam a steam:// URL, as the shortcut's desktop entry does. */
  readonly openSteam: (url: string) => Effect.Effect<void, PlayProblem>;
  /** Starts a program that outlives play; its output goes to `log`, appended, or nowhere. Returns its pid. */
  readonly start: (command: readonly string[], log?: string) => Effect.Effect<number, PlayProblem>;
  /** A file's text from byte `from`; undefined while it doesn't exist. */
  readonly read: (path: string, from?: number) => Effect.Effect<string | undefined, PlayProblem>;
  readonly size: (path: string) => Effect.Effect<number | undefined, PlayProblem>;
  readonly list: (directory: string) => Effect.Effect<readonly string[], PlayProblem>;
  /** Appends to a file, creating it and its folder. */
  readonly append: (path: string, text: string) => Effect.Effect<void, PlayProblem>;
}>()("wisp/PlayMachine") {}

/** The owner's desktop: its compositor's windows and outputs, and the game's X display. */
export class PlayDesktop extends Context.Service<PlayDesktop, {
  readonly windows: Effect.Effect<readonly DesktopWindow[], PlayProblem>;
  readonly focus: (window: number) => Effect.Effect<void, PlayProblem>;
  readonly toggleFullscreen: (window: number) => Effect.Effect<void, PlayProblem>;
  /** Captures an output and reads its words, with centres in the capture's pixels. */
  readonly read: (output: string, ink: Ink) => Effect.Effect<Screen, PlayProblem>;
  /** The largest visible X window with this exact title, preferring those of process `pid`. */
  readonly xWindow: (title: string, pid?: number) => Effect.Effect<XWindow | undefined, PlayProblem>;
  /** Saves a picture of an output to `path`, creating its folder. */
  readonly snapshot: (output: string, path: string) => Effect.Effect<void, PlayProblem>;
  /**
   * Moves the compositor's pointer to a spot, as a mouse would, checks the X
   * pointer got there, and clicks. Returns each move and where the pointer
   * then was, for the click log.
   */
  readonly click: (spot: Spot) => Effect.Effect<readonly string[], PlayProblem>;
  readonly keys: (window: XWindow, ...keys: string[]) => Effect.Effect<void, PlayProblem>;
  readonly typeText: (window: XWindow, text: string) => Effect.Effect<void, PlayProblem>;
}>()("wisp/PlayDesktop") {}

/** The running game, as the consuming game's steps see it. */
export interface PlayGame {
  /** Its Documents/Warcraft III folder. */
  readonly documents: string;
  /** Warcraft III's process. */
  readonly pid: number;
  /** Its compositor window. */
  readonly window: number;
  readonly xWindow: XWindow;
  /** Its X display. */
  readonly display: string;
  /**
   * Clicks where a map frame placed at Warcraft's UI coordinates (x from 0 to
   * 0.8 over the centred 4:3 area, y from 0 at the bottom to 0.6) appears; x
   * outside 0 to 0.8 reaches the widescreen margins.
   */
  readonly clickUi: (x: number, y: number) => Effect.Effect<void, PlayProblem>;
}

export interface PlayDeclaration<R = never> {
  /** The Wine prefix (the pfx folder) Battle.net and Warcraft III run in. */
  readonly prefix: string;
  /** The X display of the owner's desktop, where the game runs. */
  readonly display: string;
  /** The Steam shortcut that starts Battle.net Launcher.exe in the prefix: its app id and its name in Steam. */
  readonly shortcut: { readonly appId: number; readonly name: string };
  /** The map: its folder under Maps, its file, and the title Create Game lists it by. */
  readonly map: { readonly folder: string; readonly file: string; readonly title: string };
  /** The hosted game's name; joining by name is case-sensitive. */
  readonly gameName: string;
  /** Each run saves a picture before and after every click, and its click log, in a folder here named by its start time. */
  readonly debugDirectory: string;
  /** Resolves once the started map shows its first screen; `since` is when Start was pressed, on the Effect Clock. */
  readonly started: (game: PlayGame, since: number) => Effect.Effect<void, PlayProblem, R>;
  /** Adds the computer opponent at that screen and describes it, as in "computer in slot 2". */
  readonly opponent: (game: PlayGame) => Effect.Effect<string, PlayProblem, R>;
  readonly helper: {
    /** The helper's executable; a running process of it is an earlier helper. */
    readonly binary: string;
    /** Its arguments for this game. */
    readonly args: (game: PlayGame) => Effect.Effect<readonly string[], PlayProblem, R>;
    /** Output that means it is ready. */
    readonly ready: RegExp;
    /** Where its output goes. */
    readonly log: string;
  };
}

const STEPS = 7;

/** Seconds each wait may take. */
export const PLAY_TIMEOUTS = {
  runtimeExit: 20,
  launcherStart: 90,
  signIn: 90,
  window: 30,
  request: 15,
  tile: 6,
  launch: 45,
  gameWindow: 60,
  mainMenu: 120,
  screen: 20,
  started: 120,
  helper: 10,
  fullscreen: 5,
} as const;

const POLL = "250 millis";

/** Polls `observe` until it returns a value, or undefined after `seconds` of the Effect Clock. */
const poll = <A, R>(seconds: number, observe: Effect.Effect<A | undefined, PlayProblem, R>) =>
  Effect.gen(function*() {
    const deadline = (yield* Clock.currentTimeMillis) + seconds * 1000;
    while (true) {
      const value = yield* observe;
      if (value !== undefined || (yield* Clock.currentTimeMillis) >= deadline) return value;
      yield* Effect.sleep(POLL);
    }
  });

/** Polls `observe` until it returns a value; after `seconds` fails with `problem`. */
const until = <A, R>(seconds: number, observe: Effect.Effect<A | undefined, PlayProblem, R>, problem: () => string) =>
  poll(seconds, observe).pipe(Effect.filterOrFail((value): value is A => value !== undefined, () => new PlayProblem({ problem: problem() })));

const fail = (problem: string) => Effect.fail(new PlayProblem({ problem }));

/** Text folded so OCR's usual confusions (O/0, I/l/1, case, punctuation) compare equal. */
const fold = (text: string) => text.toUpperCase().replace(/[^A-Z0-9.]/g, "").replace(/O/g, "0").replace(/[IL]/g, "1");

/** A short word the reader makes of an icon beside a list entry. */
const isIconNoise = (word: Word | undefined, line: string | undefined) => word === undefined || word.line !== line || fold(word.text).length <= 3;

/**
 * Where `phrase` appears among `words`: consecutive words of one line whose
 * folded text joins to the phrase's, however the reader split them. As an
 * `entry`, as in a list, the phrase is its line's text, allowing one short
 * word for an icon on each side.
 */
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

/** The lowest of a phrase's places: buttons sit below the titles that repeat their text. */
const lowest = (places: readonly { readonly x: number; readonly y: number }[]) =>
  places.reduce<{ readonly x: number; readonly y: number } | undefined>((best, place) => (best === undefined || place.y > best.y ? place : best), undefined);

/** The highest of a phrase's places: a tab bar sits above the pages that repeat its words. */
const topmost = (places: readonly { readonly x: number; readonly y: number }[]) =>
  places.reduce<{ readonly x: number; readonly y: number } | undefined>((best, place) => (best === undefined || place.y < best.y ? place : best), undefined);

/**
 * Where the launcher names Warcraft III: "Warcraft" followed by III (read as
 * III, Ill, lll), or alone where the reader dropped the numeral. "World of
 * Warcraft", "Warcraft II" and "Warcraft Rumble" are other games.
 */
export function warcraftThree(words: readonly Word[]): readonly { readonly x: number; readonly y: number }[] {
  return words.flatMap((word, index) => {
    if (fold(word.text) !== "WARCRAFT") return [];
    const before = words[index - 1];
    const after = words[index + 1];
    if (before !== undefined && before.line === word.line && fold(before.text) === "0F") return [];
    if (after === undefined || after.line !== word.line) return [{ x: word.x, y: word.y }];
    return fold(after.text) === "111" ? [{ x: Math.round((word.x + after.x) / 2), y: Math.round((word.y + after.y) / 2) }] : [];
  });
}

/**
 * Where to click a game's tile in Battle.net's Games tab, given its label.
 * The label under the tile's art doesn't take clicks; the art does. Tiles
 * are as tall as they are apart (labels of one row, each its own line, about
 * 381 px apart on 6 Oct), so the art's centre is about 0.6 of that above the
 * label and its upper half 0.5 above.
 */
export function tileArt(words: readonly Word[], label: { readonly x: number; readonly y: number }) {
  const starts = words.filter((word, index) => Math.abs(word.y - label.y) <= 8 && (index === 0 || words[index - 1]!.line !== word.line))
    .map(({ x }) => x).sort((a, b) => a - b);
  const gaps = starts.slice(1).map((x, index) => x - starts[index]!).filter((gap) => gap > 100).sort((a, b) => a - b);
  const pitch = gaps[Math.floor(gaps.length / 2)] ?? TILE_PITCH;
  return { first: { x: label.x, y: Math.round(label.y - pitch / 2) }, retry: { x: label.x, y: Math.round(label.y - pitch * 0.6) } };
}

/** The Games tab's tile pitch on 6 Oct (Battle.net 2.53), for a row with one tile. */
const TILE_PITCH = 381;

/**
 * Warcraft III's Play button, when the launcher shows Warcraft III: its game
 * version box names the game about 80 pixels above Play (Battle.net 2.53,
 * whatever the window's size).
 */
export function warcraftPlay(page: { readonly light: Screen; readonly white: Screen }) {
  const names = warcraftThree(page.light.words);
  return findPhrase(page.white.words, "Play")
    .filter((play) => names.some((name) => play.y - name.y > 0 && play.y - name.y <= 200 && Math.abs(play.x - name.x) <= 400))
    .reduce<{ readonly x: number; readonly y: number } | undefined>((best, place) => (best === undefined || place.y > best.y ? place : best), undefined);
}

const isFullscreen = (window: DesktopWindow) =>
  window.output !== undefined && window.width === window.output.width && window.height === window.output.height;

/** Warcraft's UI coordinates in a window's own pixels: the 4:3 area is centred and spans the height. */
export function uiPoint(window: { readonly width: number; readonly height: number }, x: number, y: number) {
  const unit = window.height / 0.6;
  return { x: Math.round(window.width / 2 + (x - 0.4) * unit), y: Math.round((0.6 - y) * unit) };
}

/**
 * Create Game's game name field on a 2560x1440 frame. Warcraft's menus scale
 * with the frame's height and keep their left column on the left edge.
 */
const GAME_NAME_FIELD = { x: 400, y: 340 };

/** Runs the declared playtest, printing one status line per step. */
export const play = <R>(declaration: PlayDeclaration<R>, print: (line: string) => void) => Effect.gen(function*() {
  const machine = yield* PlayMachine;
  const desktop = yield* PlayDesktop;
  const { prefix, display, shortcut } = declaration;
  const appId = shortcutAppId(shortcut.appId);
  const logs = launcherLogDirectory(prefix);
  const documents = documentsFolder(prefix);
  const serverDirectory = yield* machine.serverDirectory(prefix).pipe(Effect.mapError(({ problem }) => new PlayFailure({ step: 1, title: "Wine prefix", problem })));

  const status = (step: number, title: string, text: string) => Effect.sync(() => print(`${step}/${STEPS} ${title}: ${text}`));

  const debug = join(declaration.debugDirectory, new Date(yield* Clock.currentTimeMillis).toISOString().replace(/[:.]/g, "-"));
  const clickLog = join(debug, "clicks.log");
  print(`Captures and click log: ${debug}`);
  let clicks = 0;
  /** A click, with a picture of its output before and after it and its pointer moves in the click log. */
  const clickSpot = (what: string, window: number, spot: Spot) => Effect.gen(function*() {
    const name = `${String(++clicks).padStart(2, "0")}-${what.replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "").toLowerCase()}`;
    yield* desktop.focus(window);
    yield* desktop.snapshot(spot.output, join(debug, `${name}-before.jpg`));
    const moves = yield* desktop.click(spot).pipe(Effect.tapError(({ problem }) => machine.append(clickLog, `${name}: ${spot.x},${spot.y} of ${spot.area.width}x${spot.area.height} on ${spot.output}: ${problem}\n`)));
    yield* machine.append(clickLog, `${name}: ${spot.x},${spot.y} of ${spot.area.width}x${spot.area.height} on ${spot.output}; ${moves.join("; ")}\n`);
    // The picture after shows what the click changed.
    yield* Effect.sleep("300 millis");
    yield* desktop.snapshot(spot.output, join(debug, `${name}-after.jpg`));
  });
  const prefixState = machine.processes.pipe(Effect.map((processes) => prefixUse(processes, prefix, serverDirectory)));
  const pidList = (processes: readonly ProcessInfo[]) => processes.map(({ pid }) => pid).join(" ");
  const twoRuntimes = (use: PrefixUse) =>
    `${use.runtimes.length} Wine runtimes are using ${prefix} (wineserver pids ${pidList(use.runtimes)}). A launcher started beside another runtime can't start the game. ` +
    `Close them with: kill ${pidList(use.runtimes)}   then run play again.`;

  // 1. At most one runtime, on this display, and only with Battle.net in it.
  const checkPrefix = Effect.gen(function*() {
    let use = yield* prefixState;
    if (use.runtimes.length > 1) return yield* fail(twoRuntimes(use));
    const [runtime] = use.runtimes;
    if (runtime === undefined) return yield* status(1, "Wine prefix", "free");
    if (runtime.display !== undefined && runtime.display !== display) {
      return yield* fail(`${prefix} is in use on display ${runtime.display} (wineserver pid ${runtime.pid}), not this desktop's ${display}. Close that client with: kill ${runtime.pid}   then run play again.`);
    }
    if (use.launcher === undefined) {
      // A runtime outlives its last program by a few seconds.
      use = yield* until(PLAY_TIMEOUTS.runtimeExit, prefixState.pipe(Effect.map((now) => (now.runtimes.length === 0 || now.launcher !== undefined ? now : undefined))),
        () => `a Wine runtime (wineserver pid ${runtime.pid}) is using ${prefix} without Battle.net. Close it with: kill ${runtime.pid}   then run play again.`);
      if (use.runtimes.length === 0) return yield* status(1, "Wine prefix", "free");
    }
    yield* status(1, "Wine prefix", `Battle.net already running in its only runtime (pid ${use.launcher?.pid})`);
  });

  // 2. A launcher whose log says it signed in.
  const waitSignedIn = (newerThan: string | undefined) => until(PLAY_TIMEOUTS.signIn, Effect.gen(function*() {
    const log = newestLauncherLog(yield* machine.list(logs));
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

  const launcher = Effect.gen(function*() {
    if ((yield* prefixState).launcher !== undefined) {
      yield* waitSignedIn(undefined);
      return yield* status(2, "Battle.net", "signed in");
    }
    const seconds = yield* startLauncher(2, "Battle.net");
    yield* status(2, "Battle.net", `started and signed in (${seconds} s)`);
  });

  // 3. Play in the launcher, confirmed by its log; one restart of the launcher alone when it can't launch.
  const windowTitled = (title: string) => desktop.windows.pipe(Effect.map((windows) => windows.find((window) => window.title === title && window.appId === appId)));
  const windowById = (id: number) => desktop.windows.pipe(Effect.flatMap((windows) => {
    const window = windows.find((candidate) => candidate.id === id);
    return window === undefined ? fail(`window ${id} closed`) : Effect.succeed(window);
  }));
  /** Focuses a window and makes it fullscreen; true when it had to toggle fullscreen on. */
  const fullscreen = (id: number, what: string) => Effect.gen(function*() {
    yield* desktop.focus(id);
    if (isFullscreen(yield* windowById(id))) return false;
    yield* desktop.toggleFullscreen(id);
    yield* until(PLAY_TIMEOUTS.fullscreen, windowById(id).pipe(Effect.map((window) => (isFullscreen(window) ? true : undefined))),
      () => `${what} didn't become fullscreen within ${PLAY_TIMEOUTS.fullscreen} s`);
    return true;
  });
  const outputOf = (id: number, what: string) => windowById(id).pipe(Effect.flatMap((window) =>
    window.output === undefined ? fail(`${what} isn't on any output`) : Effect.succeed(window.output.name)));
  const sameShape = (screen: Screen, window: XWindow, what: string) =>
    Math.abs(window.width / window.height - screen.width / screen.height) < 0.02
      ? Effect.void
      : fail(`${what} isn't covering its screen (window ${window.width}x${window.height}, screen ${screen.width}x${screen.height})`);

  const pressPlay = Effect.gen(function*() {
    const window = yield* until(PLAY_TIMEOUTS.window, windowTitled("Battle.net"), () => `Battle.net's window didn't appear within ${PLAY_TIMEOUTS.window} s`);
    const toggled = yield* fullscreen(window.id, "Battle.net's window");
    // The launcher's window goes back to its place once Play is pressed, or play stopped.
    const { path, offset } = yield* Effect.gen(function*() {
      const output = yield* outputOf(window.id, "Battle.net's window");
      const xWindow = yield* desktop.xWindow("Battle.net").pipe(Effect.filterOrFail((found) => found !== undefined, () => new PlayProblem({ problem: "Battle.net's window isn't on this desktop's X display" })));
      // Labels read as light text; Play is white on its blue button.
      const page = Effect.gen(function*() {
        const light = yield* desktop.read(output, "light");
        const white = yield* desktop.read(output, "white");
        yield* sameShape(light, xWindow, "Battle.net's window");
        return { light, white };
      });
      const click = (screen: Screen, place: { readonly x: number; readonly y: number }, what: string) =>
        clickSpot(what, window.id, { output, area: screen, x: place.x, y: place.y, window: xWindow });
      let seen = yield* until(PLAY_TIMEOUTS.screen, page.pipe(Effect.map((now) => (warcraftPlay(now) !== undefined || topmost(findPhrase(now.light.words, "Games")) !== undefined ? now : undefined))),
        () => "Battle.net's window shows neither its Games tab nor Warcraft III's Play button");
      // Battle.net opens on the game it last showed or features, such as WoW: Forever; its Games tab lists Warcraft III.
      if (warcraftPlay(seen) === undefined) {
        yield* click(seen.light, topmost(findPhrase(seen.light.words, "Games"))!, "Battle.net Games");
        seen = yield* until(PLAY_TIMEOUTS.screen, page.pipe(Effect.map((now) => (warcraftThree(now.light.words).length > 0 ? now : undefined))),
          () => "Battle.net's Games tab doesn't list Warcraft III");
        const tile = tileArt(seen.light.words, topmost(warcraftThree(seen.light.words))!);
        const opened = page.pipe(Effect.map((now) => (warcraftPlay(now) !== undefined ? now : undefined)));
        yield* click(seen.light, tile.first, "Battle.net Warcraft III tile");
        const first = yield* poll(PLAY_TIMEOUTS.tile, opened);
        if (first === undefined) yield* click(seen.light, tile.retry, "Battle.net Warcraft III tile again");
        seen = first ?? (yield* until(PLAY_TIMEOUTS.screen, opened,
          () => `Battle.net didn't show Warcraft III's Play after two clicks on its Games tile. If it is installing or updating, let it finish, then run play again (pictures and click log: ${debug})`));
      }
      const log = newestLauncherLog(yield* machine.list(logs));
      if (log === undefined) return yield* fail(`Battle.net has no log in ${logs}`);
      const path = join(logs, log);
      const offset = (yield* machine.size(path)) ?? 0;
      yield* click(seen.white, warcraftPlay(seen)!, "Battle.net Play");
      return { path, offset };
    }).pipe(Effect.ensuring(toggled ? desktop.toggleFullscreen(window.id).pipe(Effect.ignore) : Effect.void));
    const since = machine.read(path, offset).pipe(Effect.map((text) => text ?? ""));
    const requested = yield* poll(PLAY_TIMEOUTS.request, since.pipe(Effect.map((text) => (launchRequested(text) || launchOutcome(text) !== undefined ? true : undefined))));
    if (requested === undefined) {
      return yield* fail(`Battle.net didn't take the Play click: its log has no launch request within ${PLAY_TIMEOUTS.request} s (pictures and click log: ${debug})`);
    }
    const outcome: LaunchOutcome = (yield* poll(PLAY_TIMEOUTS.launch, since.pipe(Effect.map(launchOutcome))))
      ?? { kind: "failed", reason: `Battle.net reported no launch within ${PLAY_TIMEOUTS.launch} s` };
    return { outcome, log: path };
  });

  /** Ends every program of the prefix, then waits for Steam to see the shortcut end, so it can start it again. */
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

  const game = Effect.gen(function*() {
    const running = (yield* prefixState).game;
    if (running !== undefined) {
      yield* status(3, "Warcraft III", `already running (pid ${running.pid})`);
    } else {
      let attempt = yield* pressPlay;
      if (attempt.outcome.kind === "failed") {
        yield* status(3, "Warcraft III", `${attempt.outcome.reason}; restarting Battle.net alone, once`);
        yield* stopPrefix;
        yield* startLauncher(3, "Warcraft III");
        attempt = yield* pressPlay;
        if (attempt.outcome.kind === "failed") return yield* fail(`${attempt.outcome.reason}, also after restarting Battle.net. Its log: ${attempt.log}`);
      }
      yield* status(3, "Warcraft III", "Battle.net's Play started it");
    }
    const process = yield* until(PLAY_TIMEOUTS.gameWindow, prefixState.pipe(Effect.map((use) => use.game)),
      () => `Battle.net reported Warcraft III running, but its process didn't appear within ${PLAY_TIMEOUTS.gameWindow} s`);
    const window = yield* until(PLAY_TIMEOUTS.gameWindow, windowTitled("Warcraft III"), () => `Warcraft III's window didn't appear within ${PLAY_TIMEOUTS.gameWindow} s`);
    yield* fullscreen(window.id, "Warcraft III's window");
    const xWindow = yield* until(PLAY_TIMEOUTS.gameWindow, desktop.xWindow("Warcraft III", process.pid),
      () => `Warcraft III's window isn't on display ${display}`);
    const output = yield* outputOf(window.id, "Warcraft III's window");
    yield* status(3, "Warcraft III", `running (pid ${process.pid}), fullscreen`);
    return {
      documents, pid: process.pid, window: window.id, xWindow, display,
      clickUi: (x: number, y: number) => clickSpot(`map UI ${x.toFixed(3)} ${y.toFixed(3)}`, window.id, { output, area: xWindow, ...uiPoint(xWindow, x, y), window: xWindow }),
    } satisfies PlayGame;
  });

  // 4. Custom Games, Create Game, the map's folder, the map, the game's name, Create, Start.
  const host = (game: PlayGame) => Effect.gen(function*() {
    const { folder, file, title } = declaration.map;
    const mapPath = join(documents, "Maps", folder, file);
    if ((yield* machine.size(mapPath)) === undefined) return yield* fail(`the map isn't installed: ${mapPath}`);
    yield* desktop.focus(game.window);
    const output = yield* outputOf(game.window, "Warcraft III's window");
    const read = desktop.read(output, "light");
    const seen = (seconds: number, accept: (screen: Screen) => boolean, problem: string) =>
      until(seconds, read.pipe(Effect.map((screen) => (accept(screen) ? screen : undefined))), () => problem);
    const has = (screen: Screen, phrase: string, wholeLine = false) => findPhrase(screen.words, phrase, wholeLine).length > 0;
    const click = (screen: Screen, place: { readonly x: number; readonly y: number } | undefined, what: string) => Effect.gen(function*() {
      if (place === undefined) return yield* fail(`${what} isn't on the screen`);
      yield* sameShape(screen, game.xWindow, "Warcraft III's window");
      yield* clickSpot(what, game.window, { output, area: screen, x: place.x, y: place.y, window: game.xWindow });
    });
    const mapShown = (screen: Screen) => has(screen, title, true) || has(screen, folder, true);
    const createButton = (screen: Screen) => lowest(findPhrase(screen.words, "Create Game"));

    let screen = yield* seen(PLAY_TIMEOUTS.mainMenu, (now) => has(now, "Multiplayer") || has(now, "Custom Games") || mapShown(now),
      `Warcraft III didn't show its main menu within ${PLAY_TIMEOUTS.mainMenu} s`);
    if (!mapShown(screen) && !has(screen, "Custom Games")) {
      yield* click(screen, lowest(findPhrase(screen.words, "Multiplayer")), "Multiplayer");
      screen = yield* seen(PLAY_TIMEOUTS.screen, (now) => has(now, "Custom Games"), "Multiplayer didn't open Battle.net's Custom Games");
    }
    if (!mapShown(screen)) {
      if (createButton(screen) === undefined) {
        yield* click(screen, lowest(findPhrase(screen.words, "Custom Games")), "Custom Games");
        screen = yield* seen(PLAY_TIMEOUTS.screen, (now) => createButton(now) !== undefined, "Custom Games didn't show Create Game");
      }
      yield* click(screen, createButton(screen), "Create Game");
      screen = yield* seen(PLAY_TIMEOUTS.screen, mapShown, `Create Game didn't list the folder ${folder}`);
    }
    if (!has(screen, title, true)) {
      yield* click(screen, findPhrase(screen.words, folder, true)[0], `the folder ${folder}`);
      screen = yield* seen(PLAY_TIMEOUTS.screen, (now) => has(now, title, true), `the folder ${folder} doesn't list "${title}"`);
    }
    // Selected, the map's title also heads the details beside the list.
    if (findPhrase(screen.words, title, true).length < 2) {
      yield* click(screen, findPhrase(screen.words, title, true)[0], `"${title}"`);
      screen = yield* seen(PLAY_TIMEOUTS.screen, (now) => findPhrase(now.words, title, true).length >= 2, `"${title}" didn't become the selected map`);
    }
    const scale = screen.height / 1440;
    const field = { x: Math.round(GAME_NAME_FIELD.x * scale), y: Math.round(GAME_NAME_FIELD.y * scale) };
    yield* click(screen, field, "the game name field");
    yield* desktop.keys(game.xWindow, "ctrl+a");
    yield* desktop.typeText(game.xWindow, declaration.gameName);
    const near = (now: Screen) => ({ ...now, words: now.words.filter((word) => Math.abs(word.x - field.x) < 400 * scale && Math.abs(word.y - field.y) < 40 * scale) });
    screen = yield* seen(PLAY_TIMEOUTS.screen, (now) => has(near(now), declaration.gameName), `the game name field didn't take "${declaration.gameName}"`);
    yield* click(screen, lowest(findPhrase(screen.words, "Create")), "the Create button");
    screen = yield* seen(PLAY_TIMEOUTS.screen, (now) => has(now, "Start"), "Create didn't open the game's lobby");
    const since = yield* Clock.currentTimeMillis;
    yield* click(screen, lowest(findPhrase(screen.words, "Start")), "the Start button");
    yield* declaration.started(game, since);
    yield* status(4, "Custom game", `"${declaration.gameName}" of ${title} started (joining by name is case-sensitive)`);
  });

  // 6. One helper for this game.
  const helper = (game: PlayGame) => Effect.gen(function*() {
    const { binary, ready, log } = declaration.helper;
    const earlier = (yield* machine.processes).filter((process) => process.args[0] === binary);
    const mine = earlier.find((process) => process.args.some((arg, index) => arg === "--pid" && process.args[index + 1] === String(game.pid)));
    if (mine !== undefined) return yield* status(6, "Controller helper", `already running for this game (pid ${mine.pid})`);
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
    yield* status(6, "Controller helper", `running (pid ${pid}), log ${log}`);
  });

  yield* checkPrefix.pipe(inStep(1, "Wine prefix"));
  yield* launcher.pipe(inStep(2, "Battle.net"));
  const running = yield* game.pipe(inStep(3, "Warcraft III"));
  yield* host(running).pipe(inStep(4, "Custom game"));
  const opponent = yield* declaration.opponent(running).pipe(inStep(5, "Opponent"));
  yield* status(5, "Opponent", opponent);
  yield* helper(running).pipe(inStep(6, "Controller helper"));
  yield* Effect.gen(function*() {
    yield* fullscreen(running.window, "Warcraft III's window");
    yield* until(PLAY_TIMEOUTS.fullscreen, windowById(running.window).pipe(Effect.map((window) => (window.focused ? true : undefined))),
      () => "Warcraft III's window didn't take focus");
    yield* status(7, "Fullscreen", "Warcraft III is fullscreen and focused. Ready to fight.");
  }).pipe(inStep(7, "Fullscreen"));
});

/** Names the step a problem stopped play at; the step's time prints with the command's step timings. */
const inStep = (number: number, title: string) => <A, R>(effect: Effect.Effect<A, PlayProblem, R>) =>
  effect.pipe(Effect.mapError(({ problem }) => new PlayFailure({ step: number, title, problem })), step(`${number}/${STEPS} ${title}`));
