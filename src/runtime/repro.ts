// A repro: a moment of play a map saves for `wisp repro` to replay in
// simulated clients (wisp:docs/repro.md). The map writes it with writeRepro
// (wisp:src/platform/repro.ts) as Preload lines: this header, the game's own
// lines, which only the game reads, and a last line counting them, so a file
// cut short is refused. Shared by map code, host tools and generated tests.
import { AssertionFailure } from "./testing";

export const REPRO_HEADER = "wisp-repro 1";

/** Characters per game line; Wisp's error reports cut Preload lines at 240. */
export const REPRO_LINE_WIDTH = 200;

export interface ReproHeader {
  /** The build that saved it, without spaces. */
  readonly build: string;
  /** The frame the moment ends on. */
  readonly frame: number;
  /** The game's checksum of its state at that frame, which a replay must reach. */
  readonly checksum: string;
}

export interface Repro extends ReproHeader {
  /** The game's lines: what it needs to restore its state and run the frames. */
  readonly lines: readonly string[];
}

/** What a game's replay of a repro reached. */
export interface ReproResult {
  /** Its checksum after the last frame, comparable with the repro's. */
  readonly checksum: string;
  /** Frames it ran. */
  readonly frames: number;
  /** What went wrong on the way, such as a restored state that isn't the one saved. */
  readonly problems: readonly string[];
}

/** A game's replay: restores the repro's state and runs its frames. `wisp repro` runs it in each simulated client. */
export type ReproReplay = (this: void, repro: Repro) => ReproResult;

/** A new name for each repro a client saves, as Preloader runs the first content it read from a name for the rest of the session. */
export const reproFile = (slot: number, frame: number, serial: number, prefix = "wisp") => `${prefix}-repro-p${slot}-f${frame}-${serial}.txt`;

/** The lines of a repro file: header, the game's lines, and their count. */
export function reproLines({ build, frame, checksum }: ReproHeader, lines: readonly string[]): string[] {
  return [REPRO_HEADER, `build ${build}`, `frame ${frame}`, `checksum ${checksum}`, ...lines, `end ${lines.length}`];
}

/** The text after `word ` on a line, or undefined. */
function after(line: string | undefined, word: string): string | undefined {
  if (line === undefined || !line.startsWith(`${word} `)) return undefined;
  const text = line.substring(word.length + 1);
  return text.length === 0 || text.includes(" ") ? undefined : text;
}

function count(text: string | undefined): number | undefined {
  if (text === undefined || text.length > 9) return undefined;
  let value = 0;
  for (let index = 0; index < text.length; index++) {
    const digit = text.charCodeAt(index) - 48;
    if (digit < 0 || digit > 9) return undefined;
    value = value * 10 + digit;
  }
  return value;
}

/** A repro from its file's lines, or what is wrong with them. */
export function parseRepro(lines: readonly string[]): Repro | string {
  if (lines[0] !== REPRO_HEADER) return `not a repro: its first line isn't "${REPRO_HEADER}"`;
  const build = after(lines[1], "build");
  const frame = count(after(lines[2], "frame"));
  const checksum = after(lines[3], "checksum");
  const end = count(after(lines[lines.length - 1], "end"));
  if (build === undefined || frame === undefined || checksum === undefined) return "the repro's header is incomplete";
  if (end === undefined || end !== lines.length - 5) return "the repro is cut short: its end line doesn't count its lines";
  return { build, frame, checksum, lines: lines.slice(4, lines.length - 1) };
}

/**
 * The test `wisp repro FILE --test NAME` writes: replaying the repro's lines
 * reaches the checksum the game recorded, with no problem on the way.
 */
export function assertReproLands(lines: readonly string[], replay: ReproReplay): void {
  const repro = parseRepro(lines);
  if (typeof repro === "string") throw new AssertionFailure(repro);
  const result = replay(repro);
  if (result.problems.length > 0) throw new AssertionFailure(result.problems.join("; "));
  if (result.checksum !== repro.checksum) throw new AssertionFailure(`frame ${repro.frame}: the game recorded checksum ${repro.checksum}, the replay reached ${result.checksum}`);
}
