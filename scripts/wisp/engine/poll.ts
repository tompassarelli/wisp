// The presence-table poller behind `wisp engine poll`, usable from any
// session runner: it follows each named client's table read-only, appends
// born and freed agents to OUT/<client>.log (wisp:scripts/wisp/engine/presenceLog.ts),
// reattaches when a client restarts, and stops on request.
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Effect } from "effect";
import { type AttachedClient, type EngineClient, attachClient } from "./attach";
import { offsetsFor } from "./offsets";
import { PresenceTracker } from "./presence";
import { eventLine } from "./presenceLog";

export interface PollOptions {
  readonly out: string;
  /** Milliseconds between polls of each client; 2 by default. */
  readonly interval?: number;
  /** Lines that aren't events: attach, detach, a build without offsets. */
  readonly onNote?: (client: string, text: string) => void;
}

export interface PollSummary {
  readonly client: string;
  readonly log: string;
  readonly births: number;
  readonly frees: number;
}

export interface PresencePoll {
  /** Each client's log, by client name. */
  readonly logs: ReadonlyMap<string, string>;
  /** Stops polling and closes the clients; resolves with each client's counts. */
  readonly stop: () => Promise<readonly PollSummary[]>;
}

interface Followed {
  readonly client: EngineClient;
  readonly log: string;
  attached: AttachedClient | undefined;
  tracker: PresenceTracker | undefined;
  retryAt: number;
  births: number;
  frees: number;
  lastProblem: string | undefined;
}

/**
 * Starts polling `clients`. Each log starts with a note line and has one
 * event line per born or freed agent, with seconds since this call, shared
 * by every client so their logs line up in time.
 */
export function startPresencePoll(clients: readonly EngineClient[], options: PollOptions): PresencePoll {
  const interval = options.interval ?? 2;
  mkdirSync(options.out, { recursive: true });
  const start = performance.now();
  const elapsed = () => (performance.now() - start) / 1000;
  const followed: Followed[] = clients.map((client) => ({ client, log: join(options.out, `${client.name}.log`), attached: undefined, tracker: undefined, retryAt: 0, births: 0, frees: 0, lastProblem: undefined }));
  const note = (entry: Followed, text: string) => {
    appendFileSync(entry.log, `# ${elapsed().toFixed(3)} ${text}\n`);
    options.onNote?.(entry.client.name, text);
  };
  for (const entry of followed) writeFileSync(entry.log, `# wisp engine poll: client ${entry.client.name}, presence table births and frees; seconds since ${new Date().toISOString()}\n`);

  const tryAttach = (entry: Followed) => {
    entry.retryAt = elapsed() + 2;
    const attached = attachClient(entry.client);
    if (typeof attached === "string") {
      if (attached !== entry.lastProblem) note(entry, attached);
      entry.lastProblem = attached;
      return;
    }
    entry.lastProblem = undefined;
    const offsets = offsetsFor(attached.exe.version);
    if (typeof offsets === "string") {
      attached.memory.close();
      // Retrying won't find offsets that aren't in the file.
      entry.retryAt = Number.POSITIVE_INFINITY;
      note(entry, offsets);
      return;
    }
    try {
      const tracker = new PresenceTracker(attached.memory, attached.base, offsets);
      tracker.poll();
      const header = tracker.current();
      entry.attached = attached;
      entry.tracker = tracker;
      const classes = new Map<string, number>();
      for (const agent of tracker.live().values()) classes.set(agent.className, (classes.get(agent.className) ?? 0) + 1);
      note(entry, `attach pid ${attached.pid} build ${attached.exe.version} base 0x${attached.base.toString(16)}; entries ${header?.count} free head ${header?.freeHead} births ${header?.births}; live ${[...classes].sort((x, y) => y[1] - x[1]).map(([name, count]) => `${name}:${count}`).join(" ")}`);
    } catch (cause) {
      // The game makes its table some time after the process starts.
      attached.memory.close();
      note(entry, `pid ${attached.pid} has no presence table yet (${cause instanceof Error ? cause.message : String(cause)})`);
    }
  };

  const tick = () => {
    for (const entry of followed) {
      if (entry.tracker === undefined) {
        if (elapsed() >= entry.retryAt) tryAttach(entry);
        continue;
      }
      try {
        const lines: string[] = [];
        for (const event of entry.tracker.poll()) {
          if (event.kind === "born") entry.births++;
          else entry.frees++;
          lines.push(eventLine(elapsed(), event));
        }
        if (lines.length > 0) appendFileSync(entry.log, `${lines.join("\n")}\n`);
      } catch (cause) {
        entry.attached?.memory.close();
        entry.attached = undefined;
        entry.tracker = undefined;
        note(entry, `detach: ${cause instanceof Error ? cause.message : String(cause)}`);
      }
    }
  };

  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const loop = () => {
    if (stopped) return;
    tick();
    timer = setTimeout(loop, interval);
  };
  loop();
  return {
    logs: new Map(followed.map(({ client, log }) => [client.name, log])),
    stop: async () => {
      stopped = true;
      if (timer !== undefined) clearTimeout(timer);
      for (const entry of followed) {
        entry.attached?.memory.close();
        entry.attached = undefined;
        entry.tracker = undefined;
      }
      return followed.map(({ client, log, births, frees }) => ({ client: client.name, log, births, frees }));
    },
  };
}

/** startPresencePoll as an Effect: polls for `seconds`, or until interrupted, then stops and returns each client's counts. */
export const pollPresence = (clients: readonly EngineClient[], options: PollOptions & { readonly seconds?: number }) => Effect.acquireUseRelease(
  Effect.sync(() => startPresencePoll(clients, options)),
  (running) => options.seconds === undefined ? Effect.never : Effect.sleep(`${options.seconds} seconds`).pipe(Effect.andThen(Effect.promise(running.stop))),
  (running) => Effect.promise(running.stop),
);
