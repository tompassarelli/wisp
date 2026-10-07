// `wisp engine poll`'s per-client log and `wisp engine diff`, which aligns
// two clients' logs by birth number. Each event line is
//   SECONDS born BIRTH tag TAG CLASS [owner CLASS [at CHUNK:LINE]]
//   SECONDS freed BIRTH tag TAG CLASS [owner CLASS [at CHUNK:LINE]]
// where CHUNK:LINE is where a code callback's Lua function was defined.
// with SECONDS since the poll started (shared by every client one poll
// follows); lines starting with # are notes. `cut -d' ' -f2-` of two logs
// gives a plain `diff`.
import type { Agent, PresenceEvent } from "./presence";

export function eventLine(seconds: number, event: PresenceEvent): string {
  return `${seconds.toFixed(3)} ${event.kind} ${agentText(event.agent)}`;
}

const agentText = (agent: Agent) => `${agent.birth} tag ${agent.tag} ${agent.className}${agent.owner === undefined ? "" : ` owner ${agent.owner}`}${agent.defined === undefined ? "" : ` at ${agent.defined}`}`;

export interface LoggedEvent {
  readonly seconds: number;
  readonly kind: "born" | "freed";
  readonly birth: number;
  readonly tag: number;
  readonly className: string;
  readonly owner: string | undefined;
  readonly defined: string | undefined;
}

const LINE = /^(\d+(?:\.\d+)?) (born|freed) (-?\d+) tag (\d+) (\S+)(?: owner (\S+))?(?: at (\S+))?$/;

export function parsePresenceLog(text: string): LoggedEvent[] {
  return text.split(/\r?\n/).flatMap((line) => {
    const match = LINE.exec(line.trim());
    if (match === null) return [];
    return [{
      seconds: Number(match[1]),
      kind: match[2] === "born" ? "born" as const : "freed" as const,
      birth: Number(match[3]),
      tag: Number(match[4]),
      className: match[5] ?? "?",
      owner: match[6],
      defined: match[7],
    }];
  });
}

const what = (event: LoggedEvent) => `${event.className}${event.owner === undefined ? "" : ` owner ${event.owner}`}${event.defined === undefined ? "" : ` at ${event.defined}`}`;
const signed = (value: number) => `${value >= 0 ? "+" : ""}${value.toFixed(3)}`;

function median(values: readonly number[]): number {
  const sorted = [...values].sort((x, y) => x - y);
  if (sorted.length === 0) return 0;
  const middle = sorted.length >> 1;
  return sorted.length % 2 === 1 ? sorted[middle] ?? 0 : ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2;
}

export interface DiffOptions {
  /** A birth whose A-B time differs from the median by more than this is reported as born at a different moment. */
  readonly skew: number;
  /** How many lines each finding prints at most. */
  readonly limit: number;
}

/**
 * Aligns two clients' logs by birth number over the births both logs cover.
 * In lockstep both clients give the same birth to the same agent, about the
 * same time apart for every birth. A birth one client made on another turn
 * shows as a class difference (the births after it shift) or as a birth
 * whose A-B time stands out from the rest.
 */
export function diffPresenceLogs(names: readonly [string, string], a: readonly LoggedEvent[], b: readonly LoggedEvent[], options: DiffOptions): string {
  const births = (events: readonly LoggedEvent[]) => new Map(events.filter(({ kind }) => kind === "born").map((event) => [event.birth, event]));
  const frees = (events: readonly LoggedEvent[]) => new Map(events.filter(({ kind }) => kind === "freed").map((event) => [event.birth, event]));
  const bornA = births(a);
  const bornB = births(b);
  const range = (map: ReadonlyMap<number, LoggedEvent>) => map.size === 0 ? undefined : [Math.min(...map.keys()), Math.max(...map.keys())] as const;
  const rangeA = range(bornA);
  const rangeB = range(bornB);
  const lines = [
    `A ${names[0]}: ${bornA.size} births${rangeA === undefined ? "" : ` ${rangeA[0]}..${rangeA[1]}`}`,
    `B ${names[1]}: ${bornB.size} births${rangeB === undefined ? "" : ` ${rangeB[0]}..${rangeB[1]}`}`,
  ];
  if (rangeA === undefined || rangeB === undefined) return [...lines, "no births to align"].join("\n");
  const low = Math.max(rangeA[0], rangeB[0]);
  const high = Math.min(rangeA[1], rangeB[1]);
  if (low > high) return [...lines, "the logs cover no common births"].join("\n");
  const both: [LoggedEvent, LoggedEvent][] = [];
  const onlyA: LoggedEvent[] = [];
  const onlyB: LoggedEvent[] = [];
  for (let birth = low; birth <= high; birth++) {
    const ea = bornA.get(birth);
    const eb = bornB.get(birth);
    if (ea !== undefined && eb !== undefined) both.push([ea, eb]);
    else if (ea !== undefined) onlyA.push(ea);
    else if (eb !== undefined) onlyB.push(eb);
  }
  lines.push(`births ${low}..${high}: ${both.length} in both, ${onlyA.length} only in A, ${onlyB.length} only in B`);
  // A birth missing from one log is usually one born and freed between two polls; it's still a lead.
  for (const event of onlyA.slice(0, options.limit)) lines.push(`  only A: birth ${event.birth} ${what(event)} at ${event.seconds.toFixed(3)}`);
  for (const event of onlyB.slice(0, options.limit)) lines.push(`  only B: birth ${event.birth} ${what(event)} at ${event.seconds.toFixed(3)}`);
  const differ = both.filter(([ea, eb]) => what(ea) !== what(eb));
  if (differ.length === 0) lines.push("every birth in both logs has the same class");
  else {
    lines.push(`first class difference: birth ${differ[0]?.[0].birth} (${differ.length} births differ)`);
    for (const [ea, eb] of differ.slice(0, options.limit)) lines.push(`  birth ${ea.birth}: A ${what(ea)} at ${ea.seconds.toFixed(3)}, B ${what(eb)} at ${eb.seconds.toFixed(3)}`);
  }
  const skews = both.map(([ea, eb]) => ea.seconds - eb.seconds);
  const typical = median(skews);
  lines.push(`A-B time per birth: median ${signed(typical)} s`);
  const outliers = both.map(([ea, eb]) => ({ ea, eb, off: ea.seconds - eb.seconds - typical }))
    .filter(({ off }) => Math.abs(off) > options.skew);
  if (outliers.length === 0) lines.push(`no birth's A-B time is more than ${options.skew} s from the median`);
  else {
    lines.push(`births made at a different moment on one client (A-B more than ${options.skew} s from the median): ${outliers.length}`);
    for (const { ea, eb, off } of outliers.slice(0, options.limit)) lines.push(`  birth ${ea.birth} ${what(ea)}: A ${ea.seconds.toFixed(3)} B ${eb.seconds.toFixed(3)} (${signed(off)} s)`);
  }
  const freedA = frees(a);
  const freedB = frees(b);
  const freeOnly = (mine: ReadonlyMap<number, LoggedEvent>, theirs: ReadonlyMap<number, LoggedEvent>) =>
    [...mine.values()].filter(({ birth }) => birth >= low && birth <= high && !theirs.has(birth));
  const freedOnlyA = freeOnly(freedA, freedB);
  const freedOnlyB = freeOnly(freedB, freedA);
  if (freedOnlyA.length + freedOnlyB.length > 0) {
    lines.push(`frees of common births logged on one client only: ${freedOnlyA.length} A, ${freedOnlyB.length} B (the other may free it after its log ends)`);
    for (const event of freedOnlyA.slice(0, options.limit)) lines.push(`  freed only on A: birth ${event.birth} ${what(event)} at ${event.seconds.toFixed(3)}`);
    for (const event of freedOnlyB.slice(0, options.limit)) lines.push(`  freed only on B: birth ${event.birth} ${what(event)} at ${event.seconds.toFixed(3)}`);
  }
  return lines.join("\n");
}
