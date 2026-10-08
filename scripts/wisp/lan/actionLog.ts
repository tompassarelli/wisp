// The LAN host's action log (wisp:scripts/wisp/lan/host.ts) as data. Its
// header names its start as an ISO time; each line is `SECONDS TEXT`, where
// a turn's actions read
//   SECONDS turn N CLIENT pPID KIND FIELDS...
// and a time mark about every second reads `SECONDS mark turn N game G`.

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
