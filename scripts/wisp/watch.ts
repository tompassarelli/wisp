// What each Warcraft III client is doing, from events rather than its screen:
// the menus' socket (wisp:docs/driving-warcraft.md), Warcraft III's own log
// (War3Log.txt) and crash reports, the map's match receipts in CustomMapData,
// and the processes in the client's Wine prefix. Nothing here captures or
// reads the screen. How each state is decided: wisp:docs/watch.md.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { Clock, Context, Effect, Layer, Schema } from "effect";
import { ackFile } from "../../src/runtime/gameFiles";
import { type PrefixUse, type ProcessInfo, prefixUse } from "../warcraft/battleNet";
import { listProcesses } from "../warcraft/processes";
import { type LadderScan, SCAN_QUIET_MS, importFailures, ladderScan, logTime, sessionMarks, sessionStart, sessionText, war3LogPath } from "../warcraft/war3Log";
import type { Client } from "./clients";
import { dataDirectory } from "./gameFiles";
import { type MenuEvent, connectMenus, keptAddress, menuAddress } from "./menus";
import { pairClients, readPool } from "./lan/pool";

/** Where a state or event was learned. */
export type Source = "socket" | "log" | "receipt" | "process" | "lan";

/** One client's state. `kind` names it; the rest is what the source said. */
export type ClientState =
  /** Neither Battle.net nor Warcraft III runs in the client's prefix. */
  | { readonly kind: "closed" }
  /** Battle.net runs; Warcraft III doesn't. */
  | { readonly kind: "launcher" }
  /** Warcraft III runs; no source has said where it is yet. Its log is written in bursts, so a line it lacks says nothing. */
  | { readonly kind: "running" }
  /** The menus show the login screen (socket), before this client signed in. */
  | { readonly kind: "signing in" }
  /** Its log shows the login doors closed; the menus haven't reported a screen. */
  | { readonly kind: "signed in" }
  /** A menu screen, as the game names it (`MAIN_MENU`, `CUSTOM_LOBBIES`, ...). */
  | { readonly kind: "menus"; readonly screen: string }
  /** In a lobby; `host` when this client hosts it. */
  | { readonly kind: "lobby"; readonly host?: boolean; readonly map?: string }
  | { readonly kind: "loading"; readonly map?: string }
  | { readonly kind: "in match"; readonly map?: string }
  /** The score screen after a match. */
  | { readonly kind: "results" }
  /** Warcraft III runs but has lost Battle.net. */
  | { readonly kind: "disconnected"; readonly reason: string }
  /** Warcraft III stopped without being closed, or wrote a crash report. */
  | { readonly kind: "crashed"; readonly reason: string };

export type StateKind = ClientState["kind"];

/** A client as last observed. */
export interface ClientView {
  readonly client: string;
  readonly state: ClientState;
  /** Which source decided `state`, the line or message that did, and when it was observed (ms since the epoch). */
  readonly source: Source;
  readonly evidence: string;
  readonly at: number;
  /** The newest session's post-sign-in ladder map scan (wisp:scripts/warcraft/war3Log.ts). */
  readonly scan: LadderScan["kind"];
  /** Models the newest session's map couldn't create: "model creation failed - war3mapImported/...". */
  readonly loadErrors: { readonly count: number; readonly first?: string };
  /** Whether the client's menu page was connected when the view was decided. Without it, a match receipt may be an earlier match's. */
  readonly menus?: boolean;
}

/** A change in a client's view, as `wisp client watch` prints it. */
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

/** Every watched client's current view. */
export class ClientWatch extends Context.Service<ClientWatch, {
  readonly view: (client: Client) => Effect.Effect<ClientView, WatchFailure>;
}>()("wisp/ClientWatch") {
  /** Watches clients on this machine. `filePrefix` is the map's runtime file prefix, for its match receipts. */
  static readonly layer = (options: WatchOptions = {}) => Layer.effect(ClientWatch, liveWatch(options));
}

export interface WaitOptions {
  /** What is awaited, for the failure message. */
  readonly what?: string;
  readonly seconds?: number;
  /** States that end the wait with a failure unless the predicate accepts them first. Default: crashed, disconnected. */
  readonly failOn?: readonly StateKind[];
}

const POLL = "100 millis";
/** States that end a wait by default. */
export const FAIL_ON: readonly StateKind[] = ["crashed", "disconnected"];
/** Every state, as `client wait` takes them. */
export const STATE_KINDS: readonly StateKind[] = ["closed", "launcher", "running", "signing in", "signed in", "menus", "lobby", "loading", "in match", "results", "disconnected", "crashed"];

/** One line for a view: its state, its detail, and where it came from. */
export const describeView = (view: ClientView) => {
  const { state } = view;
  const detail = "reason" in state ? `: ${state.reason}` : "screen" in state ? ` (${state.screen})` : "host" in state && state.host !== undefined ? (state.host ? " (host)" : " (guest)") : "";
  return `${state.kind}${detail}, by ${view.source}: ${view.evidence}`;
};

/**
 * Waits until `predicate` accepts the client's view and returns that view.
 * A state in `failOn` (crashed or disconnected by default) fails at once.
 */
export const waitFor = (client: Client, predicate: (view: ClientView) => boolean, options: WaitOptions = {}) => Effect.gen(function*() {
  const watch = yield* ClientWatch;
  const { what = "a state", seconds = 60, failOn = FAIL_ON } = options;
  const deadline = (yield* Clock.currentTimeMillis) + seconds * 1000;
  while (true) {
    const view = yield* watch.view(client);
    if (predicate(view)) return view;
    if (failOn.includes(view.state.kind)) return yield* new WatchFailure({ client: client.name, operation: `wait for ${what}`, problem: describeView(view) });
    if ((yield* Clock.currentTimeMillis) > deadline) {
      return yield* new WatchFailure({ client: client.name, operation: `wait for ${what}`, problem: `not within ${seconds} s; last ${describeView(view)}` });
    }
    yield* Effect.sleep(POLL);
  }
});

/**
 * Whether Return or typed text reaches the match's own chat: the client is in
 * a match while its menu page is connected. In the menus they reach
 * Battle.net's public channel, in a lobby its chat, and without the page a
 * match receipt may be one an earlier match left.
 */
export const typesIntoMatch = (view: ClientView) => view.state.kind === "in match" && (view.menus === true || view.source === "lan");

/** A predicate for one of these states. */
export const inState = (...kinds: readonly StateKind[]) => (view: ClientView) => kinds.includes(view.state.kind);

/**
 * Fails as soon as the client crashes or loses Battle.net while `effect`
 * runs, instead of letting `effect` wait out its own timeout. Without a
 * ClientWatch in the environment, `effect` runs as it is.
 */
export const unlessLost = <A, E, R>(client: Client, effect: Effect.Effect<A, E, R>) => Effect.gen(function*() {
  const watch = yield* Effect.serviceOption(ClientWatch);
  if (watch._tag === "None") return yield* effect;
  const lost = waitFor(client, () => false, { what: "the client to stay up", seconds: Number.POSITIVE_INFINITY }).pipe(Effect.provideService(ClientWatch, watch.value));
  return yield* Effect.raceFirst(effect, lost.pipe(Effect.flatMap(() => Effect.never)));
});

// ----- Deciding a state from its sources -----

/** A state as one source last said it. */
export interface Observed {
  readonly state: ClientState;
  readonly at: number;
  readonly evidence: string;
}

/** What the menus' socket has said since it connected. */
export interface SocketState {
  readonly connected: boolean;
  readonly last?: Observed;
}

const record = (value: unknown): Readonly<Record<string, unknown>> => (typeof value === "object" && value !== null ? value as Record<string, unknown> : {});

/** The game's screen names that mean a lobby, the loading screen, the match and the score screen. */
const LOBBY_SCREENS = new Set(["GAME_LOBBY", "CUSTOM_GAME_LOBBY"]);

/**
 * The socket's state after one message from the game. Screens come from
 * SetGlueScreen; DISABLED_SCREEN after LOADING_SCREEN is the match, the menus
 * hidden; GameLobbySetup says who hosts; UpdateScoreInfo is the score screen;
 * LoggedOut is Battle.net signing the client out.
 */
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

/** A crash report in Documents/Warcraft III/Errors: its folder, the session it ended, and its summary. */
export interface CrashReport {
  readonly folder: string;
  readonly session: string;
  readonly summary: string;
  /** When its Crash.txt was written (ms since the epoch). */
  readonly written: number;
}

/** The first line of a Crash.txt's exception summary, such as "ACCESS_VIOLATION (Failed to read address ...)". */
export function crashSummary(crash: string): string {
  const lines = crash.split(/\r?\n/);
  const start = lines.findIndex((line) => line.startsWith("<Exception.Summary:>"));
  const line = start < 0 ? undefined : lines[start + 1];
  return line === undefined ? "Warcraft III wrote a crash report" : line.replace(/\s*DBG-OPTIONS.*$/, "").trim();
}

/** Everything a view is decided from, read at one moment. */
export interface Sources {
  readonly now: number;
  readonly prefix: PrefixUse;
  /** War3Log.txt, when it exists. */
  readonly log?: string;
  readonly crashes: readonly CrashReport[];
  /** When the map last wrote its match receipt (ms since the epoch). */
  readonly receipt?: number;
  readonly socket: SocketState;
  /** Live offline host observation for this declared pool client's exact process. */
  readonly lan?: { readonly pid: number; readonly map: string; readonly phase: string; readonly connected: boolean; readonly loaded: boolean; readonly left: boolean };
}

/** States of a client that had signed in: the login screen after one of them is a lost connection. */
const SIGNED_IN: readonly StateKind[] = ["signed in", "menus", "lobby", "loading", "in match", "results", "disconnected"];

/** A crash report counts while the game is gone, or for this long after it was written while a game still runs. */
const CRASH_FRESH_MS = 60_000;

/**
 * The client's view from its sources, in this order: a crash report for the
 * running session; the processes (closed, launcher, or a game gone without
 * closing while watched); the log's sign-in; the socket; the map's receipt.
 */
export function decide(client: string, sources: Sources, previous?: ClientView): ClientView {
  const { now, log = "", socket } = sources;
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

  // War3Log.txt is written in bursts (6 Oct: client B's stopped 3 s after its start while B played all
  // evening), so a line it lacks says nothing: the socket outranks it, and the log only adds what it has.
  // A log that ended cleanly is the last launch's until this one writes.
  const login = marks.login === undefined || marks.ended !== undefined ? undefined : logTime(marks.login.at, now);
  const receipt = sources.receipt !== undefined && (login === undefined || sources.receipt >= login) ? sources.receipt : undefined;
  const said = socket.last;
  if (said !== undefined) {
    if (said.state.kind === "signing in") {
      const wasIn = (login !== undefined && login <= said.at) || (previous !== undefined && SIGNED_IN.includes(previous.state.kind));
      return keep(wasIn ? view({ kind: "disconnected", reason: "the menus went back to the login screen" }, "socket", said.evidence, said.at) : view(said.state, "socket", said.evidence, said.at));
    }
    // The map's receipt is newer than the lobby or loading screen the socket last said: the match runs.
    if (receipt !== undefined && receipt > said.at && (said.state.kind === "lobby" || said.state.kind === "loading")) {
      return keep(view({ kind: "in match" }, "receipt", "match start receipt", receipt));
    }
    return keep(view(said.state, "socket", said.evidence, said.at));
  }
  if (receipt !== undefined && login !== undefined) return keep(view({ kind: "in match" }, "receipt", "match start receipt", receipt));
  if (login !== undefined) return keep(view({ kind: "signed in" }, "log", "LoginDoorClose", login));
  return keep(view({ kind: "running" }, "process", `Warcraft III.exe pid ${game.pid}; no menu screen heard and no LoginDoorClose in its log yet`));
}

const sameState = (a: ClientState, b: ClientState) => JSON.stringify(a) === JSON.stringify(b);

/** The events between two views of a client: a new state, a scan step, new load errors. */
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

/** An event as one line: time, client, what, and its source. */
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

// ----- Reading the sources on this machine -----

/** The Wine prefix a Documents/Warcraft III folder is in. */
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

/**
 * The pair agent's status. A loaded machine (many pairs, high CPU pressure)
 * can delay the agent's answer past a second; a missing answer reads as "not
 * playing" and refuses chat, so each try waits 3 s and a failed try is retried once.
 */
const pairStatus = async (socket: string): Promise<unknown> => {
  for (let attempt = 1; ; attempt++) {
    try {
      const response = await fetch("http://pair/status", { unix: socket, signal: AbortSignal.timeout(3000) });
      return await response.json();
    } catch (cause) {
      if (attempt >= 2) throw cause;
    }
  }
};

/** The host socket is outside the pool's isolated network; its menus' TCP sockets are inside. */
const lanObservation = (documents: string) => Effect.tryPromise({
  try: async () => {
    const pair = readPool()?.pairs.find((pair) => pairClients(pair.id, pair.runs).some((client) => client.documents === documents));
    if (pair === undefined) return undefined;
    const status = Schema.decodeUnknownSync(LanStatus)(await pairStatus(pair.agentSocket));
    const client = status.clients.find((client) => client.documents === documents);
    const player = status.game?.players.find((player) => player.label === client?.name);
    return client?.pid === undefined || status.game === undefined || player === undefined ? undefined
      : { pid: client.pid, map: status.game.map, phase: status.game.phase, connected: player.connected, loaded: player.loaded, left: player.left };
  },
  catch: () => undefined,
}).pipe(Effect.orElseSucceed(() => undefined));
const modified = (path: string) => statSync(path, { throwIfNoEntry: false })?.mtimeMs;

export interface WatchOptions {
  /** The map's runtime file prefix (configureRuntime); its match start receipts count as "in match". */
  readonly filePrefix?: string;
  /** Called with every message each client's menus send, as `{ client, at, messageType, payload }`; `wisp client watch --record` writes them. */
  readonly onMessage?: (client: string, at: number, event: MenuEvent) => void;
}

const SLOTS = 24;

const liveWatch = (options: WatchOptions) => Effect.gen(function*() {
  const scope = yield* Effect.scope;
  const trackers = new Map<string, { socket: SocketState; tried: boolean; view?: ClientView; log?: string | undefined; logKey?: string; crashes: Map<string, CrashReport | undefined> }>();

  /** Keeps a socket to the client's menus, reconnecting while the game restarts. */
  const follow = (client: Client, tracker: { socket: SocketState; tried: boolean }) => Effect.gen(function*() {
    const port = client.menuReportPort!;
    while (true) {
      yield* Effect.scoped(Effect.gen(function*() {
        const address = yield* menuAddress(port, 3).pipe(Effect.ensuring(Effect.sync(() => { tracker.tried = true; })));
        const menus = yield* connectMenus(address);
        // The page announces the newest screens it heard, so a client already past them is placed at once.
        tracker.socket = (address.recent ?? []).reduce<SocketState>((socket, heard) => socketEvent(socket, { messageType: heard.messageType, payload: heard }, heard.at), { connected: true });
        yield* menus.expect("follow the menus", 365 * 86_400, (event) => {
          const time = Date.now();
          options.onMessage?.(client.name, time, event);
          tracker.socket = socketEvent(tracker.socket, event, time);
          return undefined;
        });
      })).pipe(Effect.ignore);
      // A closed socket is a game restarting or gone; what it said no longer holds.
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
      // Desync reports share the folder; only a Crash.txt is a crash. A report still being written is read again.
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
        // The first view waits for the page's first announcement, so it starts from the screen the menus show.
        const first = tracker;
        for (let waited = 0; waited < 40 && !(first.tried && (first.socket.connected || waited > 2)); waited++) yield* Effect.sleep("100 millis");
      }
    }
    // The page reports completed local navigation too; it isn't broadcast to
    // our separate socket, so consume its later announcements while connected.
    const recent = client.menuReportPort === undefined ? undefined : keptAddress(client.menuReportPort)?.recent;
    const newest = recent?.at(-1);
    if (recent !== undefined && newest !== undefined && newest.at >= (tracker.socket.last?.at ?? 0)) {
      tracker.socket = recent.reduce<SocketState>((socket, heard) => socketEvent(socket, { messageType: heard.messageType, payload: heard }, heard.at), tracker.socket);
    }
    const processes: readonly ProcessInfo[] = yield* Effect.try({
      try: listProcesses,
      catch: (cause) => new WatchFailure({ client: client.name, operation: "read the process table", problem: String(cause) }),
    });
    // The log is read again only when it changed: it can be hundreds of kilobytes, and waits read views every 100 ms.
    const path = war3LogPath(client.documents);
    const stamp = statSync(path, { throwIfNoEntry: false });
    const key = stamp === undefined ? "" : `${stamp.size}:${stamp.mtimeMs}`;
    if (tracker.logKey !== key) {
      tracker.logKey = key;
      tracker.log = stamp === undefined ? undefined : readText(path);
    }
    const { log } = tracker;
    const lan = yield* lanObservation(client.documents);
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
