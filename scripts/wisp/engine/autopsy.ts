// The automatic desync autopsy (wisp:docs/autopsy.md). A native session
// runner wraps its work in `withAutopsy`: it follows every declared client's
// presence table with the read-only poller (wisp:scripts/wisp/engine/poll.ts)
// when the machine allows reading it, watches each client's Errors folder,
// and when the game writes a desync report it compares the clients'
// Desync.logs and poll logs and prints the first divergent birth:
//   first divergent birth #6279 CScriptFunc at turn 921 on client a
// with every input copied into one evidence folder. For development on your
// own maps and clients only; it never writes to a game.
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { Effect, Fiber } from "effect";
import type { Client } from "../clients";
import { describeCause } from "../command";
import { type DesyncDump, compareDumps, findDesyncLog, formatDesyncComparison, ipseStates, pairDumps, parseDesyncLog } from "./desyncLog";
import { type EngineClient, attachClient } from "./attach";
import { PTRACE_SCOPE, findGameProcesses, prefixOfDocuments } from "./memory";
import { type LoggedEvent, diffPresenceLogs, parsePresenceLog } from "./presenceLog";

/** What the two clients' Desync.logs say diverged first. */
export type Divergence =
  /** One client had made `birth` (and `ahead - behind` births in all) by the checksum of `turn`; the other hadn't yet. */
  | { readonly kind: "birth"; readonly birth: number; readonly turn: number; readonly client: string; readonly other: string; readonly births: readonly [number, number] }
  /** Same births, different free-list heads: an agent freed on a different turn. */
  | { readonly kind: "free"; readonly turn: number; readonly heads: readonly [number, number] }
  /** A section other than Tempest's presence table differs first. */
  | { readonly kind: "section"; readonly turn: number; readonly sections: readonly string[] }
  | { readonly kind: "none"; readonly turn: number };

/** The first divergence between two clients' dumps of the same desync. */
export function firstDivergence(names: readonly [string, string], a: DesyncDump, b: DesyncDump): Divergence {
  const differences = compareDumps(a, b);
  const first = differences[0];
  if (first === undefined) return { kind: "none", turn: a.turn };
  const sections = [...new Set(differences.filter(({ turn }) => turn === first.turn).map(({ section }) => section))];
  if (!sections.includes("ipse")) return { kind: "section", turn: first.turn, sections };
  const stateA = ipseStates(a).find(({ turn }) => turn === first.turn);
  const stateB = ipseStates(b).find(({ turn }) => turn === first.turn);
  const birthsA = stateA?.birthTag;
  const birthsB = stateB?.birthTag;
  if (birthsA === undefined || birthsB === undefined) return { kind: "section", turn: first.turn, sections };
  if (birthsA === birthsB) return { kind: "free", turn: first.turn, heads: [stateA?.presenceTag ?? -1, stateB?.presenceTag ?? -1] };
  // The birth counter is the next birth to give: the client behind hasn't made birth `behind` yet; the one ahead has.
  const aAhead = birthsA > birthsB;
  return {
    kind: "birth",
    birth: Math.min(birthsA, birthsB),
    turn: first.turn,
    client: aAhead ? names[0] : names[1],
    other: aAhead ? names[1] : names[0],
    births: [birthsA, birthsB],
  };
}

/** The poll log's start, from its first note: `...; seconds since ISO`. */
export function pollStart(text: string): number | undefined {
  const match = /seconds since (\S+)/.exec(text.split("\n", 1)[0] ?? "");
  const time = match === null ? Number.NaN : Date.parse(match[1] ?? "");
  return Number.isFinite(time) ? time : undefined;
}

/**
 * The agent born as `birth` in this poll log, up to `before` (ms since the
 * epoch, the desync report's time). Birth numbers start again with each
 * game, so a log spanning games holds the same number more than once; the
 * last one before the desync is this game's.
 */
export function bornAs(text: string, birth: number, before?: number): LoggedEvent | undefined {
  const start = pollStart(text);
  const limit = start === undefined || before === undefined ? Number.POSITIVE_INFINITY : (before - start) / 1000;
  return parsePresenceLog(text).filter((event) => event.kind === "born" && event.birth === birth && event.seconds <= limit).at(-1);
}

/** The class a finding names: the handle object that owns the agent when the poller found one, else the agent's own. */
export const classOf = (event: LoggedEvent) => event.owner ?? event.className;

export interface Finding {
  readonly divergence: Divergence;
  /** The agent the poller saw born as the divergent birth on the client ahead. */
  readonly born: LoggedEvent | undefined;
  /** Its Lua/TypeScript stack, when a stack source recorded one. */
  readonly stack: string | undefined;
}

/** The one line a session prints for a desync. */
export function findingLine({ divergence, born }: Finding): string {
  switch (divergence.kind) {
    case "birth": {
      const what = born === undefined ? "(class unknown: no poll log of that birth)" : classOf(born);
      return `first divergent birth #${divergence.birth} ${what} at turn ${divergence.turn} on client ${divergence.client}`;
    }
    case "free":
      return `first divergence at turn ${divergence.turn}: same births, presence free head ${divergence.heads[0]} vs ${divergence.heads[1]} (an agent freed on a different turn)`;
    case "section":
      return `first divergence at turn ${divergence.turn} in section${divergence.sections.length > 1 ? "s" : ""} ${divergence.sections.join(", ")}, not Tempest's presence table`;
    case "none":
      return `the Desync.logs match on every dumped turn (desync turn ${divergence.turn})`;
  }
}

/** One client's desync report: the Errors subfolder the game wrote for it. */
export interface DesyncReport {
  readonly client: string;
  readonly folder: string;
  /** When the game wrote it, ms since the epoch. */
  readonly written: number;
}

/** A source of Lua/TypeScript stacks for a birth, such as the engine's stack recorder (wisp:docs/engine.md). */
export type StackSource = (client: string, birth: number, pollDirectory: string | undefined) => string | undefined;

export interface AutopsyInput {
  /** The clients' reports of one desync, in the order to compare (the first two are compared). */
  readonly reports: readonly DesyncReport[];
  /** The session's poll logs, `<client>.log`, when the poller ran. */
  readonly pollDirectory: string | undefined;
  /** Where this desync's evidence folder goes. */
  readonly out: string;
  readonly stack?: StackSource | undefined;
}

export interface Autopsy {
  readonly finding: Finding | undefined;
  /** The summary: the finding line, its stack and the evidence folder. */
  readonly lines: readonly string[];
  readonly evidence: string;
}

const REPORT_FILES = /^(Desync\.txt|War3Log\.txt|.*_Desync\.log)$/;

/**
 * Compares two clients' reports of one desync and their poll logs, and
 * saves every input and the full reports into `input.out`.
 */
export function runAutopsy(input: AutopsyInput): Autopsy {
  const [first, second] = input.reports;
  const evidence = input.out;
  mkdirSync(evidence, { recursive: true });
  for (const report of input.reports) {
    const target = join(evidence, report.client);
    mkdirSync(target, { recursive: true });
    for (const name of readdirSync(report.folder).filter((file) => REPORT_FILES.test(file))) copyFileSync(join(report.folder, name), join(target, name));
  }
  const pollLog = (client: string) => input.pollDirectory === undefined ? undefined : join(input.pollDirectory, `${client}.log`);
  for (const report of input.reports) {
    const log = pollLog(report.client);
    if (log !== undefined && existsSync(log)) copyFileSync(log, join(evidence, report.client, "presence.log"));
  }
  const done = (finding: Finding | undefined, lines: string[], full: string[]): Autopsy => {
    writeFileSync(join(evidence, "autopsy.txt"), `${[...lines, "", ...full].join("\n")}\n`);
    return { finding, lines: [...lines, `evidence: ${evidence}`], evidence };
  };
  if (first === undefined || second === undefined) {
    return done(undefined, [`only client ${first?.client ?? "?"} wrote a desync report; nothing to compare it with`], []);
  }
  const logA = findDesyncLog(first.folder);
  const logB = findDesyncLog(second.folder);
  if (logA === undefined || logB === undefined) {
    return done(undefined, [`no *_Desync.log in ${logA === undefined ? first.folder : second.folder}; only Desync.txt to go on (wisp:docs/hot-reload.md#desync-reports)`], []);
  }
  const logs = [logA, logB] as const;
  const dumpsA = parseDesyncLog(readFileSync(logA, "latin1"));
  const dumpsB = parseDesyncLog(readFileSync(logB, "latin1"));
  if (typeof dumpsA === "string") return done(undefined, [`unreadable Desync.log ${logA}: ${dumpsA}`], []);
  if (typeof dumpsB === "string") return done(undefined, [`unreadable Desync.log ${logB}: ${dumpsB}`], []);
  const pair = pairDumps(dumpsA, dumpsB);
  if (typeof pair === "string") return done(undefined, [`Desync.logs: ${pair}`], []);
  const names = [first.client, second.client] as const;
  const divergence = firstDivergence(names, pair.a, pair.b);
  const full = [formatDesyncComparison([logs[0], logs[1]], pair, [dumpsA.length, dumpsB.length])];
  let born: LoggedEvent | undefined;
  let stack: string | undefined;
  const texts = names.map((name) => {
    const log = pollLog(name);
    return log !== undefined && existsSync(log) ? readFileSync(log, "utf8") : undefined;
  });
  if (texts[0] !== undefined && texts[1] !== undefined) {
    full.push("", diffPresenceLogs([`${names[0]}.log`, `${names[1]}.log`], parsePresenceLog(texts[0]), parsePresenceLog(texts[1]), { skew: 0.1, limit: 12 }));
  }
  if (divergence.kind === "birth") {
    const ahead = divergence.client === names[0] ? 0 : 1;
    const text = texts[ahead];
    const report = input.reports[ahead];
    born = text === undefined ? undefined : bornAs(text, divergence.birth, report?.written);
    stack = input.stack?.(divergence.client, divergence.birth, input.pollDirectory);
  }
  const finding: Finding = { divergence, born, stack };
  const lines = [findingLine(finding)];
  if (divergence.kind === "birth") {
    lines.push(stack === undefined ? "  stack: none recorded" : `  stack: ${stack}`);
    if (texts[0] === undefined || texts[1] === undefined) lines.push("  no presence poll this session, so the class is unknown (wisp:docs/autopsy.md#the-presence-poller)");
  }
  return done(finding, lines, full);
}

/** Desync reports that appear in clients' Errors folders after a starting point. */
export class DesyncReports {
  private readonly seen: Map<string, Set<string>>;

  constructor(private readonly clients: readonly Pick<Client, "name" | "documents">[]) {
    this.seen = new Map(clients.map((client) => [client.name, new Set(this.folders(client))]));
  }

  private folders(client: Pick<Client, "documents">): string[] {
    const errors = join(client.documents, "Errors");
    try {
      return readdirSync(errors).sort();
    } catch {
      return [];
    }
  }

  /**
   * Reports written since the start or the previous call, oldest first. A
   * folder counts once it holds a Desync.txt or *_Desync.log that hasn't
   * changed for `settleMs`; crash reports (no desync file) are skipped.
   */
  fresh(now = Date.now(), settleMs = 500): DesyncReport[] {
    const found: DesyncReport[] = [];
    for (const client of this.clients) {
      const seen = this.seen.get(client.name) ?? new Set<string>();
      for (const name of this.folders(client)) {
        if (seen.has(name)) continue;
        const folder = join(client.documents, "Errors", name);
        let files: string[];
        try {
          files = readdirSync(folder);
        } catch {
          continue;
        }
        const desync = files.filter((file) => file === "Desync.txt" || file.endsWith("_Desync.log"));
        if (desync.length === 0) {
          if (files.includes("Crash.txt")) seen.add(name);
          continue;
        }
        const written = Math.max(...desync.map((file) => statSync(join(folder, file)).mtimeMs));
        // Wait for the game to finish writing; a log without its Desync.txt yet may still grow.
        if (now - written < settleMs || !files.some((file) => file.endsWith("_Desync.log"))) {
          if (now - written < 5_000) continue;
        }
        seen.add(name);
        found.push({ client: client.name, folder, written });
      }
    }
    return found.sort((x, y) => x.written - y.written);
  }
}

/** Groups reports of the same desync: each client's first report within `windowMs` of the earliest. */
export function groupReports(reports: readonly DesyncReport[], windowMs = 10_000): DesyncReport[][] {
  const groups: DesyncReport[][] = [];
  for (const report of [...reports].sort((x, y) => x.written - y.written)) {
    const group = groups.find((candidate) => report.written - (candidate[0]?.written ?? 0) <= windowMs && !candidate.some(({ client }) => client === report.client));
    if (group === undefined) groups.push([report]);
    else group.push(report);
  }
  return groups;
}

/**
 * The clients the poller can read, and for the rest one line naming the
 * sysctl. At ptrace_scope 0 it reads every client; at 1 those `readable`
 * says this process can read.
 */
export function pollerAccess<C extends EngineClient>(scope: string | undefined, readable: (client: C) => boolean, clients: readonly C[]): { readonly readable: readonly C[]; readonly problem: string | undefined } {
  const value = scope?.trim();
  if (value === undefined || value === "0") return { readable: clients, problem: undefined };
  const blocked = clients.filter((client) => !readable(client));
  const problem = blocked.length === 0 ? undefined
    : `desync autopsy: no presence poller for client ${blocked.map(({ name }) => name).join(", ")}: kernel.yama.ptrace_scope=${value} lets only the process that launched a client read it (with the owner's agreement: sudo sysctl kernel.yama.ptrace_scope=0); Desync.log autopsy only`;
  return { readable: clients.filter((client) => readable(client)), problem };
}

const readScope = () => {
  try {
    return readFileSync(PTRACE_SCOPE, "utf8");
  } catch {
    return undefined;
  }
};

/**
 * At ptrace_scope 1: whether this process can read the client, tried with
 * the poller's own read-only attach (a client this process launched, or one
 * in a user namespace this user owns). A client not running yet counts, since
 * this session may launch it; the poller's attach decides then.
 */
const readableNow = (client: EngineClient) => {
  if (findGameProcesses(client.prefix)[0] === undefined) return true;
  const attached = attachClient(client);
  if (typeof attached !== "string") {
    attached.memory.close();
    return true;
  }
  return !attached.includes("can't read pid");
};

type DeclaredClient = Pick<Client, "name" | "documents">;

/** The clients file's clients (wisp:docs/sample-map.md): the only ones the autopsy reads. */
export async function declaredClients(path: string): Promise<readonly DeclaredClient[]> {
  const file: unknown = await Bun.file(path).json();
  const clients = typeof file === "object" && file !== null && "clients" in file && Array.isArray(file.clients) ? file.clients as unknown[] : [];
  return clients.flatMap((entry) => typeof entry === "object" && entry !== null && "name" in entry && "documents" in entry && typeof entry.name === "string" && typeof entry.documents === "string"
    ? [{ name: entry.name, documents: entry.documents }] : []);
}

/** What the autopsy is for, wherever it speaks: wisp:docs/autopsy.md#guardrails. */
export const DISCLAIMER = "For developing your own maps on your own clients only, not for cheating (wisp:docs/autopsy.md#guardrails).";

export interface AutopsyOptions {
  /** The project's clients file: the only clients the poller follows. */
  readonly clientsFile: string;
  /** Clients to follow; all of the file's when empty. */
  readonly names?: readonly string[];
  readonly print?: (line: string) => void;
  /** Where session folders go; $XDG_STATE_HOME/wisp/autopsy by default. */
  readonly root?: string;
  /** Milliseconds between polls; 2 by default. */
  readonly interval?: number;
  readonly stack?: StackSource;
  /** false: Desync.log autopsy only, no poller. */
  readonly poll?: boolean;
}

const stamp = () => new Date().toISOString().replace(/[:.]/g, "-");

export const autopsyRoot = () => join(process.env.XDG_STATE_HOME ?? join(homedir(), ".local/state"), "wisp/autopsy");

/** The poller in its own thread, so a session's timed work keeps its timing. */
function startPollThread(clients: readonly EngineClient[], out: string, interval: number) {
  const worker = new Worker(join(import.meta.dir, "pollWorker.ts"));
  worker.postMessage({ kind: "start", clients, out, interval });
  return {
    stop: () => new Promise<void>((resolve) => {
      const timeout = setTimeout(() => {
        worker.terminate();
        resolve();
      }, 2_000);
      worker.onmessage = () => {
        clearTimeout(timeout);
        worker.terminate();
        resolve();
      };
      worker.postMessage({ kind: "stop" });
    }),
  };
}

/**
 * Runs `run` with the desync autopsy around it: the presence poller on the
 * clients file's clients while the machine allows reading them (one line
 * naming the sysctl when it doesn't), a watch on their Errors folders, and an
 * autopsy of every desync the session sees, printed when found and again in
 * the session summary. A failure of the autopsy itself never fails `run`.
 */
export const withAutopsy = <A, E, R>(options: AutopsyOptions, run: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> => Effect.gen(function*() {
  const print = options.print ?? console.log;
  const all = yield* Effect.tryPromise(() => declaredClients(options.clientsFile)).pipe(Effect.orElseSucceed((): readonly DeclaredClient[] => []));
  const names = options.names ?? [];
  const clients = names.length === 0 ? all : all.filter((client) => names.includes(client.name));
  if (clients.length === 0) return yield* run;
  const session = join(options.root ?? autopsyRoot(), stamp());
  const reports = new DesyncReports(clients);
  const engineClients = clients.map(({ name, documents }) => ({ name, prefix: prefixOfDocuments(documents) }));
  let pollDirectory: string | undefined;
  let poller: { readonly stop: () => Promise<void> } | undefined;
  if (options.poll !== false) {
    const access = pollerAccess(readScope(), readableNow, engineClients);
    if (access.problem !== undefined) print(access.problem);
    if (access.readable.length > 0) {
      pollDirectory = join(session, "presence");
      poller = startPollThread(access.readable, pollDirectory, options.interval ?? 2);
      print(`desync autopsy: reading client ${access.readable.map(({ name }) => name).join(", ")}'s presence tables, read-only, into ${pollDirectory}. ${DISCLAIMER}`);
    }
  }
  const findings: string[] = [];
  let pending: DesyncReport[] = [];
  const examine = (final: boolean) => Effect.sync(() => {
    try {
      pending.push(...reports.fresh());
      const groups = groupReports(pending);
      pending = [];
      for (const group of groups) {
        const newest = Math.max(...group.map(({ written }) => written));
        // The other clients write theirs within milliseconds; wait a little for a lone one.
        if (!final && group.length < clients.length && Date.now() - newest < 3_000) {
          pending.push(...group);
          continue;
        }
        const ordered = clients.flatMap((client) => group.filter((report) => report.client === client.name));
        const result = runAutopsy({ reports: ordered, pollDirectory, out: join(session, `desync-${findings.length + 1}`), stack: options.stack });
        for (const line of result.lines) print(`desync autopsy: ${line}`);
        findings.push(...result.lines);
      }
    } catch (cause) {
      print(`desync autopsy failed: ${describeCause(cause)}`);
    }
  });
  const watcher = yield* Effect.forkDetach(Effect.forever(examine(false).pipe(Effect.andThen(Effect.sleep("500 millis")))));
  const finish = Effect.gen(function*() {
    yield* Fiber.interrupt(watcher);
    // A desync at the very end: give its reports a moment to land.
    yield* Effect.sleep("1 second");
    yield* examine(true);
    if (poller !== undefined) yield* Effect.promise(poller.stop);
    if (findings.length > 0) {
      print("desync autopsy summary:");
      for (const line of findings) print(`  ${line}`);
    }
  });
  return yield* run.pipe(Effect.ensuring(finish));
});

