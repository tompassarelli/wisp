import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Clock, Context, Duration, Effect, Schema } from "effect";
import { pollUntil } from "./hostProcess";
import { logLines, sessionStart } from "../warcraft/war3Log";
import type { Ink, Region } from "../warcraft/desktop";
import { preloadLines } from "./preloadRecord";
import { describeCause } from "./command";
import { encodePpm, type Frame } from "./frameProbe";

export type Step =

  | { readonly chat: string; readonly client?: string }
  | { readonly keys: readonly string[]; readonly client?: string }
  | { readonly waitMs: number }

  | { readonly receipt: string; readonly client?: string; readonly seconds?: number };

export type Capture =

  | { readonly kind: "frames"; readonly name: string; readonly client?: string; readonly region?: Region; readonly count?: number; readonly everyMs?: number }

  | { readonly kind: "reading"; readonly name: string; readonly client?: string; readonly region?: Region; readonly ink?: Ink; readonly pattern?: string }

  | { readonly kind: "measure"; readonly name: string; readonly client?: string; readonly region?: Region; readonly measure: string };

interface Count {
  readonly min?: number;
  readonly max?: number;
}

export type Rule = (

  | { readonly kind: "receipt"; readonly pattern: string; readonly client?: string } & Count

  | { readonly kind: "log"; readonly pattern: string; readonly client?: string; readonly since?: "check" | "session" } & Count

  | { readonly kind: "reading"; readonly name: string; readonly min?: number; readonly max?: number; readonly pattern?: string }
) & { readonly orLook?: boolean };

export interface NativeCheck {
  readonly id: string;

  readonly closes: string;

  readonly map: string;

  readonly session?: string;
  readonly setup?: readonly Step[];
  readonly capture?: readonly Capture[];
  readonly pass?: readonly Rule[];

  readonly look?: string;
}

export interface AcceptSuite {

  readonly maps: Readonly<Record<string, { readonly describe: string }>>;
  readonly checks: readonly NativeCheck[];

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

export interface ReceiptFile {
  readonly name: string;
  readonly text: string;

  readonly modified: number;
}

export class AcceptDriver extends Context.Service<AcceptDriver, {

  readonly clients: readonly [string, ...string[]];

  readonly prepare: Effect.Effect<void, AcceptFailure>;

  readonly start: (map: string, session: string) => Effect.Effect<void, AcceptFailure>;
  readonly chat: (client: string, text: string) => Effect.Effect<void, AcceptFailure>;
  readonly keys: (client: string, keys: readonly string[]) => Effect.Effect<void, AcceptFailure>;
  readonly capture: (client: string) => Effect.Effect<Frame, AcceptFailure>;
  readonly read: (client: string, region: Region | undefined, ink: Ink) => Effect.Effect<string, AcceptFailure>;

  readonly receipts: (client: string) => Effect.Effect<readonly ReceiptFile[], AcceptFailure>;

  readonly log: (client: string) => Effect.Effect<string, AcceptFailure>;

  readonly state: (client: string) => Effect.Effect<string, AcceptFailure>;
}>()("wisp/AcceptDriver") {}

export interface PlannedSession {
  readonly map: string;
  readonly session: string;
  readonly checks: readonly NativeCheck[];
}

const DEFAULT_SESSION = "shared";

export function selectChecks(suite: AcceptSuite, only: readonly string[]): { readonly checks: readonly NativeCheck[]; readonly unknown: readonly string[] } {
  if (only.length === 0) return { checks: suite.checks, unknown: [] };
  const matches = (pattern: string, id: string) => (pattern.endsWith("*") ? id.startsWith(pattern.slice(0, -1)) : id === pattern);
  return {
    checks: suite.checks.filter(({ id }) => only.some((pattern) => matches(pattern, id))),
    unknown: only.filter((pattern) => !suite.checks.some(({ id }) => matches(pattern, id))),
  };
}

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

interface Mark {
  readonly receipts: ReadonlyMap<string, number>;
  readonly logSession: string | undefined;
  readonly logLines: number;
}

interface Observed {

  readonly receipts: Map<string, string[]>;

  readonly log: Map<string, string[]>;
  readonly sessionLog: Map<string, string[]>;
}

const fileFailure = (operation: string) => (cause: unknown) => new AcceptFailure({ operation, problem: describeCause(cause) });

export const privateDirectory = (path: string) => Effect.try({
  try: () => {
    mkdirSync(path, { recursive: true, mode: 0o700 });
    chmodSync(path, 0o700);
    return path;
  },
  catch: fileFailure(`create evidence directory ${path}`),
});

const save = (path: string, contents: string | Uint8Array) => Effect.try({ try: () => writeFileSync(path, contents, { mode: 0o600 }), catch: fileFailure(`write ${path}`) });

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

export const receiptLines = (text: string) => preloadLines(text) ?? text.split(/\r?\n/).filter((line) => line.trim() !== "");

const fileName = (value: string) => value.replace(/[^A-Za-z0-9._-]+/g, "_");

const countHolds = (count: number, { min, max }: Count) => count >= (min ?? (max === undefined ? 1 : 0)) && (max === undefined || count <= max);

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

    const newReceipts = (client: string, since: Mark) => Effect.map(driver.receipts(client), (files) =>
      files.filter(({ name, modified }) => modified > (since.receipts.get(name) ?? -Infinity)).flatMap(({ text }) => receiptLines(text)));
    const newLog = (client: string, since: Mark) => Effect.map(driver.log(client), (log) => {
      const lines = logLines(log).map(({ text }) => text);

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
          yield* pollUntil(newReceipts(client, markOf(client)), {
            until: (lines) => lines.some((line) => pattern.test(line)), every: RECEIPT_POLL, within: Duration.seconds(seconds),
            onTimeout: () => Effect.fail(new AcceptFailure({ operation: describeStep(step, host), problem: `no matching receipt within ${seconds} s` })),
          });
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

const sessionWeight = (session: PlannedSession) => 4 + session.checks.length;

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

export function mergeReports(directory: string, checks: readonly NativeCheck[], reports: readonly AcceptReport[], started: number, finished: number, missing: (check: NativeCheck) => CheckResult): AcceptReport {
  const byId = new Map(reports.flatMap(({ results }) => results.map((result) => [result.id, result] as const)));
  return { directory, started, finished, results: checks.map((check) => byId.get(check.id) ?? missing(check)) };
}
