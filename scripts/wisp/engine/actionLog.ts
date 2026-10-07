// The LAN host's action log (wisp:scripts/wisp/lan/host.ts) as data, and its
// alignment with `wisp engine poll`'s presence logs (wisp:docs/engine.md,
// "Actions"). The action log's header names its start as an ISO time; each
// line is `SECONDS TEXT`, where a turn's actions read
//   SECONDS turn N CLIENT pPID KIND FIELDS...
// and a time mark about every second reads `SECONDS mark turn N game G`.
// A poll log's header names its own start the same way, so a birth's wall
// time places it in a turn.
import type { LoggedEvent } from "./presenceLog";

export interface LoggedAction {
  readonly seconds: number;
  readonly turn: number;
  readonly client: string;
  readonly pid: number;
  readonly kind: string;
  readonly text: string;
}

export interface ActionLog {
  /** Milliseconds since the epoch at the log's second 0. */
  readonly start: number;
  readonly actions: readonly LoggedAction[];
  /** Turn starts the log pins: from marks and from turns with actions. */
  readonly turnTimes: readonly { readonly turn: number; readonly seconds: number }[];
  /** Every other line: joins, phases, loads, leaves, desyncs. */
  readonly events: readonly { readonly seconds: number; readonly text: string }[];
}

/** The ISO time a log header names after "seconds since". */
export function headerStart(text: string): number | undefined {
  const match = /seconds since (\d{4}-\d\d-\d\dT[\d:.]+Z)/.exec(text.split("\n", 1)[0] ?? "");
  if (match === null) return undefined;
  const time = Date.parse(match[1] ?? "");
  return Number.isFinite(time) ? time : undefined;
}

export const isActionLog = (text: string) => text.startsWith("# wisp lan host");

const ACTION = /^(\d+(?:\.\d+)?) turn (\d+) (\S+) p(\d+) (\S+) ?(.*)$/;
const MARK = /^(\d+(?:\.\d+)?) mark turn (\d+)/;

export function parseActionLog(text: string): ActionLog {
  const start = headerStart(text);
  if (start === undefined) throw new Error("the action log's first line names no start time");
  const actions: LoggedAction[] = [];
  const turnTimes: { turn: number; seconds: number }[] = [];
  const events: { seconds: number; text: string }[] = [];
  for (const line of text.split(/\r?\n/)) {
    if (line.startsWith("#") || line.trim() === "") continue;
    const action = ACTION.exec(line);
    if (action !== null) {
      const seconds = Number(action[1]);
      const turn = Number(action[2]);
      actions.push({ seconds, turn, client: action[3] ?? "", pid: Number(action[4]), kind: action[5] ?? "", text: action[6] ?? "" });
      if (turnTimes.at(-1)?.turn !== turn) turnTimes.push({ turn, seconds });
      continue;
    }
    const mark = MARK.exec(line);
    if (mark !== null) {
      turnTimes.push({ turn: Number(mark[2]), seconds: Number(mark[1]) });
      continue;
    }
    const space = line.indexOf(" ");
    events.push({ seconds: Number(line.slice(0, space)), text: line.slice(space + 1) });
  }
  turnTimes.sort((x, y) => x.seconds - y.seconds);
  return { start, actions, turnTimes, events };
}

/** The turn being played `seconds` into the action log: the last pinned turn before it, plus the turns of `turnMs` since. */
export function turnAt(log: ActionLog, seconds: number, turnMs: number): number | undefined {
  let last: { turn: number; seconds: number } | undefined;
  for (const time of log.turnTimes) {
    if (time.seconds > seconds) break;
    last = time;
  }
  if (last === undefined) return undefined;
  return last.turn + Math.floor(((seconds - last.seconds) * 1000) / turnMs);
}

/**
 * Each birth in a presence log placed in the action log's turns, with the
 * actions of that turn and the one before: what the network had just
 * delivered when the engine made the object.
 */
/** How far back a birth looks for the actions that led to it: about a second of 30 ms turns. */
const RECENT_TURNS = 33;

export function alignBirths(log: ActionLog, births: readonly LoggedEvent[], pollStart: number, options: { readonly turnMs: number; readonly limit: number; readonly classes?: RegExp }): string[] {
  const lines: string[] = [];
  const offset = (pollStart - log.start) / 1000;
  for (const event of births) {
    if (event.kind !== "born" || (options.classes !== undefined && !options.classes.test(event.className))) continue;
    const seconds = event.seconds + offset;
    const turn = turnAt(log, seconds, options.turnMs);
    // The newest turn with actions at or before this one, within a second: what the network had just delivered.
    const lastTurn = turn === undefined ? undefined : log.actions.findLast((action) => action.turn <= turn && action.turn > turn - RECENT_TURNS)?.turn;
    const near = lastTurn === undefined ? [] : log.actions.filter((action) => action.turn === lastTurn);
    const after = near.length === 0 || turn === undefined ? "" : `; ${turn - (lastTurn ?? 0)} turns after turn ${lastTurn}: ${near.map((action) => `${action.client} ${action.kind} ${action.text}`.slice(0, 120)).join("; ")}`;
    lines.push(`${seconds.toFixed(3)} birth ${event.birth} ${event.className}${event.owner === undefined ? "" : ` owner ${event.owner}`} ${turn === undefined ? "before the game" : `in turn ${turn}`}${after}`);
    if (lines.length >= options.limit) break;
  }
  return lines;
}
