import { join } from "node:path";

export const war3LogPath = (documents: string) => join(documents, "Logs", "War3Log.txt");

const LINE = /^(\d{1,2})\/(\d{1,2}) (\d{2}):(\d{2}):(\d{2})\.(\d{3})\s+(.*)$/;
const SESSION_START = "GameMain Started";
const LOGIN = "[CLoginCallbacks] LoginDoorClose called";
const LADDER = /^Opening (?:map|mod) - .*[\\/]Maps[\\/]Download[\\/]Season\d+[\\/]/;
const IMPORT_FAILED = /^model creation failed - (.+)$/;

const DAY_MS = 86_400_000;

export interface LogLine {

  readonly at: number;
  readonly text: string;
}

export function logLines(log: string): LogLine[] {
  return log.split(/\r?\n/).flatMap((raw) => {
    const match = LINE.exec(raw);
    if (match === null) return [];
    const [, month, day, hours, minutes, seconds, millis, text] = match;
    const at = ((Number(month) * 31 + Number(day)) * DAY_MS) + ((Number(hours) * 60 + Number(minutes)) * 60 + Number(seconds)) * 1000 + Number(millis);
    return [{ at, text: text!.trimEnd() }];
  });
}

export function sessionLines(log: string): LogLine[] {
  const lines = logLines(log);
  const start = lines.findLastIndex(({ text }) => text === SESSION_START);
  return start < 0 ? lines : lines.slice(start);
}

export const sessionStart = (log: string): string | undefined => {
  const lines = logLines(log);
  const start = lines.findLast(({ text }) => text === SESSION_START);
  return start === undefined ? undefined : `${start.at}`;
};

export const SCAN_QUIET_MS = 2000;

export type LadderScan =

  | { readonly kind: "signing in" }

  | { readonly kind: "waiting"; readonly login?: number; readonly sinceLogin?: number }

  | { readonly kind: "scanning"; readonly last: number; readonly count: number }
  | { readonly kind: "done"; readonly login?: number; readonly last: number };

export function ladderScan(log: string, authenticated = false): LadderScan {
  const lines = sessionLines(log);
  const login = lines.findLastIndex(({ text }) => text === LOGIN);
  if (login < 0 && !authenticated) return { kind: "signing in" };
  const signedIn = login < 0 ? {} : { login: lines[login]!.at };
  const after = lines.slice(login + 1);
  const ladder = after.filter(({ text }) => LADDER.test(text));
  const last = ladder.at(-1);
  if (last === undefined) return { kind: "waiting", ...signedIn, ...(login < 0 ? {} : { sinceLogin: (lines.at(-1)?.at ?? 0) - lines[login]!.at }) };
  if (after.some(({ at, text }) => at - last.at >= SCAN_QUIET_MS && !LADDER.test(text))) return { kind: "done", ...signedIn, last: last.at };
  return { kind: "scanning", last: last.at, count: ladder.length };
}

export function modelFailurePaths(log: string): string[] {
  return logLines(log).flatMap(({ text }) => {
    const match = IMPORT_FAILED.exec(text);
    return match?.[1] === undefined ? [] : [match[1]];
  });
}

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

export function logTime(at: number, now: number): number {
  const days = Math.floor(at / DAY_MS);
  const within = at - days * DAY_MS;

  const date = (year: number) => new Date(year, Math.floor(days / 31) - 1, days % 31).getTime() + within;
  const year = new Date(now).getFullYear();
  return date(year) > now + DAY_MS ? date(year - 1) : date(year);
}

const SESSION_END = "GameMain Ended";

export function sessionMarks(log: string): { readonly start?: LogLine; readonly login?: LogLine; readonly ended?: LogLine } {
  const lines = sessionLines(log);
  const start = lines.find(({ text }) => text === SESSION_START);
  const login = lines.findLast(({ text }) => text === LOGIN);
  const ended = lines.findLast(({ text }) => text === SESSION_END);
  return { ...(start === undefined ? {} : { start }), ...(login === undefined ? {} : { login }), ...(ended === undefined ? {} : { ended }) };
}

export const sessionText = (log: string) => {
  const start = log.lastIndexOf(SESSION_START);
  return start < 0 ? log : log.slice(log.lastIndexOf("\n", start) + 1);
};
