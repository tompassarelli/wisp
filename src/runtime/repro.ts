import { AssertionFailure } from "./testing";

export const REPRO_HEADER = "wisp-repro 1";

/** Characters per game line; Wisp's error reports cut Preload lines at 240. */
export const REPRO_LINE_WIDTH = 200;

export interface ReproHeader {

  readonly build: string;

  readonly frame: number;

  readonly checksum: string;
}

export interface Repro extends ReproHeader {

  readonly lines: readonly string[];
}

export interface ReproResult {

  readonly checksum: string;

  readonly frames: number;

  readonly problems: readonly string[];
}

export type ReproReplay = (this: void, repro: Repro) => ReproResult;

export interface ReproInspection {
  readonly frame: number;
  readonly checksum: string;
  readonly state: string;
  readonly fields: readonly { readonly path: string; readonly value: string }[];
}

export type ReproInspector = (this: void, repro: Repro, frame: number) => ReproInspection | string;

/** A new name for each repro a client saves, as Preloader runs the first content it read from a name for the rest of the session. */
export const reproFile = (slot: number, frame: number, serial: number, prefix = "wisp") => `${prefix}-repro-p${slot}-f${frame}-${serial}.txt`;

export function reproLines({ build, frame, checksum }: ReproHeader, lines: readonly string[]): string[] {
  return [REPRO_HEADER, `build ${build}`, `frame ${frame}`, `checksum ${checksum}`, ...lines, `end ${lines.length}`];
}

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

export function assertReproLands(lines: readonly string[], replay: ReproReplay): void {
  const repro = parseRepro(lines);
  if (typeof repro === "string") throw new AssertionFailure(repro);
  const result = replay(repro);
  if (result.problems.length > 0) throw new AssertionFailure(result.problems.join("; "));
  if (result.checksum !== repro.checksum) throw new AssertionFailure(`frame ${repro.frame}: the game recorded checksum ${repro.checksum}, the replay reached ${result.checksum}`);
}
