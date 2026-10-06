// Warcraft III's menus without clicks (wisp:docs/driving-warcraft.md). The
// game serves its menus as a web page at
// http://127.0.0.1:PORT/webui/index.html?guid=GUID and talks to that page over
// ws://127.0.0.1:PORT/webui-socket/GUID; any local socket with that address may
// send what the page sends, and hears what the game tells the page. PORT
// changes with every launch and GUID is known only to the page, so Wisp
// installs a page of its own in the game's _retail_/webui folder (read only
// while the registry value "Allow Local Files" is 1). It loads the game's own
// menus and tells Wisp its address.
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, rmdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { Clock, Deferred, Effect, Option, Queue, Schema, type Scope } from "effect";

/** Where an installed menu page reports its address and the menus' own requests. */
export const DEFAULT_MENU_REPORT_PORT = 47123;

export class MenuFailure extends Schema.TaggedError<MenuFailure>()("MenuFailure", {
  operation: Schema.String,
  problem: Schema.String,
}) {
  override get message(): string {
    return `${this.operation}: ${this.problem}`;
  }
}

/** The menus' socket address. The GUID lets anything local drive the menus; it is never printed. */
export interface MenuAddress {
  readonly port: number;
  readonly guid: string;
  /** The newest state messages the page heard from the game, oldest first, so a later listener knows the current screen. */
  readonly recent?: readonly HeardMessage[];
}

/** A state message the page heard: its name, its screen or host flag, and when (ms since the epoch). */
export interface HeardMessage {
  readonly messageType: string;
  readonly at: number;
  readonly screen?: string;
  readonly type?: string;
  readonly isHost?: boolean;
}

/** A message the menus sent the game: its name, and its payload for lobby and map messages. */
export interface SentMessage {
  readonly message: string;
  readonly payload?: unknown;
}

/** A message from the game, as every connected socket receives it. */
export interface MenuEvent {
  readonly messageType: string;
  readonly payload: unknown;
}

const PAGE_MARK = `<meta name="wisp" content="menu page" />`;
/** Requests whose payloads the page reports: what a lobby step sends. */
const REPORTED_PAYLOADS = "Lobby|Slot|Computer|Team|Race|Color|Handicap|Map|Start|Join|ScreenTransitionInfo";
/** Messages from the game that say where the client is; the page keeps the newest few and announces them. */
const PAGE_STATES = "SetGlueScreen|GameLobbySetup|UpdateScoreInfo|LoggedOut";
const RECENT_KEPT = 4;

/**
 * The menu page: the game's own menus (GlueManager.js draws them into #root
 * and #portal), plus a script that posts the page's port and GUID to
 * 127.0.0.1:reportPort every 2 s and, while something listens there, the name
 * of each request the menus send.
 */
export function menuPage(reportPort: number): string {
  return `<!DOCTYPE html>
<html>
  <head>
    <meta charset="utf-8" />
    ${PAGE_MARK}
    <title>Warcraft 3 UI</title>
    <meta name="viewport" content="width=device-width, minimum-scale=1.0, initial-scale=1.0, minimal-ui" />
    <script>
      window.__DEBUG = false;
      (function () {
        var report = "http://127.0.0.1:${reportPort}";
        var guid = new URLSearchParams(location.search).get("guid");
        var heard = false;
        var payloads = /${REPORTED_PAYLOADS}/;
        var states = /^(?:${PAGE_STATES})$/;
        var recent = [];
        function keep(messageType, payload) {
          var kept = { messageType: messageType, at: Date.now() };
          if (typeof payload.screen === "string") kept.screen = payload.screen;
          if (typeof payload.type === "string") kept.type = payload.type;
          if (typeof payload.isHost === "boolean") kept.isHost = payload.isHost;
          recent.push(kept);
          if (recent.length > ${RECENT_KEPT}) recent.shift();
        }
        function post(path, body) {
          return fetch(report + path, { method: "POST", mode: "no-cors", body: JSON.stringify(body) });
        }
        var Native = window.WebSocket;
        function Watched(url, protocols) {
          var socket = protocols === undefined ? new Native(url) : new Native(url, protocols);
          if (String(url).indexOf("/webui-socket/") !== -1) {
            var send = socket.send.bind(socket);
            socket.send = function (data) {
              try {
                var sent = JSON.parse(data);
                if (sent.message === "ScreenTransitionInfo" && sent.payload && sent.payload.type === "Screen") {
                  keep(sent.message, sent.payload);
                }
                if (heard && typeof sent.message === "string") {
                  post("/sent", payloads.test(sent.message) ? { message: sent.message, payload: sent.payload } : { message: sent.message }).catch(function () {});
                }
              } catch (error) {}
              return send(data);
            };
            if (socket.addEventListener) {
              socket.addEventListener("message", function (event) {
                try {
                  var said = JSON.parse(event.data);
                  if (typeof said.messageType !== "string" || !states.test(said.messageType)) return;
                  keep(said.messageType, said.payload || {});
                } catch (error) {}
              });
            }
          }
          return socket;
        }
        Watched.prototype = Native.prototype;
        Watched.CONNECTING = 0;
        Watched.OPEN = 1;
        Watched.CLOSING = 2;
        Watched.CLOSED = 3;
        window.WebSocket = Watched;
        function announce() {
          if (!guid) return;
          var address = { port: Number(location.port), guid: guid };
          if (recent.length > 0) address.recent = recent;
          post("/menus", address)
            .then(function () { heard = true; }, function () { heard = false; });
          setTimeout(announce, 2000);
        }
        announce();
      })();
    </script>
  </head>
  <body>
    <div id="root"></div>
    <div id="portal"></div>
    <script src="GlueManager.js"></script>
  </body>
</html>
`;
}

const pagePath = (retail: string) => join(retail, "webui", "index.html");

/** Writes the menu page into the game's `_retail_` folder; refuses to replace a page Wisp didn't write. */
export const installMenuPage = (retail: string, reportPort = DEFAULT_MENU_REPORT_PORT) => Effect.gen(function*() {
  const path = pagePath(retail);
  if (!existsSync(join(retail, "x86_64"))) return yield* new MenuFailure({ operation: "install the menu page", problem: `${retail} is not Warcraft III's _retail_ folder (it has no x86_64)` });
  if (existsSync(path) && !readFileSync(path, "utf8").includes(PAGE_MARK)) {
    return yield* new MenuFailure({ operation: "install the menu page", problem: `${path} is another program's menu page; move it away first` });
  }
  yield* Effect.try({
    try: () => {
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, menuPage(reportPort));
    },
    catch: (cause) => new MenuFailure({ operation: "install the menu page", problem: String(cause) }),
  });
  return path;
});

/** Removes Wisp's menu page, and its folder when nothing else is in it. */
export const removeMenuPage = (retail: string) => Effect.try({
  try: () => {
    const path = pagePath(retail);
    if (!existsSync(path)) return false;
    if (!readFileSync(path, "utf8").includes(PAGE_MARK)) throw new Error(`${path} is not Wisp's menu page; it was left in place`);
    rmSync(path);
    if (readdirSync(dirname(path)).length === 0) rmdirSync(dirname(path));
    return true;
  },
  catch: (cause) => new MenuFailure({ operation: "remove the menu page", problem: cause instanceof Error ? cause.message : String(cause) }),
});

const Heard = Schema.Struct({ messageType: Schema.String, at: Schema.Finite, screen: Schema.optionalKey(Schema.String), type: Schema.optionalKey(Schema.String), isHost: Schema.optionalKey(Schema.Boolean) });
const Announcement = Schema.Struct({ port: Schema.Int, guid: Schema.String, recent: Schema.optionalKey(Schema.Array(Heard)) });

/**
 * One program at a time can listen on a report port. The listener keeps the
 * newest announced address in a file only this user can read, so another
 * Wisp program (`wisp watch` beside `play` or `fresh`) finds the menus too.
 */
export const menuAddressFile = (reportPort: number) => join(process.env["XDG_RUNTIME_DIR"] ?? tmpdir(), `wisp-menus-${reportPort}.json`);
/** The page announces every 2 s; an address file older than this has no listener behind it. */
const ADDRESS_FRESH_MS = 6000;
const KeptAddress = Schema.Struct({ port: Schema.Int, guid: Schema.String, recent: Schema.optionalKey(Schema.Array(Heard)), at: Schema.Finite });

const keepAddress = (reportPort: number, address: MenuAddress) => {
  try {
    const path = menuAddressFile(reportPort);
    writeFileSync(`${path}.new`, JSON.stringify({ ...address, at: Date.now() }), { mode: 0o600 });
    renameSync(`${path}.new`, path);
  } catch {
    // Without the file, only this listener knows the address.
  }
};

/** The address another listener on the port keeps, while it is fresh. */
export const keptAddress = (reportPort: number, now = Date.now()): MenuAddress | undefined => {
  const kept = Schema.decodeUnknownOption(KeptAddress)(parseJson(existsSync(menuAddressFile(reportPort)) ? readFileSync(menuAddressFile(reportPort), "utf8") : ""));
  if (Option.isNone(kept) || now - kept.value.at > ADDRESS_FRESH_MS) return undefined;
  const { at: _, ...address } = kept.value;
  return address;
};
const Sent = Schema.Struct({ message: Schema.String, payload: Schema.optional(Schema.Unknown) });
const Envelope = Schema.Struct({ messageType: Schema.String, payload: Schema.optional(Schema.Unknown) });
const GUID = /^[A-Za-z0-9_-]{1,128}$/;
const PAGE_ORIGIN = /^http:\/\/127\.0\.0\.1:\d{1,5}$/;
const SENT_KEPT = 200;

const parseJson = (text: string): unknown => {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
};

export interface MenuReports {
  /** The port this listens on. */
  readonly port: number;
  /** The newest address a page announced. */
  readonly address: Effect.Effect<MenuAddress | undefined>;
  /** Waits for a page's first announcement. */
  readonly waitForAddress: (seconds: number) => Effect.Effect<MenuAddress, MenuFailure>;
  /** The requests the menus sent while this listened, oldest first (the newest 200). */
  readonly sent: Effect.Effect<readonly SentMessage[]>;
}

/**
 * Listens on 127.0.0.1:reportPort for an installed menu page until the scope
 * closes. Only a page served by the game (an http://127.0.0.1:PORT origin)
 * is heard, so another site open in a browser can't redirect Wisp.
 */
export const listenForMenus = (reportPort = DEFAULT_MENU_REPORT_PORT, onSent: (sent: SentMessage) => void = () => {}): Effect.Effect<MenuReports, MenuFailure, Scope.Scope> => Effect.gen(function*() {
  let latest: MenuAddress | undefined;
  const sent: SentMessage[] = [];
  const first = yield* Deferred.make<MenuAddress>();
  const empty = () => new Response(null, { status: 204 });
  const server = yield* Effect.acquireRelease(
    Effect.try({
      try: () => Bun.serve({
        hostname: "127.0.0.1",
        port: reportPort,
        fetch: async (request) => {
          const url = new URL(request.url);
          if (request.method !== "POST" || !PAGE_ORIGIN.test(request.headers.get("origin") ?? "")) return new Response(null, { status: 403 });
          const body = parseJson(await request.text());
          if (url.pathname === "/menus") {
            const announced = Schema.decodeUnknownOption(Announcement)(body);
            if (Option.isNone(announced) || !GUID.test(announced.value.guid) || announced.value.port < 1 || announced.value.port > 65535) return new Response(null, { status: 400 });
            latest = announced.value;
            keepAddress(Number(url.port), latest);
            Deferred.doneUnsafe(first, Effect.succeed(latest));
            return empty();
          }
          if (url.pathname === "/sent") {
            const message = Schema.decodeUnknownOption(Sent)(body);
            if (Option.isNone(message)) return new Response(null, { status: 400 });
            sent.push(message.value);
            if (sent.length > SENT_KEPT) sent.shift();
            onSent(message.value);
            return empty();
          }
          return new Response(null, { status: 404 });
        },
      }),
      catch: (cause) => new MenuFailure({ operation: "listen for the menu page", problem: `can't listen on 127.0.0.1:${reportPort}: ${String(cause)}` }),
    }),
    (server) => Effect.promise(() => server.stop(true)),
  );
  return {
    port: server.port ?? reportPort,
    address: Effect.sync(() => latest),
    waitForAddress: (seconds) => Deferred.await(first).pipe(Effect.timeoutOrElse({
      duration: `${seconds} seconds`,
      orElse: () => Effect.fail(new MenuFailure({
        operation: "find the menus",
        problem: `no menu page reported to 127.0.0.1:${reportPort} within ${seconds} s; is Warcraft III running with Wisp's menu page installed and "Allow Local Files" set?`,
      })),
    })),
    sent: Effect.sync(() => [...sent]),
  };
});

/** What a waited-for event decides: done with a value, failed with a reason, or not yet (undefined). */
export type Outcome<A> = { readonly done: A } | { readonly failed: string } | undefined;

export interface MenuSocket {
  /** Sends a request the way the menu page does. */
  readonly send: (message: string, payload?: Readonly<Record<string, unknown>>) => Effect.Effect<void, MenuFailure>;
  /** Waits for the first event `decide` settles, ignoring the rest. */
  readonly expect: <A>(what: string, seconds: number, decide: (event: MenuEvent) => Outcome<A>) => Effect.Effect<A, MenuFailure>;
  /** Forgets the events received so far, so a later `expect` sees only answers to what follows. */
  readonly forget: Effect.Effect<void>;
}

const CLOSED: MenuEvent = { messageType: "", payload: undefined };

/** Connects to the menus' socket until the scope closes. */
export const connectMenus = (address: MenuAddress): Effect.Effect<MenuSocket, MenuFailure, Scope.Scope> => Effect.gen(function*() {
  const events = yield* Queue.unbounded<MenuEvent>();
  const socket = yield* Effect.acquireRelease(
    Effect.callback<WebSocket, MenuFailure>((resume) => {
      const origin = `http://127.0.0.1:${address.port}`;
      const opening = new WebSocket(`ws://127.0.0.1:${address.port}/webui-socket/${address.guid}`, { headers: { Origin: origin } });
      let open = false;
      opening.onopen = () => {
        open = true;
        resume(Effect.succeed(opening));
      };
      opening.onmessage = (message) => {
        const envelope = Schema.decodeUnknownOption(Envelope)(parseJson(String(message.data)));
        if (Option.isSome(envelope)) Queue.offerUnsafe(events, { messageType: envelope.value.messageType, payload: envelope.value.payload });
      };
      opening.onclose = () => {
        if (open) Queue.offerUnsafe(events, CLOSED);
        else resume(Effect.fail(new MenuFailure({ operation: "connect to the menus", problem: `127.0.0.1:${address.port} refused the menu socket; the game has restarted or its address is stale` })));
      };
    }),
    (open) => Effect.sync(() => open.close()),
  );
  const send = (message: string, payload: Readonly<Record<string, unknown>> = {}) => Effect.try({
    try: () => socket.send(JSON.stringify({ type: "webui", message, payload })),
    catch: (cause) => new MenuFailure({ operation: `send ${message}`, problem: String(cause) }),
  });
  const expect = <A>(what: string, seconds: number, decide: (event: MenuEvent) => Outcome<A>): Effect.Effect<A, MenuFailure> => {
    const next: Effect.Effect<A, MenuFailure> = Queue.take(events).pipe(Effect.flatMap((event) => {
      if (event === CLOSED) return Effect.fail(new MenuFailure({ operation: what, problem: "the game closed the menu socket" }));
      const outcome = decide(event);
      if (outcome === undefined) return next;
      return "done" in outcome ? Effect.succeed(outcome.done) : Effect.fail(new MenuFailure({ operation: what, problem: outcome.failed }));
    }));
    return next.pipe(Effect.timeoutOrElse({
      duration: `${seconds} seconds`,
      orElse: () => Effect.fail(new MenuFailure({ operation: what, problem: `no answer within ${seconds} s` })),
    }));
  };
  return { send, expect, forget: Queue.clear(events).pipe(Effect.asVoid) };
});

/**
 * The menus' address: from the page's announcements, or, while another Wisp
 * program listens on the report port, from the address it keeps.
 */
export const menuAddress = (reportPort: number, seconds: number): Effect.Effect<MenuAddress, MenuFailure, Scope.Scope> =>
  listenForMenus(reportPort).pipe(
    Effect.flatMap((reports) => reports.waitForAddress(seconds)),
    Effect.catchTag("MenuFailure", (failure) => failure.operation !== "listen for the menu page" ? Effect.fail(failure) : Effect.gen(function*() {
      const deadline = (yield* Clock.currentTimeMillis) + seconds * 1000;
      while (true) {
        const kept = keptAddress(reportPort);
        if (kept !== undefined) return kept;
        if ((yield* Clock.currentTimeMillis) >= deadline) return yield* failure;
        yield* Effect.sleep("250 millis");
      }
    })),
  );

/** Finds this client's installed page. No page means the caller may use its ordinary menu controls. */
export const reportedMenus = (reportPort: number | undefined): Effect.Effect<MenuSocket | undefined, MenuFailure, Scope.Scope> => Effect.gen(function*() {
  if (reportPort === undefined) return undefined;
  const address = yield* menuAddress(reportPort, 3).pipe(Effect.catchTag("MenuFailure", () => Effect.void));
  if (address === undefined) return undefined;
  return yield* connectMenus(address);
});

const record = (value: unknown): Readonly<Record<string, unknown>> => (typeof value === "object" && value !== null ? value as Record<string, unknown> : {});

interface ListedMap {
  readonly filename: string;
  readonly filepath: string;
  readonly isFolder: boolean;
}

const listedMaps = (payload: unknown): ListedMap[] => {
  const maps = record(record(payload)["mapList"])["maps"];
  return (Array.isArray(maps) ? maps : []).map(record).map((entry) => ({
    filename: String(entry["filename"] ?? ""),
    filepath: String(entry["filepath"] ?? ""),
    isFolder: entry["isFolder"] === true,
  }));
};

/** How long a folder's maps may stay unlisted after its subfolders are. */
const MAP_LIST_WAIT_SECONDS = 15;

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
const separator = (path: string) => (path.includes("\\") && !path.includes("/") ? "\\" : "/");
const withSeparator = (path: string) => (/[\\/]$/.test(path) ? path : `${path}${separator(path)}`);
const inFolder = (path: string, folder: string) => path.replaceAll("\\", "/").replace(/\/$/, "").toLowerCase().endsWith(`/${folder.replaceAll("\\", "/").toLowerCase()}`);

/**
 * The menus' path of FOLDER/FILE: the map list is walked as Create Game walks
 * it, because the game refuses a CreateLobby for a map it has not just listed.
 */
export const findMap = (menus: MenuSocket, folder: string, file: string) => Effect.gen(function*() {
  const asked = new Set<string>();
  let request: Readonly<Record<string, unknown>> = { useLastMap: true };
  let waited = 0;
  for (let listing = 0; listing < 4; listing++) {
    yield* menus.forget;
    yield* menus.send("GetMapList", request);
    const maps = yield* menus.expect("list maps", 10, (event) => (event.messageType === "MapList" ? { done: listedMaps(event.payload) } : undefined));
    const map = maps.find((entry) => !entry.isFolder && same(entry.filename, file) && inFolder(entry.filepath, folder));
    if (map !== undefined) return `${withSeparator(map.filepath)}${map.filename}`;
    const sub = maps.find((entry) => entry.isFolder && same(entry.filename, folder));
    // Folders are listed with their parent's absolute path; asking for one takes that path, its name and a separator.
    const inMaps = maps.map((entry) => /^(.*[\\/]Maps[\\/])/i.exec(entry.filepath)?.[1]).find((root) => root !== undefined);
    const next = sub !== undefined ? `${withSeparator(sub.filepath)}${sub.filename}${separator(sub.filepath)}` : inMaps !== undefined ? `${inMaps}${folder.replace(/[\\/]/g, separator(inMaps))}${separator(inMaps)}` : undefined;
    // A game that has just started lists a folder's subfolders before it has read its maps.
    if (maps.length > 0 && maps.every((entry) => entry.isFolder) && inFolder(maps[0]!.filepath, folder) && waited < MAP_LIST_WAIT_SECONDS) {
      waited++;
      listing--;
      yield* Effect.sleep("1 second");
      continue;
    }
    if (next === undefined || asked.has(next)) {
      const seen = maps.slice(0, 12).map((entry) => `${entry.isFolder ? "[folder] " : ""}${entry.filename}`).join(", ");
      return yield* new MenuFailure({ operation: "find the map", problem: `${folder}/${file} is not in the map list (${maps.length} entries${maps.length > 0 ? ` in ${maps[0]!.filepath}: ${seen}` : ""})` });
    }
    asked.add(next);
    request = { subdirectory: next };
  }
  return yield* new MenuFailure({ operation: "find the map", problem: `${folder}/${file} not found after ${asked.size} folders` });
});

export interface HostOptions {
  /** The map's folder under Warcraft III's Maps folder, as Create Game lists it. */
  readonly folder: string;
  readonly file: string;
  readonly gameName: string;
  /** A passworded game is private: it is joined by name and never listed. */
  readonly password: string;
  /** 0 slowest to 2 fast (Warcraft's default); 3 is not offered by the menus. */
  readonly gameSpeed?: 0 | 1 | 2;
}

const lobbyHost = (event: MenuEvent): Outcome<"host" | "refresh"> => {
  if (event.messageType === "GameLobbySetup" && record(event.payload)["isHost"] === true) return { done: "host" };
  if (event.messageType === "SetGlueScreen" && record(event.payload)["screen"] === "GAME_LOBBY") return { done: "refresh" };
  if (event.messageType === "MultiplayerGameCreateResult" && record(record(event.payload)["details"])["success"] === false) return { failed: "the game refused to create the lobby" };
  return undefined;
};

/** Creates a lobby of the map, as Create Game does; returns once the game reports this client hosting it. */
export const hostLobby = (menus: MenuSocket, options: HostOptions) => Effect.gen(function*() {
  const filename = yield* findMap(menus, options.folder, options.file);
  yield* menus.forget;
  yield* menus.send("CreateLobby", {
    filename,
    gameName: options.gameName,
    gameSpeed: options.gameSpeed ?? 2,
    privateGame: options.password !== "",
    password: options.password,
    mapSettings: {
      flagLockTeams: true,
      flagPlaceTeamsTogether: true,
      flagFullSharedUnitControl: false,
      flagRandomRaces: false,
      flagRandomHero: false,
      settingObservers: 0,
      settingVisibility: 0,
    },
  });
  const what = `host "${options.gameName}"`;
  yield* Effect.gen(function*() {
    while ((yield* menus.expect(what, 20, lobbyHost)) === "refresh") {
      // Lobby entry can announce the previous setup first. The menus request the new setup on entry too.
      yield* menus.send("SendGameLobbySetup");
    }
  }).pipe(Effect.timeoutOrElse({
    duration: "20 seconds",
    orElse: () => Effect.fail(new MenuFailure({ operation: what, problem: "the game did not confirm this client hosting within 20 s" })),
  }));
  return filename;
});

/** Joins a lobby by its exact (case-sensitive) name and password; returns once this client is in it. */
export const joinLobby = (menus: MenuSocket, gameName: string, password: string, seconds = 20) => Effect.gen(function*() {
  const what = `join "${gameName}"`;
  const joined = (event: MenuEvent) => event.messageType === "GameLobbySetup" || (event.messageType === "SetGlueScreen" && record(event.payload)["screen"] === "GAME_LOBBY");
  yield* menus.forget;
  yield* menus.send("GetGameList");
  yield* menus.send("JoinGameByGameName", { gameName, gamePass: password, checkForGamePass: true });
  const first = yield* menus.expect(what, seconds, (event) => (joined(event) ? { done: "joined" as const } : event.messageType === "RequestForPassword" ? { done: "password" as const } : undefined));
  if (first === "joined") return;
  // The game asks for the password the way it prompts a player; the answer carries it again.
  yield* menus.send("JoinGameByGameName", { gameName, gamePass: password });
  yield* menus.expect(what, seconds, (event) => (joined(event) ? { done: undefined } : event.messageType === "RequestForPassword" ? { failed: "the game asked for the password again: it is wrong" } : undefined));
});

/** Starts the hosted lobby; returns once the game shows its loading screen. */
export const startLobby = (menus: MenuSocket) => Effect.gen(function*() {
  yield* menus.forget;
  yield* menus.send("LobbyStart");
  yield* menus.expect("start the game", 30, (event) => (event.messageType === "SetGlueScreen" && record(event.payload)["screen"] === "LOADING_SCREEN" ? { done: undefined } : undefined));
});

/** Leaves the current lobby. */
export const leaveLobby = (menus: MenuSocket) => Effect.gen(function*() {
  yield* menus.forget;
  yield* menus.send("LeaveGame");
  yield* menus.expect("leave the lobby", 10, (event) => (event.messageType === "MultiplayerGameLeave" ? { done: undefined } : undefined));
});
