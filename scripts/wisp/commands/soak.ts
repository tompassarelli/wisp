// `wisp soak`: plays a game's soak (wisp:docs/soak.md) in worker processes,
// at most four, for at most a set number of minutes, prints each finding with
// its repro file and what the run cost, and fails when anything was found.
// `--repro FILE` plays one repro file again in this process.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { availableParallelism } from "node:os";
import { join } from "node:path";
import type { Subprocess } from "bun";
import { Console, Effect, Schema } from "effect";
import { type Command, UsageFailure, describeCause, flagValues } from "../command";
import { installHeadless } from "../headless";
import { writtenPreloadFile } from "../headlessInput";
import {
  SOAK_LIMITS, type SoakMatch, type SoakProject, type SoakReply, describeMatch, loadSoakGame, loadSoakProject, planSoak, playSoakMatch, readSoakReply,
  readSoakRepro, soakRepro,
} from "../soak";
import { step } from "../timings";

export class SoakFailure extends Schema.TaggedError<SoakFailure>()("SoakFailure", {
  problem: Schema.String,
  cause: Schema.optional(Schema.Unknown),
}) {
  override get message(): string {
    return this.cause === undefined ? this.problem : `${this.problem}: ${describeCause(this.cause)}`;
  }
}

/** Worker processes at most: a soak shares the machine with everything else running. */
export const MAX_SOAK_WORKERS = 4;
/** The longest a run may be told to take; it starts no match after its limit. */
export const MAX_SOAK_MINUTES = 30;
export const DEFAULT_SOAK_MINUTES = 10;
export const MAX_SOAK_MATCHES = 2000;

export interface SoakCommandOptions {
  /** The game's soak module, whose default export defineSoak() made. */
  readonly project: string;
  /** Where each run keeps its repro files, in a folder of its own. */
  readonly out: string;
}

interface RunOptions {
  readonly matches: number;
  readonly seed: number;
  readonly workers: number;
  readonly minutes: number;
  readonly fighters: readonly string[];
  readonly stages: readonly string[];
  readonly policies: readonly string[];
  readonly out: string | undefined;
}

const VALUED = ["matches", "seed", "workers", "minutes", "fighter", "stage", "policy", "out", "repro"];

/** CPUs this process's cgroup allows (cgroup v2 cpu.max, the tightest along its path), or every CPU. */
function scopeCpus(): number {
  let cpus = availableParallelism();
  try {
    const path = /^0::(.*)$/m.exec(readFileSync("/proc/self/cgroup", "utf8"))?.[1];
    for (let group = path; group !== undefined && group !== ""; group = group.slice(0, Math.max(0, group.lastIndexOf("/")))) {
      const [quota = "max", period = "100000"] = readFileSync(join("/sys/fs/cgroup", group, "cpu.max"), "utf8").trim().split(" ");
      if (quota !== "max") cpus = Math.min(cpus, Number(quota) / Number(period));
    }
  } catch {
    // No cgroup v2 limit to read: every CPU.
  }
  return Math.max(1, Math.floor(cpus));
}

function parseRun(args: readonly string[], project: SoakProject): RunOptions | string {
  for (let index = 0; index < args.length; index++) {
    const arg = args[index] ?? "";
    if (!arg.startsWith("--") || !VALUED.includes(arg.slice(2))) return `unknown argument ${arg}`;
    if (args[index + 1] === undefined) return `${arg} takes a value`;
    index++;
  }
  const whole = (name: string, fallback: number, low: number, high: number): number | string => {
    const [text] = flagValues(args, name);
    const value = text === undefined ? fallback : Number(text);
    return Number.isInteger(value) && value >= low && value <= high ? value : `--${name} takes a whole number from ${low} to ${high}`;
  };
  const matches = whole("matches", project.matches, 1, MAX_SOAK_MATCHES);
  const seed = whole("seed", 1, 1, 2147483646);
  const minutes = whole("minutes", DEFAULT_SOAK_MINUTES, 1, MAX_SOAK_MINUTES);
  const workers = whole("workers", Math.min(MAX_SOAK_WORKERS, scopeCpus()), 1, MAX_SOAK_WORKERS);
  for (const value of [matches, seed, minutes, workers]) if (typeof value === "string") return value;
  const named = (flag: string, known: readonly string[]) => flagValues(args, flag).find((name) => !known.includes(name));
  const fighters = flagValues(args, "fighter");
  const stages = flagValues(args, "stage");
  const policies = flagValues(args, "policy");
  const strange = named("fighter", project.roster.fighters) ?? named("stage", project.roster.stages) ?? named("policy", [...new Set(project.roster.policies.flat())]);
  if (strange !== undefined) return `${project.name} has no fighter, stage or policy named ${strange}`;
  const [out] = flagValues(args, "out");
  return { matches: Number(matches), seed: Number(seed), minutes: Number(minutes), workers: Number(workers), fighters, stages, policies, out };
}

type Worker = Subprocess<"pipe", "pipe", "pipe">;

/** Reads a stream line by line; undefined once it ends. */
function lineReader(stream: ReadableStream<Uint8Array>): () => Promise<string | undefined> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  return async () => {
    for (;;) {
      const end = buffer.indexOf("\n");
      if (end >= 0) {
        const line = buffer.slice(0, end);
        buffer = buffer.slice(end + 1);
        return line;
      }
      const { done, value } = await reader.read();
      if (done) return undefined;
      buffer += decoder.decode(value, { stream: true });
    }
  };
}

/** The last few kilobytes a stream wrote, read as it goes so the writer never blocks. */
function tail(stream: ReadableStream<Uint8Array>): () => string {
  let text = "";
  void (async () => {
    const decoder = new TextDecoder();
    for await (const chunk of stream) text = (text + decoder.decode(chunk, { stream: true })).slice(-4096);
  })();
  return () => text;
}

interface Pool {
  readonly replies: SoakReply[];
  /** CPU milliseconds the workers used, counted as each one exits. */
  cpuMs: number;
  workersStarted: number;
}

/**
 * One worker process: it plays matches from `next` until none is left or it
 * stops; a match it stopped in comes back as a crash. Its scope kills it.
 */
const runWorker = (worker: string, project: string, next: () => SoakMatch | undefined, pool: Pool, report: (reply: SoakReply) => Effect.Effect<void>) =>
  Effect.acquireUseRelease(
    Effect.sync((): Worker => {
      pool.workersStarted++;
      return Bun.spawn([process.execPath, worker, project], { stdin: "pipe", stdout: "pipe", stderr: "pipe" });
    }),
    (child) => Effect.gen(function*() {
      const read = lineReader(child.stdout);
      const stderr = tail(child.stderr);
      for (let match = next(); match !== undefined; match = next()) {
        const sent = match;
        child.stdin.write(`${JSON.stringify(sent)}\n`);
        yield* Effect.promise(async () => child.stdin.flush());
        const line = yield* Effect.promise(read);
        const reply: SoakReply = line === undefined
          ? {
            match: sent, frames: 0, wallMs: 0, costMs: 0, worstFrameMs: 0, typingStallsMs: [], over: false, checksums: [],
            findings: [{ kind: "crash", frame: 0, text: `the worker process stopped${child.exitCode === null ? "" : ` with exit code ${child.exitCode}`}: ${stderr().trim().split("\n").slice(-8).join("\n    ")}` }],
          }
          : yield* Effect.try({ try: () => readSoakReply(line), catch: (cause) => new SoakFailure({ problem: `a worker's answer for ${describeMatch(sent)}`, cause }) });
        pool.replies.push(reply);
        yield* report(reply);
        if (line === undefined) return;
      }
      yield* Effect.promise(async () => {
        await child.stdin.end();
        await child.exited;
      });
    }),
    (child) => Effect.promise(async () => {
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
      await child.exited;
      const usage = child.resourceUsage();
      // Bun reports these microseconds as bigints, whatever its types say.
      if (usage !== undefined) pool.cpuMs += (Number(usage.cpuTime.user) + Number(usage.cpuTime.system)) / 1000;
    }),
  );

const plural = (count: number, noun: string, nouns = `${noun}s`) => `${count.toLocaleString("en-US")} ${count === 1 ? noun : nouns}`;

/**
 * Recovery typing stalls, client frames that stopped longer than 1/60 s
 * taking typed text: how many, the worst and the 95th percentile, against the
 * budget a frame may stop for (limits.typingMs).
 */
export function typingStallsLine(stalls: readonly number[], budgetMs: number): string {
  if (stalls.length === 0) return `recovery typing stalls: none (budget ${budgetMs.toFixed(1)} ms)`;
  const sorted = [...stalls].sort((a, b) => a - b);
  const p95 = sorted[Math.max(0, Math.ceil(0.95 * sorted.length) - 1)] ?? 0;
  const over = sorted.filter((ms) => ms > budgetMs).length;
  return `recovery typing stalls: ${plural(sorted.length, "client frame")} over 1/60 s, worst ${(sorted.at(-1) ?? 0).toFixed(1)} ms, p95 ${p95.toFixed(1)} ms; budget ${budgetMs.toFixed(1)} ms, ${over === 0 ? "none" : over} over it`;
}

/** A finding's lines: the match, the finding and where its repro file is. */
const findingLines = (reply: SoakReply, repro: string | undefined) => [
  describeMatch(reply.match),
  ...reply.findings.map(({ kind, frame, slot, text }) => `  ${kind} after frame ${frame}${slot === undefined ? "" : ` (p${slot})`}: ${text}`),
  ...(repro === undefined ? [] : [`  repro: ${repro}`]),
];

const loadProject = (path: string) =>
  Effect.tryPromise({ try: () => loadSoakProject(path), catch: (cause) => new SoakFailure({ problem: "loading the soak", cause }) });

/** Plays a repro file's match again, in this process, and prints what it finds. */
const replay = (options: SoakCommandOptions, file: string) => Effect.gen(function*() {
  const project = yield* loadProject(options.project);
  const repro = yield* Effect.try({ try: () => readSoakRepro(readFileSync(file, "utf8")), catch: (cause) => new SoakFailure({ problem: `reading ${file}`, cause }) });
  if (repro.project !== project.name) return yield* new SoakFailure({ problem: `${file} is a repro of ${repro.project}'s soak, not ${project.name}'s` });
  const game = yield* Effect.tryPromise({
    try: () => loadSoakGame(project.game),
    catch: (cause) => new SoakFailure({ problem: "loading the soak's match setup and map", cause }),
  }).pipe(step("load map"));
  const result = yield* Effect.sync(() => {
    const runtime = installHeadless(project.map);
    try {
      return playSoakMatch(runtime, game, project, repro.match, repro.inputs);
    } finally {
      runtime.restore();
    }
  }).pipe(step(describeMatch(repro.match)));
  const same = result.checksums.join(" ") === repro.checksums.join(" ");
  yield* Console.log([
    ...findingLines(result, undefined),
    result.findings.length === 0 ? "  no findings" : "",
    `  ${result.frames} frames; native call checksums ${same ? "equal the recorded ones" : `${result.checksums.join(" ")}, recorded ${repro.checksums.join(" ")}`}`,
    `  ${typingStallsLine(result.typingStallsMs, { ...SOAK_LIMITS, ...project.limits }.typingMs)}`,
  ].filter((line) => line !== "").join("\n"));
  if (result.findings.length > 0) return yield* new SoakFailure({ problem: `${plural(result.findings.length, "finding")} replaying ${file}` });
});

/** `soak [--matches N] [--seed N] [--workers N] [--minutes N] [--fighter NAME]... [--stage NAME]... [--policy NAME]... [--out DIR] | --repro FILE`. */
export const makeSoak = (options: SoakCommandOptions): Command => (args) => Effect.gen(function*() {
  const [repro] = flagValues(args, "repro");
  if (repro !== undefined) {
    if (args.length !== 2) return yield* new UsageFailure({ problem: "--repro takes one file and nothing else" });
    return yield* replay(options, repro);
  }
  const project = yield* loadProject(options.project);
  const run = parseRun(args, project);
  if (typeof run === "string") return yield* new UsageFailure({ problem: run });
  const keep = (match: SoakMatch) =>
    run.fighters.every((fighter) => match.fighters.includes(fighter))
    && (run.stages.length === 0 || run.stages.includes(match.stage))
    && run.policies.every((policy) => match.policies.includes(policy));
  const plan = yield* Effect.try({ try: () => planSoak(project.roster, run.matches, run.seed, project.frames, keep), catch: (cause) => new UsageFailure({ problem: describeCause(cause) }) });
  const out = run.out ?? join(options.out, new Date().toISOString().replaceAll(":", "-").replace(/\.\d+Z$/, ""));
  yield* Effect.try({ try: () => mkdirSync(out, { recursive: true }), catch: (cause) => new SoakFailure({ problem: `creating ${out}`, cause }) });
  const workers = Math.min(run.workers, plan.length);
  yield* Console.log(`${project.name} soak: ${plural(plan.length, "match", "matches")} in ${plural(workers, "worker")}, at most ${run.minutes} min, seed ${run.seed}; repro files in ${out}`);
  const deadline = performance.now() + run.minutes * 60_000;
  const queue = [...plan];
  const next = () => (performance.now() < deadline ? queue.shift() : undefined);
  const pool: Pool = { replies: [], cpuMs: 0, workersStarted: 0 };
  const started = performance.now();
  const cpuBefore = process.cpuUsage();
  const worker = join(import.meta.dir, "../soakWorker.ts");
  const report = (reply: SoakReply) => Effect.gen(function*() {
    if (reply.findings.length === 0) return;
    const path = join(out, `match-${reply.match.index}.json`);
    const written = reply.inputs === undefined ? undefined : path;
    if (reply.inputs !== undefined) {
      const repro = soakRepro(project.name, { ...reply, inputs: reply.inputs });
      yield* Effect.try({ try: () => writeFileSync(path, `${JSON.stringify(repro)}\n`), catch: (cause) => new SoakFailure({ problem: `writing ${path}`, cause }) }).pipe(Effect.orDie);
    }
    const moments = (reply.repros ?? []).map(([slot, lines]) => [join(out, `match-${reply.match.index}-p${slot}.txt`), lines] as const);
    for (const [file, lines] of moments) {
      yield* Effect.try({ try: () => writeFileSync(file, writtenPreloadFile(lines)), catch: (cause) => new SoakFailure({ problem: `writing ${file}`, cause }) }).pipe(Effect.orDie);
    }
    yield* Console.log([...findingLines(reply, written), ...moments.map(([file]) => `  moment: ${file} (wisp repro)`)].join("\n"));
  });
  // A worker that stopped gives its place to a new one while matches are left.
  const slot = Effect.gen(function*() {
    while (queue.length > 0 && performance.now() < deadline) yield* runWorker(worker, options.project, next, pool, report);
  });
  yield* Effect.all(Array.from({ length: workers }, () => slot), { concurrency: "unbounded", discard: true }).pipe(step(`${plural(plan.length, "match", "matches")}`));
  const wallSeconds = (performance.now() - started) / 1000;
  const own = process.cpuUsage(cpuBefore);
  const cpuSeconds = (pool.cpuMs + (own.user + own.system) / 1000) / 1000;
  const replies = pool.replies;
  const frames = replies.reduce((sum, { frames }) => sum + frames, 0);
  const gameSeconds = replies.reduce((sum, { wallMs }) => sum + wallMs, 0) / 1000;
  const found = replies.filter(({ findings }) => findings.length > 0);
  const findings = found.reduce((sum, { findings }) => sum + findings.length, 0);
  const kinds = [...new Set(found.flatMap(({ findings }) => findings.map(({ kind }) => kind)))];
  const slowest = Math.max(0, ...replies.map(({ worstFrameMs }) => worstFrameMs));
  yield* Console.log([
    `${plural(replies.length, "match", "matches")}, ${plural(frames, "frame")} (${(gameSeconds / 60).toFixed(1)} game minutes) in ${wallSeconds.toFixed(1)} s with ${plural(workers, "worker")}`
      + ` (${pool.workersStarted} started): ${(gameSeconds / Math.max(wallSeconds, 0.001)).toFixed(0)}x real time, ${cpuSeconds.toFixed(1)} s CPU`,
    typingStallsLine(replies.flatMap(({ typingStallsMs }) => typingStallsMs), { ...SOAK_LIMITS, ...project.limits }.typingMs),
    `costliest client frame ${slowest.toFixed(1)} ms; ${found.length === 0 ? "no findings" : `${plural(findings, "finding")} (${kinds.join(", ")}) in ${plural(found.length, "match", "matches")}, repro files in ${out}`}`,
  ].join("\n"));
  if (replies.length < plan.length) return yield* new SoakFailure({ problem: `stopped at the ${run.minutes}-minute limit: ${replies.length} of ${plan.length} matches played` });
  if (found.length > 0) return yield* new SoakFailure({ problem: `${plural(findings, "finding")} in ${plural(found.length, "match", "matches")}` });
});
