// What Warcraft III's own log (Documents/Warcraft III/Logs/War3Log.txt, written
// anew by each launch) says about a session: its sign-in, the ladder map scan
// that follows it, and models a loaded map couldn't create.
//
// After the login doors close, Warcraft III opens every map of the ladder
// pools in Maps/Download/SeasonN/ as its active mod (6 Oct: Season1's twelve,
// then Season9's ten, 8-12 s after LoginDoorClose). A map that loads while
// that happens (one started by -loadfile, or a lobby created during it) can't
// read its own imported files: 325 "model creation failed -
// war3mapImported/..." lines on 6 Oct, an invisible stage and fighters. Maps
// hosted after the scan loaded without a failure.
import { join } from "node:path";

/** Warcraft III's log in its Documents folder. */
export const war3LogPath = (documents: string) => join(documents, "Logs", "War3Log.txt");

/** A log line: "10/6 20:35:18.925  text". */
const LINE = /^(\d{1,2})\/(\d{1,2}) (\d{2}):(\d{2}):(\d{2})\.(\d{3})\s+(.*)$/;
const SESSION_START = "GameMain Started";
const LOGIN = "[CLoginCallbacks] LoginDoorClose called";
const LADDER = /^Opening (?:map|mod) - .*[\\/]Maps[\\/]Download[\\/]Season\d+[\\/]/;
const IMPORT_FAILED = /^model creation failed - (war3mapImported[\\/].*)$/;

/** Months and days give the order within a year, which is all a session spans. */
const DAY_MS = 86_400_000;

export interface LogLine {
  /** Milliseconds within the year by the line's own month, day and time. */
  readonly at: number;
  readonly text: string;
}

/** The timestamped lines of a log; continuation lines without a timestamp are dropped. */
export function logLines(log: string): LogLine[] {
  return log.split(/\r?\n/).flatMap((raw) => {
    const match = LINE.exec(raw);
    if (match === null) return [];
    const [, month, day, hours, minutes, seconds, millis, text] = match;
    const at = ((Number(month) * 31 + Number(day)) * DAY_MS) + ((Number(hours) * 60 + Number(minutes)) * 60 + Number(seconds)) * 1000 + Number(millis);
    return [{ at, text: text!.trimEnd() }];
  });
}

/** The lines of the log's newest session: from its last "GameMain Started". */
export function sessionLines(log: string): LogLine[] {
  const lines = logLines(log);
  const start = lines.findLastIndex(({ text }) => text === SESSION_START);
  return start < 0 ? lines : lines.slice(start);
}

/** The newest session's first line, which tells one launch's log from the next. */
export const sessionStart = (log: string): string | undefined => {
  const lines = logLines(log);
  const start = lines.findLast(({ text }) => text === SESSION_START);
  return start === undefined ? undefined : `${start.at}`;
};

/** A ladder scan with no ladder line for this long is over (6 Oct: 0.6-0.8 s between Season1's and Season9's batches). */
export const SCAN_QUIET_MS = 2000;

export type LadderScan =
  /** The login doors haven't closed. */
  | { readonly kind: "signing in" }
  /** Signed in; no ladder map opened since. */
  | { readonly kind: "waiting"; readonly login?: number }
  /** Ladder maps are being opened; `last` is the newest one's time, `count` how many lines so far. */
  | { readonly kind: "scanning"; readonly last: number; readonly count: number }
  | { readonly kind: "done"; readonly login?: number; readonly last: number };

/**
 * Where the newest session is with its post-sign-in ladder scan. The scan is
 * over once a later line comes at least SCAN_QUIET_MS after its last ladder
 * line; while the log ends with ladder lines it is "scanning", and the caller
 * decides how long a quiet log means it is over.
 */
export function ladderScan(log: string, authenticated = false): LadderScan {
  const lines = sessionLines(log);
  const login = lines.findLastIndex(({ text }) => text === LOGIN);
  if (login < 0 && !authenticated) return { kind: "signing in" };
  const signedIn = login < 0 ? {} : { login: lines[login]!.at };
  const after = lines.slice(login + 1);
  const ladder = after.filter(({ text }) => LADDER.test(text));
  const last = ladder.at(-1);
  if (last === undefined) return { kind: "waiting", ...signedIn };
  if (after.some(({ at, text }) => at - last.at >= SCAN_QUIET_MS && !LADDER.test(text))) return { kind: "done", ...signedIn, last: last.at };
  return { kind: "scanning", last: last.at, count: ladder.length };
}

/** "model creation failed - war3mapImported/..." lines in `log`: how many, and the first model named. */
export function importFailures(log: string): { readonly count: number; readonly first?: string } {
  let count = 0;
  let first: string | undefined;
  for (const { text } of logLines(log)) {
    const match = IMPORT_FAILED.exec(text);
    if (match === null) continue;
    count++;
    first ??= match[1];
  }
  return first === undefined ? { count } : { count, first };
}

/** The epoch milliseconds of a line's `at`, in the local time zone the game wrote it in, in the year up to `now`. */
export function logTime(at: number, now: number): number {
  const days = Math.floor(at / DAY_MS);
  const within = at - days * DAY_MS;
  // A month's day 31 counts as the next month's day 0, which Date reads as the same day.
  const date = (year: number) => new Date(year, Math.floor(days / 31) - 1, days % 31).getTime() + within;
  const year = new Date(now).getFullYear();
  return date(year) > now + DAY_MS ? date(year - 1) : date(year);
}

const SESSION_END = "GameMain Ended";

/** The newest session's start, sign-in and clean end, each when the log has it. */
export function sessionMarks(log: string): { readonly start?: LogLine; readonly login?: LogLine; readonly ended?: LogLine } {
  const lines = sessionLines(log);
  const start = lines.find(({ text }) => text === SESSION_START);
  const login = lines.findLast(({ text }) => text === LOGIN);
  const ended = lines.findLast(({ text }) => text === SESSION_END);
  return { ...(start === undefined ? {} : { start }), ...(login === undefined ? {} : { login }), ...(ended === undefined ? {} : { ended }) };
}

/** The newest session's part of the log. */
export const sessionText = (log: string) => {
  const start = log.lastIndexOf(SESSION_START);
  return start < 0 ? log : log.slice(log.lastIndexOf("\n", start) + 1);
};
