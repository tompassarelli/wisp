import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { Clock, Context, Effect, Layer, Schedule, Schema } from "effect";
import { ackFile } from "../../src/runtime/gameFiles";
import { type PrefixUse, type ProcessInfo, prefixUse } from "../warcraft/battleNet";
import { ProcessTable } from "../platform/services";
import { type LadderScan, SCAN_QUIET_MS, importFailures, ladderScan, logTime, sessionMarks, sessionStart, sessionText, war3LogPath } from "../warcraft/war3Log";
import type { Client } from "./clients";
import { dataDirectory } from "./gameFiles";
import { type MenuEvent, connectMenus, keptAddress, menuAddress } from "./menus";
import { pairClients, readPool } from "./lan/pool";
import { describeCause } from "./command";

export type Source = "socket" | "log" | "receipt" | "process" | "lan";

export type ClientState =

  | { readonly kind: "closed" }

  | { readonly kind: "launcher" }

  | { readonly kind: "running" }

  | { readonly kind: "signing in" }

  | { readonly kind: "signed in" }

  | { readonly kind: "menus"; readonly screen: string }

  | { readonly kind: "lobby"; readonly host?: boolean; readonly map?: string }
  | { readonly kind: "loading"; readonly map?: string }
  | { readonly kind: "in match"; readonly map?: string }

  | { readonly kind: "results" }

  | { readonly kind: "disconnected"; readonly reason: string }

  | { readonly kind: "crashed"; readonly reason: string };

export type StateKind = ClientState["kind"];

export interface ClientView {
  readonly client: string;
  readonly state: ClientState;

  readonly source: Source;
  readonly evidence: string;
  readonly at: number;

  readonly scan: LadderScan["kind"];

  readonly loadErrors: { readonly count: number; readonly first?: string };

  readonly menus?: boolean;
}

export type WatchEvent =
  | { readonly type: "state"; readonly client: string; readonly at: number; readonly source: Source; readonly state: ClientState; readonly evidence: string }
  | { readonly type: "ladder scan"; readonly client: string; readonly at: number; readonly source: "log"; readonly scan: LadderScan["kind"] }
  | { readonly type: "load errors"; readonly client: string; readonly at: number; readonly source: "log"; readonly count: number; readonly first?: string };

export class WatchFailure extends Schema.TaggedError<WatchFailure>()("WatchFailure", {
  client: Schema.String,
  operation: Schema.String,
  problem: Schema.String,
}) {
  override get message(): string {
    return `${this.operation} failed for ${this.client}: ${this.problem}`;
  }
}

export class ClientWatch extends Context.Service<ClientWatch, {
  readonly view: (client: Client) => Effect.Effect<ClientView, WatchFailure>;
}>()("wisp/ClientWatch") {

  static readonly layer = (options: WatchOptions = {}) => Layer.effect(ClientWatch, liveWatch(options));
}

export interface WaitOptions {

  readonly what?: string;
  readonly seconds?: number;

  readonly failOn?: readonly StateKind[];
}

const POLL = "100 millis";

export const FAIL_ON: readonly StateKind[] = ["crashed", "disconnected"];

export const STATE_KINDS: readonly StateKind[] = ["closed", "launcher", "running", "signing in", "signed in", "menus", "lobby", "loading", "in match", "results", "disconnected", "crashed"];

export const describeView = (view: ClientView) => {
  const { state } = view;
  const detail = "reason" in state ? `: ${state.reason}` : "screen" in state ? ` (${state.screen})` : "host" in state && state.host !== undefined ? (state.host ? " (host)" : " (guest)") : "";
  return `${state.kind}${detail}, by ${view.source}: ${view.evidence}`;
};

export const waitFor = (client: Client, predicate: (view: ClientView) => boolean, options: WaitOptions = {}) => Effect.gen(function*() {
  const watch = yield* ClientWatch;
  const { what = "a state", seconds = 60, failOn = FAIL_ON } = options;
  let last: ClientView | undefined;
  const look = watch.view(client).pipe(Effect.flatMap((view) => {
    last = view;
    if (predicate(view)) return Effect.succeed(true);
    if (failOn.includes(view.state.kind)) return Effect.fail(new WatchFailure({ client: client.name, operation: `wait for ${what}`, problem: describeView(view) }));
    return Effect.succeed(false);
  }));
  const waited = look.pipe(Effect.repeat({ schedule: Schedule.spaced(POLL), until: (done) => done }));
  if (Number.isFinite(seconds)) {
    yield* waited.pipe(Effect.timeoutOrElse({
      duration: `${seconds} seconds`,
      orElse: () => Effect.fail(new WatchFailure({ client: client.name, operation: `wait for ${what}`, problem: `not within ${seconds} s; last ${last === undefined ? "no view" : describeView(last)}` })),
    }));
  } else yield* waited;
  return last!;
});

export const typesIntoMatch = (view: ClientView) => view.state.kind === "in match" && (view.menus === true || view.source === "lan");

export const inState = (...kinds: readonly StateKind[]) => (view: ClientView) => kinds.includes(view.state.kind);

export const unlessLost = <A, E, R>(client: Client, effect: Effect.Effect<A, E, R>) => Effect.gen(function*() {
  const watch = yield* Effect.serviceOption(ClientWatch);
  if (watch._tag === "None") return yield* effect;
  const lost = waitFor(client, () => false, { what: "the client to stay up", seconds: Number.POSITIVE_INFINITY }).pipe(Effect.provideService(ClientWatch, watch.value));
  return yield* Effect.raceFirst(effect, lost.pipe(Effect.flatMap(() => Effect.never)));
});

export interface Observed {
  readonly state: ClientState;
  readonly at: number;
  readonly evidence: string;
}

export interface SocketState {
  readonly connected: boolean;
  readonly last?: Observed;
}

const record = (value: unknown): Readonly<Record<string, unknown>> => (typeof value === "object" && value !== null ? value as Record<string, unknown> : {});

const LOBBY_SCREENS = new Set(["GAME_LOBBY", "CUSTOM_GAME_LOBBY"]);

export function socketEvent(previous: SocketState, event: MenuEvent, at: number): SocketState {
  const said = (state: ClientState, evidence: string): SocketState => ({ connected: true, last: { state, at, evidence } });
  const payload = record(event.payload);
  switch (event.messageType) {
    case "ScreenTransitionInfo":
      if (payload["type"] !== "Screen") return previous;
    case "SetGlueScreen": {
      const screen = String(payload["screen"] ?? "");
      const evidence = `${event.messageType} ${screen}`;
      if (screen === "LOGIN_DOORS") return said({ kind: "signing in" }, evidence);
      if (LOBBY_SCREENS.has(screen)) return said(previous.last?.state.kind === "lobby" ? previous.last.state : { kind: "lobby" }, evidence);
      if (screen === "LOADING_SCREEN") return said({ kind: "loading" }, evidence);
      if (screen === "SCORE_SCREEN") return said({ kind: "results" }, evidence);
      if (screen === "DISABLED_SCREEN") {
        const kind = previous.last?.state.kind;
        return kind === "loading" || kind === "in match" ? said({ kind: "in match" }, evidence) : previous;
      }
      return screen === "" ? previous : said({ kind: "menus", screen }, evidence);
    }
    case "GameLobbySetup":
      return said({ kind: "lobby", host: payload["isHost"] === true }, `GameLobbySetup isHost=${payload["isHost"] === true}`);
    case "UpdateScoreInfo":
      return said({ kind: "results" }, "UpdateScoreInfo");
    case "LoggedOut":
      return said({ kind: "disconnected", reason: "Battle.net signed this client out" }, "LoggedOut");
    default:
      return previous;
  }
}

export interface CrashReport {
  readonly folder: string;
  readonly session: string;
  readonly summary: string;

  readonly written: number;
}

export function crashSummary(crash: string): string {
  const lines = crash.split(/\r?\n/);
  const start = lines.findIndex((line) => line.startsWith("<Exception.Summary:>"));
  const line = start < 0 ? undefined : lines[start + 1];
  return line === undefined ? "Warcraft III wrote a crash report" : line.replace(/\s*DBG-OPTIONS.*$/, "").trim();
}

export interface Sources {
  readonly now: number;
  readonly prefix: PrefixUse;

  readonly log?: string;
  readonly crashes: readonly CrashReport[];

  readonly receipt?: number;
  readonly socket: SocketState;

  readonly lan?: { readonly pid: number; readonly map: string; readonly phase: string; readonly connected: boolean; readonly loaded: boolean; readonly left: boolean };
}

const SIGNED_IN: readonly StateKind[] = ["signed in", "menus", "lobby", "loading", "in match", "results", "disconnected"];

const CRASH_FRESH_MS = 60_000;

export function decide(client: string, sources: Sources, previous?: ClientView): ClientView {
  const { now } = sources;
  const started = sources.prefix.game?.started;
  const start = sessionMarks(sources.log ?? "").start;
  const log = started !== undefined && (start === undefined || logTime(start.at, now) < started) ? "" : sources.log ?? "";
  const socket = started !== undefined && (sources.socket.last?.at ?? 0) < started ? { connected: false } : sources.socket;
  const marks = sessionMarks(log);
  const session = sessionStart(log);
  const scanned = ladderScan(log);
  const scan = scanned.kind === "scanning" && now - logTime(scanned.last, now) >= SCAN_QUIET_MS ? "done" : scanned.kind;
  const loadErrors = importFailures(sessionText(log));
  const view = (state: ClientState, source: Source, evidence: string, time = now): ClientView => ({ client, state, source, evidence, at: time, scan, loadErrors, menus: socket.connected });
  const keep = (next: ClientView) =>
    previous !== undefined && previous.state.kind === next.state.kind && previous.source === next.source && previous.evidence === next.evidence ? { ...next, at: previous.at } : next;

  const crash = sources.crashes.find((report) => report.session === session && (sources.prefix.game === undefined || now - report.written < CRASH_FRESH_MS));
  if (crash !== undefined) return keep(view({ kind: "crashed", reason: crash.summary }, "log", `Errors/${crash.folder}/Crash.txt`));

  const { game, launcher } = sources.prefix;
  if (game === undefined) {
    return keep(launcher !== undefined
      ? view({ kind: "launcher" }, "process", `Battle.net.exe pid ${launcher.pid}`)
      : view({ kind: "closed" }, "process", "no Battle.net.exe or Warcraft III.exe in the prefix"));
  }
  if (sources.lan?.pid === game.pid && sources.lan.phase === "playing" && sources.lan.connected && sources.lan.loaded && !sources.lan.left) {
    return keep(view({ kind: "in match", map: sources.lan.map }, "lan", `offline host playing; Warcraft III.exe pid ${game.pid} loaded and connected`));
  }

  const login = marks.login === undefined || marks.ended !== undefined ? undefined : logTime(marks.login.at, now);
  const receipt = sources.receipt !== undefined && (started === undefined || sources.receipt >= started) && (login === undefined || sources.receipt >= login) ? sources.receipt : undefined;
  const said = socket.last;
  if (said !== undefined) {
    if (said.state.kind === "signing in") {
      const wasIn = (login !== undefined && login <= said.at) || (previous !== undefined && SIGNED_IN.includes(previous.state.kind));
      return keep(wasIn ? view({ kind: "disconnected", reason: "the menus went back to the login screen" }, "socket", said.evidence, said.at) : view(said.state, "socket", said.evidence, said.at));
    }

    if (receipt !== undefined && receipt > said.at && (said.state.kind === "lobby" || said.state.kind === "loading")) {
      return keep(view({ kind: "in match" }, "receipt", "match start receipt", receipt));
    }
    return keep(view(said.state, "socket", said.evidence, said.at));
  }
  if (receipt !== undefined && login !== undefined) return keep(view({ kind: "in match" }, "receipt", "match start receipt", receipt));
  if (login !== undefined) return keep(view({ kind: "signed in" }, "log", "LoginDoorClose", login));
  return keep(view({ kind: "running" }, "process", `Warcraft III.exe pid ${game.pid}; starting: no menu screen heard and no LoginDoorClose in its log yet`));
}

const sameState = (a: ClientState, b: ClientState) => JSON.stringify(a) === JSON.stringify(b);

export function changes(previous: ClientView | undefined, next: ClientView): WatchEvent[] {
  const events: WatchEvent[] = [];
  const { client } = next;
  if (previous === undefined || !sameState(previous.state, next.state)) {
    events.push({ type: "state", client, at: next.at, source: next.source, state: next.state, evidence: next.evidence });
  }
  if (previous === undefined ? next.scan !== "signing in" : previous.scan !== next.scan) events.push({ type: "ladder scan", client, at: next.at, source: "log", scan: next.scan });
  if (next.loadErrors.count > (previous?.loadErrors.count ?? 0)) {
    events.push({ type: "load errors", client, at: next.at, source: "log", count: next.loadErrors.count, ...(next.loadErrors.first === undefined ? {} : { first: next.loadErrors.first }) });
  }
  return events;
}

export function eventLine(event: WatchEvent): string {
  const time = new Date(event.at).toTimeString().slice(0, 8);
  switch (event.type) {
    case "state": {
      const { state } = event;
      const detail = "reason" in state ? `: ${state.reason}` : "screen" in state ? ` ${state.screen}` : "host" in state && state.host !== undefined ? (state.host ? " (host)" : " (guest)") : "";
      return `${time} ${event.client} ${state.kind}${detail}  [${event.source}: ${event.evidence}]`;
    }
    case "ladder scan":
      return `${time} ${event.client} ladder scan ${event.scan}  [log]`;
    case "load errors":
      return `${time} ${event.client} load errors: ${event.count} models failed${event.first === undefined ? "" : `, first ${event.first}`}  [log]`;
  }
}

export const prefixOf = (documents: string) => {
  const at = documents.indexOf("/drive_c/");
  return at < 0 ? undefined : documents.slice(0, at);
};

const readText = (path: string) => {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return undefined;
  }
};

const LanStatus = Schema.Struct({
  clients: Schema.Array(Schema.Struct({ name: Schema.String, documents: Schema.String, pid: Schema.optional(Schema.Int) })),
  game: Schema.optional(Schema.Struct({ map: Schema.String, phase: Schema.String, players: Schema.Array(Schema.Struct({ label: Schema.String, connected: Schema.Boolean, loaded: Schema.Boolean, left: Schema.Boolean })) })),
});

const pairStatus = (client: string, socket: string) => Effect.tryPromise({
  try: (signal) => fetch("http://pair/status", { unix: socket, signal }).then((response) => response.json()),
  catch: (cause) => new WatchFailure({ client, operation: "read the pair agent's status", problem: describeCause(cause) }),
}).pipe(
  Effect.timeoutOrElse({ duration: "3 seconds", orElse: () => Effect.fail(new WatchFailure({ client, operation: "read the pair agent's status", problem: `${socket} didn't answer within 3 s` })) }),
  Effect.retry({ times: 1 }),
  Effect.flatMap(Schema.decodeUnknownEffect(LanStatus)),
  Effect.mapError((failure) => (failure instanceof WatchFailure ? failure : new WatchFailure({ client, operation: "read the pair agent's status", problem: failure.message }))),
);

export const lanObservation = (client: Pick<Client, "name" | "documents">) => Effect.gen(function*() {
  const { documents } = client;
  const pool = yield* readPool.pipe(Effect.mapError((failure) => new WatchFailure({ client: client.name, operation: "read the LAN pool", problem: failure.problem })));
  const pair = pool?.pairs.find((pair) => pairClients(pair.id, pair.runs).some((client) => client.documents === documents));
  if (pair === undefined) return undefined;
  const status = yield* pairStatus(client.name, pair.agentSocket);
  const known = status.clients.find((client) => client.documents === documents);
  const player = status.game?.players.find((player) => player.label === known?.name);
  return known?.pid === undefined || status.game === undefined || player === undefined ? undefined
    : { pid: known.pid, map: status.game.map, phase: status.game.phase, connected: player.connected, loaded: player.loaded, left: player.left };
});
const modified = (path: string) => statSync(path, { throwIfNoEntry: false })?.mtimeMs;

export interface WatchOptions {

  readonly filePrefix?: string;

  readonly onMessage?: (client: string, at: number, event: MenuEvent) => void;
}

const SLOTS = 24;

const liveWatch = (options: WatchOptions) => Effect.gen(function*() {
  const scope = yield* Effect.scope;
  const table = yield* ProcessTable;
  const trackers = new Map<string, { socket: SocketState; tried: boolean; view?: ClientView; log?: string | undefined; logKey?: string; crashes: Map<string, CrashReport | undefined> }>();

  const follow = (client: Client, tracker: { socket: SocketState; tried: boolean }) => Effect.gen(function*() {
    const port = client.menuReportPort!;
    while (true) {
      yield* Effect.scoped(Effect.gen(function*() {
        const address = yield* menuAddress(port, 3).pipe(Effect.ensuring(Effect.sync(() => { tracker.tried = true; })));
        const menus = yield* connectMenus(address);

        tracker.socket = (address.recent ?? []).reduce<SocketState>((socket, heard) => socketEvent(socket, { messageType: heard.messageType, payload: heard }, heard.at), { connected: true });
        yield* menus.expect("follow the menus", 365 * 86_400, (event) => {
          const time = Date.now();
          options.onMessage?.(client.name, time, event);
          tracker.socket = socketEvent(tracker.socket, event, time);
          return undefined;
        });
      })).pipe(Effect.ignore);

      tracker.socket = { connected: false };
      yield* Effect.sleep("2 seconds");
    }
  });

  const crashes = (documents: string, known: Map<string, CrashReport | undefined>) => {
    const errors = join(documents, "Errors");
    let folders: string[] = [];
    try {
      folders = readdirSync(errors);
    } catch {
      return [];
    }
    for (const folder of folders) {
      if (known.get(folder) !== undefined) continue;
      const crash = readText(join(errors, folder, "Crash.txt"));
      const copy = readText(join(errors, folder, "War3Log.txt"));
      const session = copy === undefined ? undefined : sessionStart(copy);

      known.set(folder, crash === undefined || session === undefined ? undefined : { folder, session, summary: crashSummary(crash), written: modified(join(errors, folder, "Crash.txt")) ?? 0 });
    }
    return [...known.values()].filter((report) => report !== undefined);
  };

  const receipt = (documents: string) => {
    if (options.filePrefix === undefined) return undefined;
    const times = Array.from({ length: SLOTS }, (_, slot) => modified(join(dataDirectory(documents), ackFile(slot, options.filePrefix)))).filter((time) => time !== undefined);
    return times.length === 0 ? undefined : Math.max(...times);
  };

  const view = (client: Client) => Effect.gen(function*() {
    const prefix = prefixOf(client.documents);
    if (prefix === undefined) return yield* new WatchFailure({ client: client.name, operation: "watch", problem: `${client.documents} is not in a Wine prefix's drive_c` });
    let tracker = trackers.get(client.name);
    if (tracker === undefined) {
      tracker = { socket: { connected: false }, tried: false, crashes: new Map() };
      trackers.set(client.name, tracker);
      if (client.menuReportPort !== undefined) {
        yield* Effect.forkIn(follow(client, tracker), scope);

        const first = tracker;
        for (let waited = 0; waited < 40 && !(first.tried && (first.socket.connected || waited > 2)); waited++) yield* Effect.sleep("100 millis");
      }
    }

    const recent = client.menuReportPort === undefined ? undefined : keptAddress(client.menuReportPort)?.recent;
    const newest = recent?.at(-1);
    if (recent !== undefined && newest !== undefined && newest.at >= (tracker.socket.last?.at ?? 0)) {
      tracker.socket = recent.reduce<SocketState>((socket, heard) => socketEvent(socket, { messageType: heard.messageType, payload: heard }, heard.at), tracker.socket);
    }
    const processes: readonly ProcessInfo[] = yield* table.list.pipe(
      Effect.mapError((cause) => new WatchFailure({ client: client.name, operation: "read the process table", problem: cause.message })),
    );

    const path = war3LogPath(client.documents);
    const stamp = statSync(path, { throwIfNoEntry: false });
    const key = stamp === undefined ? "" : `${stamp.size}:${stamp.mtimeMs}`;
    if (tracker.logKey !== key) {
      tracker.logKey = key;
      tracker.log = stamp === undefined ? undefined : readText(path);
    }
    const { log } = tracker;
    const lan = yield* lanObservation(client);
    const sources: Sources = {
      now: yield* Clock.currentTimeMillis,
      prefix: prefixUse(processes, prefix, ""),
      ...(log === undefined ? {} : { log }),
      crashes: crashes(client.documents, tracker.crashes),
      ...(() => {
        const time = receipt(client.documents);
        return time === undefined ? {} : { receipt: time };
      })(),
      socket: tracker.socket,
      ...(lan === undefined ? {} : { lan }),
    };
    tracker.view = decide(client.name, sources, tracker.view);
    return tracker.view;
  });
  return ClientWatch.of({ view });
});
