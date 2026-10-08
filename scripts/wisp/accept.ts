// Native acceptance as one batched run: a game declares the checks only
// Warcraft III itself can answer, next to the issue each closes, and
// `wisp accept` runs every selected check in as few fresh matches as their
// maps allow, saves each check's evidence and gives it a verdict: pass, fail
// or needs-look. Declarations are plain data; the driver (AcceptDriver) is the
// only part that touches clients, so a run can be planned, printed and tested
// without Warcraft.
import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Clock, Context, Duration, Effect, Schedule, Schema } from "effect";
import { logLines, sessionStart } from "../warcraft/war3Log";
import type { Ink, Region } from "../warcraft/desktop";
import { preloadLines } from "./boundary";
import { describeCause } from "./command";
import { encodePpm, type Frame } from "./frameProbe";

/** Something done to a client before the captures; `client` defaults to the first (the host). */
export type Step =
  /** A chat message or chat command: Return, the text, Return. */
  | { readonly chat: string; readonly client?: string }
  | { readonly keys: readonly string[]; readonly client?: string }
  | { readonly waitMs: number }
  /** Waits until a receipt line written since the check began matches. */
  | { readonly receipt: string; readonly client?: string; readonly seconds?: number };

/** What a check keeps as evidence; `client` defaults to the first. Receipts and War3Log lines are always kept. */
export type Capture =
  /** `count` frames `everyMs` apart (default one), cropped to `region`, saved as PPM. */
  | { readonly kind: "frames"; readonly name: string; readonly client?: string; readonly region?: Region; readonly count?: number; readonly everyMs?: number }
  /**
   * Text read from `region` (an overlay, a label). With `pattern`, the reading
   * is its first group, as a number when it reads as one; no match is no reading.
   */
  | { readonly kind: "reading"; readonly name: string; readonly client?: string; readonly region?: Region; readonly ink?: Ink; readonly pattern?: string }
  /** One frame, saved, measured by the suite's `measures[measure]`: a reading named `name`. */
  | { readonly kind: "measure"; readonly name: string; readonly client?: string; readonly region?: Region; readonly measure: string };

/** Bounds on a count of matching lines; with neither, at least one. */
interface Count {
  readonly min?: number;
  readonly max?: number;
}

/**
 * A pass rule. `client` omitted means every client must satisfy it. With
 * `orLook`, a rule that doesn't hold makes the check needs-look instead of
 * fail: for readings of the screen, which can miss.
 */
export type Rule = (
  /** Receipt lines the game wrote during the check that match `pattern`. */
  | { readonly kind: "receipt"; readonly pattern: string; readonly client?: string } & Count
  /** War3Log lines that match `pattern`, written during the check or, with `since: "session"`, since the session's match began. */
  | { readonly kind: "log"; readonly pattern: string; readonly client?: string; readonly since?: "check" | "session" } & Count
  /** A reading or measure: a number within `min`..`max`, or text matching `pattern`. */
  | { readonly kind: "reading"; readonly name: string; readonly min?: number; readonly max?: number; readonly pattern?: string }
) & { readonly orLook?: boolean };

export interface NativeCheck {
  readonly id: string;
  /** The issue and box the check answers, as the report prints it: "smashcraft#82 box 2". */
  readonly closes: string;
  /** One of the suite's map profiles: the map, build and match setup the session starts. */
  readonly map: string;
  /** Checks of one map share a fresh match unless they name different sessions. */
  readonly session?: string;
  readonly setup?: readonly Step[];
  readonly capture?: readonly Capture[];
  readonly pass?: readonly Rule[];
  /** What the owner looks for in the captures. A check with it is needs-look once its rules hold. */
  readonly look?: string;
}

export interface AcceptSuite {
  /** Map profiles by name, each with what it starts, for the plan. The driver knows how to start each. */
  readonly maps: Readonly<Record<string, { readonly describe: string }>>;
  readonly checks: readonly NativeCheck[];
  /** Frame measurements `measure` captures name, such as the row a stage edge sits on. */
  readonly measures?: Readonly<Record<string, (frame: Frame) => number | undefined>>;
}

export class AcceptFailure extends Schema.TaggedError<AcceptFailure>()("AcceptFailure", {
  operation: Schema.String,
  problem: Schema.String,
}) {
  override get message(): string {
    return `${this.operation}: ${this.problem}`;
  }
}

/** A file the map writes into a client's CustomMapData. */
export interface ReceiptFile {
  readonly name: string;
  readonly text: string;
  /** Milliseconds since the epoch, on the Effect Clock's scale. */
  readonly modified: number;
}

/** The clients an accept run drives. A test supplies a fake; wisp:scripts/wisp/acceptLive.ts the signed-in clients. */
export class AcceptDriver extends Context.Service<AcceptDriver, {
  /** Client names, the host first. */
  readonly clients: readonly [string, ...string[]];
  /** Every client healthy enough to start a session (doctor). */
  readonly prepare: Effect.Effect<void, AcceptFailure>;
  /** A fresh match of `map` in every client, ready for checks. */
  readonly start: (map: string, session: string) => Effect.Effect<void, AcceptFailure>;
  readonly chat: (client: string, text: string) => Effect.Effect<void, AcceptFailure>;
  readonly keys: (client: string, keys: readonly string[]) => Effect.Effect<void, AcceptFailure>;
  readonly capture: (client: string) => Effect.Effect<Frame, AcceptFailure>;
  readonly read: (client: string, region: Region | undefined, ink: Ink) => Effect.Effect<string, AcceptFailure>;
  /** The map's receipt files as they stand. */
  readonly receipts: (client: string) => Effect.Effect<readonly ReceiptFile[], AcceptFailure>;
  /** Warcraft III's War3Log.txt as it stands; empty while it doesn't exist. */
  readonly log: (client: string) => Effect.Effect<string, AcceptFailure>;
  /** One line on what the client is doing, for the report. */
  readonly state: (client: string) => Effect.Effect<string, AcceptFailure>;
}>()("wisp/AcceptDriver") {}

// ---- Plan -----------------------------------------------------------------

export interface PlannedSession {
  readonly map: string;
  readonly session: string;
  readonly checks: readonly NativeCheck[];
}

const DEFAULT_SESSION = "shared";

/** Selected checks: every check, or those `only` names (an id, or a prefix ending in `*`). */
export function selectChecks(suite: AcceptSuite, only: readonly string[]): { readonly checks: readonly NativeCheck[]; readonly unknown: readonly string[] } {
  if (only.length === 0) return { checks: suite.checks, unknown: [] };
  const matches = (pattern: string, id: string) => (pattern.endsWith("*") ? id.startsWith(pattern.slice(0, -1)) : id === pattern);
  return {
    checks: suite.checks.filter(({ id }) => only.some((pattern) => matches(pattern, id))),
    unknown: only.filter((pattern) => !suite.checks.some(({ id }) => matches(pattern, id))),
  };
}

/**
 * Sessions for `checks`: one per map and named session, maps in the order
 * their first check is declared, so a map's sessions run back to back and
 * each check keeps its declared order within its session.
 */
export function planSessions(checks: readonly NativeCheck[]): PlannedSession[] {
  const maps = new Map<string, Map<string, NativeCheck[]>>();
  for (const check of checks) {
    const sessions = maps.get(check.map) ?? new Map<string, NativeCheck[]>();
    maps.set(check.map, sessions);
    const session = check.session ?? DEFAULT_SESSION;
    sessions.set(session, [...(sessions.get(session) ?? []), check]);
  }
  return [...maps].flatMap(([map, sessions]) => [...sessions].map(([session, grouped]) => ({ map, session, checks: grouped })));
}

/** Problems a suite's declarations have: duplicate ids, unknown maps or measures, rules naming no capture, bad patterns. */
export function suiteProblems(suite: AcceptSuite, clients?: readonly string[]): string[] {
  const problems: string[] = [];
  const seen = new Set<string>();
  const pattern = (id: string, source: string) => {
    try {
      new RegExp(source);
    } catch {
      problems.push(`${id}: pattern ${source} is not a regular expression`);
    }
  };
  const client = (id: string, name: string | undefined) => {
    if (name !== undefined && clients !== undefined && !clients.includes(name)) problems.push(`${id}: unknown client ${name}`);
  };
  for (const check of suite.checks) {
    const { id } = check;
    if (seen.has(id)) problems.push(`${id}: declared twice`);
    seen.add(id);
    if (!(check.map in suite.maps)) problems.push(`${id}: unknown map profile ${check.map}`);
    const readings = new Set<string>();
    for (const step of check.setup ?? []) {
      if ("receipt" in step) pattern(id, step.receipt);
      if ("client" in step) client(id, step.client);
    }
    for (const capture of check.capture ?? []) {
      client(id, capture.client);
      if (capture.kind === "reading" && capture.pattern !== undefined) pattern(id, capture.pattern);
      if (capture.kind === "measure" && suite.measures?.[capture.measure] === undefined) problems.push(`${id}: unknown measure ${capture.measure}`);
      if (capture.kind !== "frames") readings.add(capture.name);
    }
    for (const rule of check.pass ?? []) {
      if (rule.kind === "reading" && !readings.has(rule.name)) problems.push(`${id}: rule reads ${rule.name}, which no capture takes`);
      if (rule.kind !== "reading") client(id, rule.client);
      if (rule.pattern !== undefined) pattern(id, rule.pattern);
    }
    if ((check.pass ?? []).length === 0 && check.look === undefined) problems.push(`${id}: no pass rule and nothing to look at`);
  }
  return problems;
}

const describeRegion = (region: Region | undefined) => (region === undefined ? "whole frame" : `${region.width}x${region.height}+${region.x}+${region.y}`);
const describeCount = ({ min, max }: Count) => (min === undefined && max === undefined ? ">= 1" : max === undefined ? `>= ${min}` : min === undefined ? `<= ${max}` : min === max ? `= ${min}` : `${min}..${max}`);

export function describeStep(step: Step, host: string): string {
  if ("chat" in step) return `chat ${step.client ?? host}: ${step.chat}`;
  if ("keys" in step) return `keys ${step.client ?? host}: ${step.keys.join(" ")}`;
  if ("waitMs" in step) return `wait ${step.waitMs} ms`;
  return `wait for receipt ${step.client ?? host} /${step.receipt}/ (${step.seconds ?? DEFAULT_RECEIPT_SECONDS} s)`;
}

export function describeCapture(capture: Capture, host: string): string {
  const client = capture.client ?? host;
  if (capture.kind === "frames") return `frames ${capture.name} ${client} ${describeRegion(capture.region)} x${capture.count ?? 1}${(capture.count ?? 1) > 1 ? ` every ${capture.everyMs ?? 0} ms` : ""}`;
  if (capture.kind === "reading") return `reading ${capture.name} ${client} ${describeRegion(capture.region)}${capture.pattern === undefined ? "" : ` /${capture.pattern}/`}`;
  return `measure ${capture.name} ${client} ${capture.measure} ${describeRegion(capture.region)}`;
}

export function describeRule(rule: Rule): string {
  const look = rule.orLook === true ? " (else look)" : "";
  if (rule.kind === "receipt") return `receipt ${rule.client ?? "every client"} /${rule.pattern}/ ${describeCount(rule)}${look}`;
  if (rule.kind === "log") return `War3Log ${rule.client ?? "every client"} /${rule.pattern}/ since ${rule.since ?? "check"} ${describeCount(rule)}${look}`;
  const bounds = rule.pattern !== undefined ? `/${rule.pattern}/` : describeCount(rule);
  return `reading ${rule.name} ${bounds}${look}`;
}

/** The plan as text: each session, its checks, and what each does, captures and requires. */
export function describePlan(suite: AcceptSuite, sessions: readonly PlannedSession[], host: string): string[] {
  const total = sessions.reduce((sum, { checks }) => sum + checks.length, 0);
  const lines = [`${total} check${total === 1 ? "" : "s"} in ${sessions.length} session${sessions.length === 1 ? "" : "s"}`];
  sessions.forEach(({ map, session, checks }, index) => {
    lines.push(`session ${index + 1}/${sessions.length}: ${map} (${session}): ${suite.maps[map]?.describe ?? "unknown map profile"}`);
    for (const check of checks) {
      lines.push(`  ${check.id}  ${check.closes}`);
      for (const step of check.setup ?? []) lines.push(`    do       ${describeStep(step, host)}`);
      for (const capture of check.capture ?? []) lines.push(`    capture  ${describeCapture(capture, host)}`);
      for (const rule of check.pass ?? []) lines.push(`    pass     ${describeRule(rule)}`);
      if (check.look !== undefined) lines.push(`    look     ${check.look}`);
    }
  });
  return lines;
}

// ---- Run ------------------------------------------------------------------

export type Verdict = "pass" | "fail" | "needs-look";

export interface RuleResult {
  readonly rule: string;
  readonly holds: boolean;
  readonly observed: string;
  readonly orLook: boolean;
}

export interface CheckResult {
  readonly id: string;
  readonly closes: string;
  readonly map: string;
  readonly session: string;
  readonly verdict: Verdict;
  /** Why: the first rule that failed, the error, or what to look at. */
  readonly reason: string;
  readonly evidence: string;
  readonly rules: readonly RuleResult[];
  readonly readings: Readonly<Record<string, number | string | null>>;
  readonly files: readonly string[];
}

export interface AcceptReport {
  readonly directory: string;
  readonly started: number;
  readonly finished: number;
  readonly results: readonly CheckResult[];
}

const DEFAULT_RECEIPT_SECONDS = 10;
const RECEIPT_POLL = Duration.millis(100);

/** A client's receipts and War3Log at a moment: what a check compares against. */
interface Mark {
  readonly receipts: ReadonlyMap<string, number>;
  readonly logSession: string | undefined;
  readonly logLines: number;
}

interface Observed {
  /** New receipt lines per client. */
  readonly receipts: Map<string, string[]>;
  /** New War3Log lines per client, since the check and since the session. */
  readonly log: Map<string, string[]>;
  readonly sessionLog: Map<string, string[]>;
}

const fileFailure = (operation: string) => (cause: unknown) => new AcceptFailure({ operation, problem: describeCause(cause) });

/** A private directory (owner only), created with its parents. */
export const privateDirectory = (path: string) => Effect.try({
  try: () => {
    mkdirSync(path, { recursive: true, mode: 0o700 });
    chmodSync(path, 0o700);
    return path;
  },
  catch: fileFailure(`create evidence directory ${path}`),
});

const save = (path: string, contents: string | Uint8Array) => Effect.try({ try: () => writeFileSync(path, contents, { mode: 0o600 }), catch: fileFailure(`write ${path}`) });

/** Part of a frame. */
export function cropFrame(frame: Frame, region: Region | undefined): Frame {
  if (region === undefined) return frame;
  const left = Math.max(0, Math.min(frame.width, Math.floor(region.x)));
  const top = Math.max(0, Math.min(frame.height, Math.floor(region.y)));
  const width = Math.max(0, Math.min(frame.width - left, Math.floor(region.width)));
  const height = Math.max(0, Math.min(frame.height - top, Math.floor(region.height)));
  const rgb = new Uint8Array(width * height * 3);
  for (let row = 0; row < height; row++) {
    const from = ((top + row) * frame.width + left) * 3;
    rgb.set(frame.rgb.subarray(from, from + width * 3), row * width * 3);
  }
  return { width, height, rgb };
}

/** The lines a receipt file holds: a Preload file's stored lines, else its text lines. */
export const receiptLines = (text: string) => preloadLines(text) ?? text.split(/\r?\n/).filter((line) => line.trim() !== "");

const fileName = (value: string) => value.replace(/[^A-Za-z0-9._-]+/g, "_");

const countHolds = (count: number, { min, max }: Count) => count >= (min ?? (max === undefined ? 1 : 0)) && (max === undefined || count <= max);

/** Runs `sessions` with the driver, saving evidence under `directory`; every check gets a result, even when its session can't start. */
export const runAccept = (suite: AcceptSuite, sessions: readonly PlannedSession[], directory: string, print: (line: string) => Effect.Effect<void> = () => Effect.void) =>
  Effect.gen(function*() {
    const driver = yield* AcceptDriver;
    const [host] = driver.clients;
    const started = yield* Clock.currentTimeMillis;
    yield* privateDirectory(directory);
    const results: CheckResult[] = [];

    const mark = (client: string) => Effect.gen(function*() {
      const receipts = new Map((yield* driver.receipts(client)).map(({ name, modified }) => [name, modified]));
      const log = yield* driver.log(client);
      return { receipts, logSession: sessionStart(log), logLines: logLines(log).length } satisfies Mark;
    });
    const marks = (clients: readonly string[]) => Effect.forEach(clients, (client) => Effect.map(mark(client), (value) => [client, value] as const)).pipe(Effect.map((entries) => new Map(entries)));

    /** Receipt lines in files written since `since`. */
    const newReceipts = (client: string, since: Mark) => Effect.map(driver.receipts(client), (files) =>
      files.filter(({ name, modified }) => modified > (since.receipts.get(name) ?? -Infinity)).flatMap(({ text }) => receiptLines(text)));
    const newLog = (client: string, since: Mark) => Effect.map(driver.log(client), (log) => {
      const lines = logLines(log).map(({ text }) => text);
      // A new Warcraft III session rewrote the log: every line is new.
      return sessionStart(log) === since.logSession ? lines.slice(since.logLines) : lines;
    });

    const runCheck = (check: NativeCheck, session: PlannedSession, sessionMarks: ReadonlyMap<string, Mark>) => Effect.gen(function*() {
      const evidence = yield* privateDirectory(join(directory, fileName(check.id)));
      const files: string[] = [];
      const readings: Record<string, number | string | null> = {};
      const checkMarks = yield* marks(driver.clients);
      const markOf = (client: string) => checkMarks.get(client)!;

      for (const step of check.setup ?? []) {
        if ("chat" in step) yield* driver.chat(step.client ?? host, step.chat);
        else if ("keys" in step) yield* driver.keys(step.client ?? host, step.keys);
        else if ("waitMs" in step) yield* Effect.sleep(Duration.millis(step.waitMs));
        else {
          const client = step.client ?? host;
          const pattern = new RegExp(step.receipt);
          const seconds = step.seconds ?? DEFAULT_RECEIPT_SECONDS;
          yield* newReceipts(client, markOf(client)).pipe(
            Effect.repeat({ schedule: Schedule.spaced(RECEIPT_POLL), until: (lines) => lines.some((line) => pattern.test(line)) }),
            Effect.timeoutOrElse({ duration: Duration.seconds(seconds), orElse: () => Effect.fail(new AcceptFailure({ operation: describeStep(step, host), problem: `no matching receipt within ${seconds} s` })) }),
          );
        }
      }

      for (const capture of check.capture ?? []) {
        const client = capture.client ?? host;
        if (capture.kind === "frames") {
          const count = capture.count ?? 1;
          for (let index = 0; index < count; index++) {
            if (index > 0) yield* Effect.sleep(Duration.millis(capture.everyMs ?? 0));
            const frame = cropFrame(yield* driver.capture(client), capture.region);
            const name = `${fileName(capture.name)}-${client}-${String(index).padStart(2, "0")}.ppm`;
            yield* save(join(evidence, name), encodePpm(frame));
            files.push(name);
          }
        } else if (capture.kind === "reading") {
          const text = yield* driver.read(client, capture.region, capture.ink ?? "light");
          const name = `${fileName(capture.name)}-${client}.txt`;
          yield* save(join(evidence, name), text);
          files.push(name);
          if (capture.pattern === undefined) readings[capture.name] = text.trim();
          else {
            const match = new RegExp(capture.pattern).exec(text.replace(/\s+/g, " "));
            const value = match === null ? undefined : (match[1] ?? match[0]);
            readings[capture.name] = value === undefined ? null : value.trim() !== "" && Number.isFinite(Number(value)) ? Number(value) : value;
          }
        } else {
          const frame = cropFrame(yield* driver.capture(client), capture.region);
          const name = `${fileName(capture.name)}-${client}.ppm`;
          yield* save(join(evidence, name), encodePpm(frame));
          files.push(name);
          readings[capture.name] = suite.measures?.[capture.measure]?.(frame) ?? null;
        }
      }

      const observed: Observed = { receipts: new Map(), log: new Map(), sessionLog: new Map() };
      for (const client of driver.clients) {
        const receipts = yield* newReceipts(client, markOf(client));
        const log = yield* newLog(client, markOf(client));
        const sessionLog = yield* newLog(client, sessionMarks.get(client)!);
        observed.receipts.set(client, receipts);
        observed.log.set(client, log);
        observed.sessionLog.set(client, sessionLog);
        for (const [name, lines] of [[`receipts-${client}.txt`, receipts], [`war3log-${client}.txt`, log]] as const) {
          yield* save(join(evidence, name), lines.length === 0 ? "" : `${lines.join("\n")}\n`);
          files.push(name);
        }
      }

      const rules = (check.pass ?? []).map((rule) => judge(rule, observed, readings, driver.clients));
      const failed = rules.find((rule) => !rule.holds && !rule.orLook);
      const unsure = rules.find((rule) => !rule.holds && rule.orLook);
      const verdict: Verdict = failed !== undefined ? "fail" : unsure !== undefined || check.look !== undefined ? "needs-look" : "pass";
      const reason = failed !== undefined ? `${failed.rule}: ${failed.observed}`
        : unsure !== undefined ? `${unsure.rule}: ${unsure.observed}${check.look === undefined ? "" : `; look: ${check.look}`}`
        : check.look !== undefined ? `look: ${check.look}`
        : rules.map(({ rule, observed: seen }) => `${rule}: ${seen}`).join("; ");
      return { verdict, reason, evidence, rules, readings, files };
    });

    const record = (check: NativeCheck, session: PlannedSession, outcome: Omit<CheckResult, "id" | "closes" | "map" | "session">) => Effect.gen(function*() {
      const result: CheckResult = { id: check.id, closes: check.closes, map: session.map, session: session.session, ...outcome };
      results.push(result);
      yield* save(join(result.evidence, "check.json"), `${JSON.stringify({ ...result, declared: check }, null, 2)}\n`);
      yield* print(resultLine(result));
    });

    for (const [index, session] of sessions.entries()) {
      yield* print(`session ${index + 1}/${sessions.length}: ${session.map} (${session.session}), ${session.checks.length} check${session.checks.length === 1 ? "" : "s"}`);
      // The log mark comes before the match starts, so "since session" covers the map's load.
      const begun = yield* Effect.gen(function*() {
        yield* driver.prepare;
        const sessionMarks = yield* marks(driver.clients);
        yield* driver.start(session.map, session.session);
        return sessionMarks;
      }).pipe(Effect.result);
      if (begun._tag === "Failure") {
        const states = yield* Effect.forEach(driver.clients, (client) => driver.state(client).pipe(Effect.map((state) => `${client}: ${state}`), Effect.orElseSucceed(() => `${client}: unknown`)));
        for (const check of session.checks) {
          const evidence = yield* privateDirectory(join(directory, fileName(check.id)));
          yield* record(check, session, { verdict: "fail", reason: `session did not start: ${begun.failure.message} (${states.join("; ")})`, evidence, rules: [], readings: {}, files: [] });
        }
        continue;
      }
      for (const check of session.checks) {
        const outcome = yield* runCheck(check, session, begun.success).pipe(Effect.result);
        if (outcome._tag === "Success") yield* record(check, session, outcome.success);
        else yield* record(check, session, { verdict: "fail", reason: outcome.failure.message, evidence: join(directory, fileName(check.id)), rules: [], readings: {}, files: [] });
      }
    }

    const report: AcceptReport = { directory, started, finished: yield* Clock.currentTimeMillis, results };
    yield* save(join(directory, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
    yield* save(join(directory, "report.txt"), `${[...results.map(resultLine), summaryLine(results)].join("\n")}\n`);
    return report;
  });

function judge(rule: Rule, observed: Observed, readings: Readonly<Record<string, number | string | null>>, clients: readonly string[]): RuleResult {
  const orLook = rule.orLook === true;
  const text = describeRule(rule);
  if (rule.kind === "reading") {
    const value = readings[rule.name];
    if (value === undefined || value === null) return { rule: text, holds: false, observed: "no reading", orLook };
    if (rule.pattern !== undefined) return { rule: text, holds: new RegExp(rule.pattern).test(String(value)), observed: `read ${JSON.stringify(value)}`, orLook };
    if (typeof value !== "number") return { rule: text, holds: false, observed: `read ${JSON.stringify(value)}, not a number`, orLook };
    return { rule: text, holds: (rule.min === undefined || value >= rule.min) && (rule.max === undefined || value <= rule.max), observed: `read ${value}`, orLook };
  }
  const pattern = new RegExp(rule.pattern);
  const source = rule.kind === "receipt" ? observed.receipts : rule.since === "session" ? observed.sessionLog : observed.log;
  const counts = (rule.client === undefined ? clients : [rule.client]).map((client) => {
    const lines = (source.get(client) ?? []).filter((line) => pattern.test(line));
    return { client, count: lines.length, first: lines[0] };
  });
  const holds = counts.every(({ count }) => countHolds(count, rule));
  return { rule: text, holds, observed: counts.map(({ client, count, first }) => `${client} ${count}${first === undefined ? "" : ` (first: ${first})`}`).join(", "), orLook };
}

const VERDICT_LABEL: Record<Verdict, string> = { "pass": "PASS      ", "fail": "FAIL      ", "needs-look": "NEEDS-LOOK" };

export const resultLine = (result: CheckResult) => `${VERDICT_LABEL[result.verdict]} ${result.id}  ${result.closes}  ${result.reason}  ${result.evidence}`;

export function summaryLine(results: readonly CheckResult[]): string {
  const count = (verdict: Verdict) => results.filter((result) => result.verdict === verdict).length;
  return `${results.length} checks: ${count("pass")} pass, ${count("fail")} fail, ${count("needs-look")} needs-look`;
}

// ---- Shards ---------------------------------------------------------------

/** A session's rough cost: its fresh match dominates, then each check. */
const sessionWeight = (session: PlannedSession) => 4 + session.checks.length;

/**
 * `sessions` split over `count` shards (such as offline pool pairs), heaviest
 * first onto the lightest shard, so the shards finish close together. Each
 * shard keeps the plan's session order. Empty shards are dropped.
 */
export function shardSessions(sessions: readonly PlannedSession[], count: number): PlannedSession[][] {
  const shards = Array.from({ length: Math.max(1, count) }, () => ({ weight: 0, indexes: [] as number[] }));
  const order = sessions.map((session, index) => ({ index, weight: sessionWeight(session) })).sort((left, right) => right.weight - left.weight || left.index - right.index);
  for (const { index, weight } of order) {
    const lightest = shards.reduce((best, shard) => (shard.weight < best.weight ? shard : best));
    lightest.weight += weight;
    lightest.indexes.push(index);
  }
  return shards.filter(({ indexes }) => indexes.length > 0).map(({ indexes }) => indexes.sort((left, right) => left - right).map((index) => sessions[index]!));
}

/**
 * One report from the shards' reports: each shard's results, in the plan's
 * check order. A check whose shard wrote no result fails with `missing(id)`.
 */
export function mergeReports(directory: string, checks: readonly NativeCheck[], reports: readonly AcceptReport[], started: number, finished: number, missing: (check: NativeCheck) => CheckResult): AcceptReport {
  const byId = new Map(reports.flatMap(({ results }) => results.map((result) => [result.id, result] as const)));
  return { directory, started, finished, results: checks.map((check) => byId.get(check.id) ?? missing(check)) };
}
