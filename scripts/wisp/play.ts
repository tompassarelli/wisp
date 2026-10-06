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
import { Clock, Context, Effect, Exit, Schema } from "effect";
import {
  type LaunchOutcome, type PrefixUse, type ProcessInfo, documentsFolder, launchOptions, launchOutcome, launchRequested, launcherConfig, launcherLogDirectory, loadMapOption,
  newestLauncherLog, prefixUse, shortcutAppId, shortcutUrl, signedIn, withLaunchOptions,
} from "../warcraft/battleNet";
import type { Ink, Word } from "../warcraft/desktop";
import { step } from "./timings";
import { hostLobby, reportedMenus, startLobby } from "./menus";

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
 * A place to click: a point of an image `area` that captures `output` exactly,
 * and the target X window. The window may be letterboxed inside the output.
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
    root: { x: Math.round((output.x + across * output.width) * spot.area.width / output.width), y: Math.round((output.y + down * output.height) * spot.area.height / output.height) },
  };
}

interface Point {
  readonly x: number;
  readonly y: number;
}

/** X root pixels the X pointer moves per logical pixel the compositor's pointer is moved, on each axis. */
export interface Gain {
  readonly x: number;
  readonly y: number;
}

/**
 * The gain before any move: the captured pixels per logical pixel of the output
 * (2 for 2880x1920 X pixels on a 1440x960 output at scale 2). Over
 * fullscreen Warcraft III's Battle.net screens it moved one X pixel per
 * logical pixel (6 Oct), so each move measures it again.
 */
export const expectedGain = (spot: Spot, output: OutputArea): Gain => ({ x: spot.area.width / output.width, y: spot.area.height / output.height });

/** The compositor pointer move, in logical pixels, that brings the X pointer from `at` to `target` at `gain`. */
export const steer = (at: Point, target: Point, gain: Gain) => ({ dx: (target.x - at.x) / gain.x, dy: (target.y - at.y) / gain.y });

/** The gain a move showed on each axis; an axis that moved too little to measure keeps the gain it had. */
export function measuredGain(gain: Gain, requested: { readonly dx: number; readonly dy: number }, moved: Point): Gain {
  const axis = (previous: number, asked: number, went: number) =>
    (Math.abs(asked) >= 1 && Math.abs(went) >= 1 ? Math.min(4, Math.max(0.25, went / asked)) : previous);
  return { x: axis(gain.x, requested.dx, moved.x), y: axis(gain.y, requested.dy, moved.y) };
}

/**
 * Moves the X pointer to `target` (X root pixels) with compositor moves,
 * measuring the gain after each, until it is within `tolerance` pixels or
 * `moves` moves are spent. `move` moves the compositor's pointer and returns
 * where the X pointer then is.
 */
export const steerPointer = <E>(start: Point, target: Point, gain: Gain, tolerance: number, move: (dx: number, dy: number) => Effect.Effect<Point, E>, moves = 8) =>
  Effect.gen(function*() {
    const arrived = (at: Point) => Math.abs(at.x - target.x) <= tolerance && Math.abs(at.y - target.y) <= tolerance;
    let at = start;
    let current = gain;
    const trace = [`pointer at X ${at.x},${at.y}`];
    for (let made = 0; made < moves && !arrived(at); made++) {
      const requested = steer(at, target, current);
      const next = yield* move(requested.dx, requested.dy);
      current = measuredGain(current, requested, { x: next.x - at.x, y: next.y - at.y });
      trace.push(`moved ${requested.dx.toFixed(1)},${requested.dy.toFixed(1)} -> X ${next.x},${next.y} (gain ${current.x.toFixed(2)},${current.y.toFixed(2)})`);
      at = next;
    }
    return { at, arrived: arrived(at), trace };
  });

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
  /** Writes a file whole: a reader sees the old text or the new. */
  readonly write: (path: string, text: string) => Effect.Effect<void, PlayProblem>;
  /** Copies a file whole: the destination appears complete or not at all. */
  readonly copy: (from: string, to: string) => Effect.Effect<void, PlayProblem>;
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
  /** Sends one key to the window itself (6 Oct: space on "Press any key to continue" reached Warcraft III this way). */
  readonly pressKey: (window: XWindow, key: string) => Effect.Effect<void, PlayProblem>;
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
}

export interface PlayDeclaration<R = never> {
  /** The Wine prefix (the pfx folder) Battle.net and Warcraft III run in. */
  readonly prefix: string;
  /** The X display of the owner's desktop, where the game runs. */
  readonly display: string;
  /** The Steam shortcut that starts Battle.net Launcher.exe in the prefix: its app id and its name in Steam. */
  readonly shortcut: { readonly appId: number; readonly name: string };
  /**
   * The map: its folder under Maps, its file, the title Create Game lists it
   * by, and the build it is copied from when the folder lacks it.
   */
  readonly map: { readonly folder: string; readonly file: string; readonly title: string; readonly source?: string };
  /** The hosted game's name; joining by name is case-sensitive. */
  readonly gameName: string;
  /** The installed menu page's report port for this prefix. Absent uses ordinary menu controls. */
  readonly menuReportPort?: number;
  /** Each run saves a picture before and after every click, and its click log, in a folder here named by its start time. */
  readonly debugDirectory: string;
  /** Before Warcraft III starts the map: what the map reads at its start, left in Documents/Warcraft III. */
  readonly prepare: (documents: string) => Effect.Effect<void, PlayProblem, R>;
  /** When a run stops before the match: removes what prepare left, so a later session of the map runs as usual. */
  readonly cleanup: (documents: string) => Effect.Effect<void, PlayProblem, R>;
  /** Resolves once the started map shows its first screen; `since` is when the game was asked to start it, on the Effect Clock. */
  readonly started: (game: PlayGame, since: number) => Effect.Effect<void, PlayProblem, R>;
  /** With the helper running: sets up and starts the match, its opponent included, and describes it, as in "computer as Player 3". */
  readonly match: (game: PlayGame) => Effect.Effect<string, PlayProblem, R>;
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
  next: 10,
  menuShown: 10,
  gameFullscreen: 45,
  continueEvery: 2,
  continuePresses: 60,
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
export const topmost = (places: readonly { readonly x: number; readonly y: number }[]) =>
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
  const measured = gaps[Math.floor(gaps.length / 2)];
  const pitch = measured !== undefined && measured >= 250 && measured <= 600 ? measured : TILE_PITCH;
  return { first: { x: label.x, y: Math.round(label.y - pitch / 2) }, retry: { x: label.x, y: Math.round(label.y - pitch * 0.6) } };
}

/** The Games tab's tile pitch on 6 Oct (Battle.net 2.53), for a row with one tile or gaps that aren't tiles'. */
const TILE_PITCH = 381;

/** A tile's install state under its label. */
const TILE_STATE = /^(installed|install|update|updating|download|downloading|queued|paused|play|playing)$/i;

/**
 * Warcraft III's label in Battle.net's Games grid: below the grid's header
 * ("My Games", "Sort by") with the tile's install state, such as
 * "Installed", just below it (30 px on 6 Oct). Other text naming Warcraft,
 * like the "World of Warcraft" logo in a tile's art (run 7 read "WARCRAFT"
 * at 1307,703), is no label.
 */
export function gridLabel(words: readonly Word[]): Point | undefined {
  const header = [...findPhrase(words, "Sort by"), ...findPhrase(words, "My Games")];
  if (header.length === 0) return undefined;
  const top = Math.min(...header.map(({ y }) => y));
  return topmost(warcraftThree(words).filter((label) => label.y > top + 40 && words.some((word) =>
    TILE_STATE.test(word.text.replace(/[^A-Za-z]/g, "")) && word.y - label.y >= 10 && word.y - label.y <= 60 && Math.abs(word.x - label.x) <= 250)));
}

/** A spot outside the image its point is in: the pointer would only pin at the screen's edge. */
export const offScreen = (spot: Spot) => spot.x < 0 || spot.y < 0 || spot.x >= spot.area.width || spot.y >= spot.area.height;

/** Two reads of one control: within 6 px. */
const samePlace = (a: Point, b: Point) => Math.abs(a.x - b.x) <= 6 && Math.abs(a.y - b.y) <= 6;

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

/**
 * Create Game's game name field on a 2560x1440 frame. Warcraft's menus scale
 * with the frame's height and keep their left column on the left edge.
 */
const GAME_NAME_FIELD = { x: 400, y: 340 };

/** Choices for one run of play. */
export interface PlayOptions {
  /** Hosts only after Warcraft III shows its main menu, avoiding startup map loading. */
  readonly menus?: boolean;
  /** Leaves Warcraft III's launch options loading the map, so Battle.net needn't restart on the next run. */
  readonly keepLaunchOptions?: boolean;
}

/** Runs the declared playtest, printing one status line per step. */
export const play = <R>(declaration: PlayDeclaration<R>, print: (line: string) => void, options: PlayOptions = {}) => Effect.gen(function*() {
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
    if (offScreen(spot)) {
      const problem = `${what} would be clicked at ${spot.x},${spot.y}, outside the ${spot.area.width}x${spot.area.height} screen (pictures and click log: ${debug})`;
      yield* machine.append(clickLog, `${name}: ${problem}\n`);
      return yield* fail(problem);
    }
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

  // Battle.net reads Warcraft III's launch options when it starts and writes its settings back when it exits.
  const configPath = launcherConfig(prefix);
  const mapPath = join(documents, "Maps", declaration.map.folder, declaration.map.file);
  const loadOption = loadMapOption(prefix, mapPath);
  const settings = machine.read(configPath).pipe(Effect.flatMap((text) => (text === undefined
    ? fail(`Battle.net has no settings at ${configPath}; start it once from Steam, then run play again`)
    : Effect.try({ try: () => ({ text, options: launchOptions(text) }), catch: () => new PlayProblem({ problem: `Battle.net's settings at ${configPath} aren't JSON` }) }))));
  const setLaunchOptions = (options: string | undefined) => settings.pipe(Effect.flatMap(({ text }) => machine.write(configPath, withLaunchOptions(text, options))));
  /**
   * What Warcraft III's launch options were before this run first set them, while ours are in place:
   * every way a run ends puts them back but a successful run with --keep-launch-options. A run that
   * found them already set by an earlier kept run removes them when it fails.
   */
  let pending: { readonly previous: string | undefined } | undefined;
  /** True when it put options back. */
  const restoreLaunchOptions = Effect.suspend(() => (pending === undefined
    ? Effect.succeed(false)
    : setLaunchOptions(pending.previous).pipe(Effect.tap(() => Effect.sync(() => { pending = undefined; })), Effect.as(true))));

  /** How the map gets loaded: by Warcraft III's launch options, or through its menus when it already runs. */
  type Route = { readonly kind: "launch"; readonly previous: string | undefined } | { readonly kind: "menus" };
  const launcher = Effect.gen(function*() {
    const use = yield* prefixState;
    if (use.game !== undefined) {
      yield* waitSignedIn(undefined);
      yield* status(2, "Battle.net", "signed in; Warcraft III already runs, so the map is hosted through its menus");
      return { kind: "menus" } satisfies Route as Route;
    }
    const { options: previous } = yield* settings;
    if (options.menus) {
      if (previous === loadOption) {
        if (use.launcher !== undefined) yield* stopPrefix;
        yield* setLaunchOptions(undefined);
      } else if (previous !== undefined && /(?:^|\s)-loadfile(?:\s|$)/i.test(previous)) {
        return yield* fail("Battle.net is set to load another map at startup. Clear its additional command line arguments and restart Battle.net before playing through the menus.");
      }
      if (use.launcher !== undefined && previous !== loadOption) {
        yield* waitSignedIn(undefined);
        yield* status(2, "Battle.net", "signed in; reusing it to open Warcraft III's menus");
      } else {
        const seconds = yield* startLauncher(2, "Battle.net");
        yield* status(2, "Battle.net", `started and signed in (${seconds} s); Warcraft III will open its menus`);
      }
      return { kind: "menus" } satisfies Route as Route;
    }
    // Ours from an earlier kept run count as nothing set before.
    pending = { previous: previous === loadOption ? undefined : previous };
    if (use.launcher !== undefined) {
      if (previous === loadOption) {
        yield* waitSignedIn(undefined);
        yield* status(2, "Battle.net", "signed in, with Warcraft III set to load the map");
        return { kind: "launch", previous } satisfies Route as Route;
      }
      yield* status(2, "Battle.net", "restarting it to set Warcraft III's launch options, which it reads when it starts");
      yield* stopPrefix;
    }
    yield* setLaunchOptions(loadOption);
    const seconds = yield* startLauncher(2, "Battle.net");
    yield* status(2, "Battle.net", `started and signed in (${seconds} s), with Warcraft III set to load the map`);
    return { kind: "launch", previous } satisfies Route as Route;
  });

  // 3. Play in the launcher, confirmed by its log; one restart of the launcher alone when it can't launch.
  const windowTitled = (title: string) => desktop.windows.pipe(Effect.map((windows) => windows.find((window) => window.title === title && window.appId === appId)));
  const windowById = (id: number) => desktop.windows.pipe(Effect.flatMap((windows) => {
    const window = windows.find((candidate) => candidate.id === id);
    return window === undefined ? fail(`window ${id} closed`) : Effect.succeed(window);
  }));
  /** Focuses a window and makes it fullscreen; true when it had to toggle fullscreen on. */
  /** Windows play asked to go fullscreen: niri's fullscreen is a toggle, and a window loading a map takes its time to follow it. */
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
        return { light, white };
      });
      const click = (screen: Screen, place: { readonly x: number; readonly y: number }, what: string) =>
        clickSpot(what, window.id, { output, area: screen, x: place.x, y: place.y, window: xWindow });
      // Fullscreen requests can reflow the launcher before the compositor's next capture.
      let previousGames: Point | undefined;
      let seen = yield* until(PLAY_TIMEOUTS.screen, page.pipe(Effect.map((now) => {
        const games = topmost(findPhrase(now.light.words, "Games"));
        const previous = previousGames;
        previousGames = games;
        return warcraftPlay(now) !== undefined || (games !== undefined && previous !== undefined && samePlace(games, previous)) ? now : undefined;
      })),
        () => "Battle.net's window shows neither its Games tab nor Warcraft III's Play button");
      // Battle.net opens on the game it last showed or features, such as WoW: Forever; its Games tab lists Warcraft III.
      if (warcraftPlay(seen) === undefined) {
        yield* click(seen.light, topmost(findPhrase(seen.light.words, "Games"))!, "Battle.net Games");
        // The grid fills in after the tab opens; its label is taken once two reads agree.
        let last: Point | undefined;
        seen = yield* until(PLAY_TIMEOUTS.screen, page.pipe(Effect.map((now) => {
          const label = gridLabel(now.light.words);
          const previous = last;
          last = label;
          return label !== undefined && previous !== undefined && samePlace(label, previous) ? now : undefined;
        })), () => `Battle.net's Games tab doesn't list Warcraft III with its install state (pictures and click log: ${debug})`);
        const tile = tileArt(seen.light.words, gridLabel(seen.light.words)!);
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
    }).pipe(Effect.ensuring(toggled ? leaveFullscreen(window.id).pipe(Effect.ignore) : Effect.void));
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

  /** The map in its folder, copied from its build when missing. */
  const installMap = Effect.gen(function*() {
    const { file, source } = declaration.map;
    if ((yield* machine.size(mapPath)) !== undefined) return;
    if (source === undefined) return yield* fail(`the map isn't installed: ${mapPath}`);
    if ((yield* machine.size(source)) === undefined) return yield* fail(`the map isn't installed (${mapPath}) and its build is missing: ${source}`);
    yield* machine.copy(source, mapPath);
    yield* status(3, "Warcraft III", `installed ${file} from ${source}`);
  });

  const game = (route: Route) => Effect.gen(function*() {
    yield* installMap;
    yield* declaration.prepare(documents);
    const since = yield* Clock.currentTimeMillis;
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
      if (route.kind === "launch" && !options.keepLaunchOptions) {
        // Battle.net may write its settings back as it read them when it exits.
        yield* restoreLaunchOptions;
        yield* status(3, "Warcraft III", "Battle.net's launch options for it put back; its own Play no longer loads the map");
      }
    }
    const process = yield* until(PLAY_TIMEOUTS.gameWindow, prefixState.pipe(Effect.map((use) => use.game)),
      () => `Battle.net reported Warcraft III running, but its process didn't appear within ${PLAY_TIMEOUTS.gameWindow} s`);
    const window = yield* until(PLAY_TIMEOUTS.gameWindow, windowTitled("Warcraft III"), () => `Warcraft III's window didn't appear within ${PLAY_TIMEOUTS.gameWindow} s`);
    // A game loading a map can take a while to follow; step 7 waits for it.
    yield* askFullscreen(window.id);
    const xWindow = yield* until(PLAY_TIMEOUTS.gameWindow, desktop.xWindow("Warcraft III", process.pid),
      () => `Warcraft III's window isn't on display ${display}`);
    yield* status(3, "Warcraft III", `running (pid ${process.pid}), asked to go fullscreen`);
    return { game: { documents, pid: process.pid, window: window.id, xWindow, display } satisfies PlayGame, since };
  });

  // 4, through the menus: Multiplayer, Custom Games, Create Game, the map's folder, the map, the game's name, Create, Start.
  const host = (game: PlayGame) => Effect.gen(function*() {
    const { folder, title } = declaration.map;
    const driven = yield* Effect.scoped(Effect.gen(function*() {
      const menus = yield* reportedMenus(declaration.menuReportPort);
      if (menus === undefined) return false;
      yield* hostLobby(menus, { folder, file: declaration.map.file, gameName: declaration.gameName, password: "" });
      const since = yield* Clock.currentTimeMillis;
      yield* startLobby(menus);
      yield* declaration.started(game, since);
      return true;
    })).pipe(Effect.mapError((cause) => cause._tag === "MenuFailure" ? new PlayProblem({ problem: cause.message }) : cause));
    if (driven) {
      yield* status(4, "Map", `"${declaration.gameName}" of ${title} hosted through the menus (joining by name is case-sensitive)`);
      return;
    }
    // The menus are read from the output, which only the fullscreen game covers.
    yield* fullscreen(game.window, "Warcraft III's window", PLAY_TIMEOUTS.gameFullscreen);
    const output = yield* outputOf(game.window, "Warcraft III's window");
    const read = desktop.read(output, "gold");
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

    /**
     * Reads until `find` gives the same place twice running: Warcraft's menus
     * slide in (6 Oct: Battle.net's tabs moved 32 px down within 0.3 s of
     * appearing), so a control is clicked only once it has stopped. A screen
     * that already shows `next` ends the wait.
     */
    const settled = (find: (screen: Screen) => Point | undefined, next: (screen: Screen) => boolean, first: Screen | undefined, what: string) => Effect.gen(function*() {
      let last = first === undefined ? undefined : find(first);
      return yield* until(PLAY_TIMEOUTS.screen, read.pipe(Effect.map((screen) => {
        if (next(screen)) return { screen, place: undefined };
        const place = find(screen);
        const previous = last;
        last = place;
        return place !== undefined && previous !== undefined && samePlace(previous, place) ? { screen, place } : undefined;
      })), () => `${what} isn't on the screen, or doesn't stay still`);
    });
    /**
     * Clicks a control found on the screen once it has settled and waits for
     * the screen it leads to; clicks it once more when that doesn't come.
     */
    const advance = (what: string, find: (screen: Screen) => Point | undefined, next: (screen: Screen) => boolean, problem: string, first?: Screen, after: Effect.Effect<void, PlayProblem> = Effect.void) =>
      Effect.gen(function*() {
        let from = first;
        for (let attempt = 1; attempt <= 2; attempt++) {
          const at = yield* settled(find, next, from, what);
          if (at.place === undefined) return at.screen;
          yield* click(at.screen, at.place, attempt === 1 ? what : `${what} again`);
          yield* after;
          const reached = yield* poll(attempt === 1 ? PLAY_TIMEOUTS.next : PLAY_TIMEOUTS.screen, read.pipe(Effect.map((screen) => (next(screen) ? screen : undefined))));
          if (reached !== undefined) return reached;
          from = undefined;
        }
        return yield* fail(`${problem} (pictures and click log: ${debug})`);
      });
    const listed = (screen: Screen) => findPhrase(screen.words, title, true);
    // A name field shows no label of its own on a 2560x1440 frame; when "Game Name" labels it, it is just below.
    const nameField = (screen: Screen) => {
      const scale = screen.height / 1440;
      const label = topmost(findPhrase(screen.words, "Game Name"));
      return label === undefined
        ? { x: Math.round(GAME_NAME_FIELD.x * scale), y: Math.round(GAME_NAME_FIELD.y * scale) }
        : { x: label.x, y: Math.round(label.y + 40 * scale) };
    };
    const named = (screen: Screen) => {
      const field = nameField(screen);
      const scale = screen.height / 1440;
      return findPhrase(screen.words.filter((word) => Math.abs(word.x - field.x) < 400 * scale && Math.abs(word.y - field.y) < 40 * scale), declaration.gameName).length > 0;
    };

    let screen = yield* seen(PLAY_TIMEOUTS.mainMenu, (now) => has(now, "Multiplayer") || has(now, "Custom Games") || mapShown(now),
      `Warcraft III didn't show its main menu within ${PLAY_TIMEOUTS.mainMenu} s`);
    if (!mapShown(screen) && !has(screen, "Custom Games")) {
      screen = yield* advance("Multiplayer", (now) => lowest(findPhrase(now.words, "Multiplayer")), (now) => has(now, "Custom Games"),
        "Multiplayer didn't open Battle.net's Custom Games", screen);
    }
    if (!mapShown(screen)) {
      if (createButton(screen) === undefined) {
        screen = yield* advance("Custom Games", (now) => lowest(findPhrase(now.words, "Custom Games")), (now) => createButton(now) !== undefined,
          "Custom Games didn't show Create Game", screen);
      }
      screen = yield* advance("Create Game", createButton, mapShown, `Create Game didn't list the folder ${folder}`, screen);
    }
    if (!has(screen, title, true)) {
      screen = yield* advance(`the folder ${folder}`, (now) => findPhrase(now.words, folder, true)[0], (now) => has(now, title, true),
        `the folder ${folder} doesn't list "${title}"`, screen);
    }
    // Selected, the map's title also heads the details beside the list.
    if (listed(screen).length < 2) {
      screen = yield* advance(`"${title}"`, (now) => listed(now)[0], (now) => listed(now).length >= 2, `"${title}" didn't become the selected map`, screen);
    }
    if (!named(screen)) {
      const typeName = Effect.gen(function*() {
        yield* desktop.keys(game.xWindow, "ctrl+a");
        yield* desktop.typeText(game.xWindow, declaration.gameName);
      });
      screen = yield* advance("the game name field", nameField, named, `the game name field didn't take "${declaration.gameName}"`, screen, typeName);
    }
    screen = yield* advance("the Create button", (now) => lowest(findPhrase(now.words, "Create")), (now) => has(now, "Start"), "Create didn't open the game's lobby", screen);
    const since = yield* Clock.currentTimeMillis;
    yield* advance("the Start button", (now) => lowest(findPhrase(now.words, "Start")), (now) => !has(now, "Start"), "Start didn't start the game", screen);
    yield* declaration.started(game, since);
    yield* status(4, "Map", `"${declaration.gameName}" of ${title} hosted through the menus (joining by name is case-sensitive)`);
  });

  // 4. The map, loaded by the launch options; hosted through the menus when Warcraft III already ran, or showed its main menu instead.
  /** Shared by the main menu's watch and the key presses: once Warcraft III shows its main menu, no key goes to it. */
  interface Loading {
    menu: boolean;
    presses: number;
  }
  const mainMenu = (game: PlayGame, loading: Loading) => Effect.gen(function*() {
    const output = yield* outputOf(game.window, "Warcraft III's window");
    let first: number | undefined;
    while (true) {
      const screen = yield* desktop.read(output, "light");
      const now = yield* Clock.currentTimeMillis;
      if (findPhrase(screen.words, "Multiplayer").length === 0) first = undefined;
      else {
        loading.menu = true;
        if (now - (first ??= now) >= PLAY_TIMEOUTS.menuShown * 1000) return;
      }
      yield* Effect.sleep(POLL);
    }
  });
  /**
   * A map loaded from the launch options waits on "Press any key to
   * continue" when it has loaded (6 Oct, run 9: space went on to fighter
   * selection within 12 s). Space goes to the game every 2 s until fighter
   * selection or the main menu ends the wait, at most 60 times.
   */
  const pressToContinue = (game: PlayGame, loading: Loading) => Effect.gen(function*() {
    while (loading.presses < PLAY_TIMEOUTS.continuePresses) {
      yield* Effect.sleep(`${PLAY_TIMEOUTS.continueEvery} seconds`);
      if (loading.menu) continue;
      yield* desktop.pressKey(game.xWindow, "space");
      loading.presses++;
    }
    return yield* Effect.never;
  }).pipe(Effect.catch(() => Effect.never));
  const loadMap = (route: Route, game: PlayGame, since: number) => Effect.gen(function*() {
    if (route.kind === "menus") {
      if (options.menus) {
        yield* fullscreen(game.window, "Warcraft III's window", PLAY_TIMEOUTS.gameFullscreen);
        const output = yield* outputOf(game.window, "Warcraft III's window");
        yield* until(PLAY_TIMEOUTS.mainMenu, desktop.read(output, "gold").pipe(Effect.map((screen) =>
          findPhrase(screen.words, "Multiplayer").length > 0 || findPhrase(screen.words, "Custom Games").length > 0 ? true : undefined)),
        () => `Warcraft III didn't show its main menu within ${PLAY_TIMEOUTS.mainMenu} s`);
        yield* status(4, "Map", "Warcraft III's main menu is ready; hosting the map");
      }
      return yield* host(game);
    }
    const loading: Loading = { menu: false, presses: 0 };
    const loaded = yield* Effect.raceFirst(
      declaration.started(game, since).pipe(Effect.as("map" as const)),
      Effect.raceFirst(mainMenu(game, loading).pipe(Effect.as("menu" as const), Effect.catch(() => Effect.never)), pressToContinue(game, loading)),
    );
    const seconds = Math.round(((yield* Clock.currentTimeMillis) - since) / 1000);
    if (loaded === "map") {
      return yield* status(4, "Map", `Warcraft III loaded ${declaration.map.file} from its launch options; fighter selection ${seconds} s after Play (${loading.presses} key presses to continue)`);
    }
    yield* status(4, "Map", "Warcraft III showed its main menu instead of loading the map; hosting it through the menus");
    yield* host(game);
  });

  // 6. One helper for this game.
  const helper = (game: PlayGame) => Effect.gen(function*() {
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
    const route = yield* launcher.pipe(inStep(2, "Battle.net"));
    const { game: running, since } = yield* game(route).pipe(inStep(3, "Warcraft III"));
    yield* loadMap(route, running, since).pipe(inStep(4, "Map"));
    // The helper runs before the match starts, or the match is played on the keyboard.
    yield* helper(running).pipe(inStep(5, "Controller helper"));
    const match = yield* declaration.match(running).pipe(inStep(6, "Match"));
    yield* status(6, "Match", match);
    yield* Effect.gen(function*() {
      yield* fullscreen(running.window, "Warcraft III's window", PLAY_TIMEOUTS.gameFullscreen);
      yield* until(PLAY_TIMEOUTS.fullscreen, windowById(running.window).pipe(Effect.map((window) => (window.focused ? true : undefined))),
        () => "Warcraft III's window didn't take focus");
      yield* status(7, "Fullscreen", "Warcraft III is fullscreen and focused. Ready to fight.");
    }).pipe(inStep(7, "Fullscreen"));
  }).pipe(Effect.onExit((exit) => (Exit.isFailure(exit)
    ? Effect.gen(function*() {
      if (yield* restoreLaunchOptions) print("Battle.net's launch options for Warcraft III put back, as the run stopped");
      yield* declaration.cleanup(documents);
    }).pipe(Effect.ignore)
    : Effect.void)));
});

/** Names the step a problem stopped play at; the step's time prints with the command's step timings. */
const inStep = (number: number, title: string) => <A, R>(effect: Effect.Effect<A, PlayProblem, R>) =>
  effect.pipe(Effect.mapError(({ problem }) => new PlayFailure({ step: number, title, problem })), step(`${number}/${STEPS} ${title}`));
