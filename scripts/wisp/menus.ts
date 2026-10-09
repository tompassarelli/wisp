








import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, rmdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { Clock, Console, Deferred, Effect, Option, Queue, Schema, type Scope } from "effect";
import { pollFor } from "./hostProcess";
import { DEFAULT_BUILD, profileFor, requireCapability } from "./builds";
import { loadLanPlugin, lanPluginProblem } from "./lan/plugin";


export const DEFAULT_MENU_REPORT_PORT = 47123;

export class MenuFailure extends Schema.TaggedError<MenuFailure>()("MenuFailure", {
  operation: Schema.String,
  problem: Schema.String,
}) {
  override get message(): string {
    return `${this.operation}: ${this.problem}`;
  }
}


export interface MenuAddress {
  readonly buildId?: string;
  readonly port: number;
  readonly guid: string;

  readonly recent?: readonly HeardMessage[];
}


export interface HeardMessage {
  readonly messageType: string;
  readonly at: number;
  readonly screen?: string;
  readonly type?: string;
  readonly isHost?: boolean;
}


export interface SentMessage {
  readonly message: string;
  readonly payload?: unknown;
}


export interface MenuEvent {
  readonly messageType: string;
  readonly payload: unknown;
}

const PAGE_MARK = `<meta name="wisp" content="menu page" />`;

const REPORTED_PAYLOADS = "Lobby|Slot|Computer|Team|Race|Color|Handicap|Map|Start|Join|ScreenTransitionInfo";

const PAGE_STATES = "SetGlueScreen|GameLobbySetup|UpdateScoreInfo|LoggedOut";
const RECENT_KEPT = 4;

const ANNOUNCE_MS = 500;







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
          setTimeout(announce, ${ANNOUNCE_MS});
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






export const menuAddressFile = (reportPort: number) => join(process.env["XDG_RUNTIME_DIR"] ?? tmpdir(), `wisp-menus-${reportPort}.json`);

const ADDRESS_FRESH_MS = 6000;
const KeptAddress = Schema.Struct({ port: Schema.Int, guid: Schema.String, recent: Schema.optionalKey(Schema.Array(Heard)), at: Schema.Finite });

const keepAddress = (reportPort: number, address: MenuAddress) => {
  try {
    const path = menuAddressFile(reportPort);
    writeFileSync(`${path}.new`, JSON.stringify({ ...address, at: Date.now() }), { mode: 0o600 });
    renameSync(`${path}.new`, path);
  } catch {

  }
};


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

  readonly port: number;

  readonly address: Effect.Effect<MenuAddress | undefined>;

  readonly waitForAddress: (seconds: number) => Effect.Effect<MenuAddress, MenuFailure>;

  readonly sent: Effect.Effect<readonly SentMessage[]>;
}






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


export type Outcome<A> = { readonly done: A } | { readonly failed: string } | undefined;

export interface MenuSocket {
  readonly buildId?: string;

  readonly send: (message: string, payload?: Readonly<Record<string, unknown>>) => Effect.Effect<void, MenuFailure>;

  readonly expect: <A>(what: string, seconds: number, decide: (event: MenuEvent) => Outcome<A>) => Effect.Effect<A, MenuFailure>;

  readonly forget: Effect.Effect<void>;
}

const CLOSED: MenuEvent = { messageType: "", payload: undefined };


export const connectMenus = (address: MenuAddress): Effect.Effect<MenuSocket, MenuFailure, Scope.Scope> => Effect.gen(function*() {
  const buildId = address.buildId ?? process.env["WISP_GAME_BUILD"] ?? (lanPluginProblem() === undefined ? (yield* loadLanPlugin.pipe(Effect.mapError((cause) => new MenuFailure({ operation: "detect menu build", problem: cause.message })))).versionForPort?.(address.port) : undefined);
  if (buildId !== undefined) yield* requireCapability(buildId, "menuDriving").pipe(Effect.mapError((cause) => new MenuFailure({ operation: "drive menus", problem: cause.message })));
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
  return { ...(buildId === undefined ? {} : { buildId }), send, expect, forget: Queue.clear(events).pipe(Effect.asVoid) };
});





export const menuAddress = (reportPort: number, seconds: number): Effect.Effect<MenuAddress, MenuFailure, Scope.Scope> =>
  listenForMenus(reportPort).pipe(
    Effect.flatMap((reports) => reports.waitForAddress(seconds)),
    Effect.catchTag("MenuFailure", (failure) => failure.operation !== "listen for the menu page" ? Effect.fail(failure) : pollFor(seconds, "250 millis", Effect.sync(() => keptAddress(reportPort))).pipe(
      Effect.filterOrFail((kept): kept is MenuAddress => kept !== undefined, () => failure),
    )),
  );


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


const MAP_LIST_WAIT_SECONDS = 15;

export const MAP_LIST_SECONDS = 90;
const MAP_LIST_RETRY_MS = 250;

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
const separator = (path: string) => (path.includes("\\") && !path.includes("/") ? "\\" : "/");
const withSeparator = (path: string) => (/[\\/]$/.test(path) ? path : `${path}${separator(path)}`);
const inFolder = (path: string, folder: string) => path.replaceAll("\\", "/").replace(/\/$/, "").toLowerCase().endsWith(`/${folder.replaceAll("\\", "/").toLowerCase()}`);





export const findMap = (menus: MenuSocket, folder: string, file: string) => Effect.gen(function*() {
  const asked = new Set<string>();
  let request: Readonly<Record<string, unknown>> = { useLastMap: true };
  let waited = 0;
  for (let listing = 0; listing < 4; listing++) {
    yield* menus.forget;
    yield* menus.send("GetMapList", request);
    if (listing === 0) yield* Console.log(`listing maps for ${folder}/${file} (Warcraft III reads every map first; up to ${MAP_LIST_SECONDS} s)`);
    const maps = yield* menus.expect("list maps", MAP_LIST_SECONDS, (event) => (event.messageType === "MapList" ? { done: listedMaps(event.payload) } : undefined));
    const map = maps.find((entry) => !entry.isFolder && same(entry.filename, file) && inFolder(entry.filepath, folder));
    if (map !== undefined) return `${withSeparator(map.filepath)}${map.filename}`;
    const sub = maps.find((entry) => entry.isFolder && same(entry.filename, folder));

    const inMaps = maps.map((entry) => /^(.*[\\/]Maps[\\/])/i.exec(entry.filepath)?.[1]).find((root) => root !== undefined);
    const next = sub !== undefined ? `${withSeparator(sub.filepath)}${sub.filename}${separator(sub.filepath)}` : inMaps !== undefined ? `${inMaps}${folder.replace(/[\\/]/g, separator(inMaps))}${separator(inMaps)}` : undefined;

    if (maps.length > 0 && maps.every((entry) => entry.isFolder) && inFolder(maps[0]!.filepath, folder) && waited < MAP_LIST_WAIT_SECONDS * 1000) {
      waited += MAP_LIST_RETRY_MS;
      listing--;
      yield* Effect.sleep(`${MAP_LIST_RETRY_MS} millis`);
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

  readonly folder: string;
  readonly file: string;
  readonly gameName: string;

  readonly password: string;

  readonly gameSpeed?: 0 | 1 | 2;
}

const lobbyHost = (event: MenuEvent): Outcome<"host" | "refresh"> => {
  if (event.messageType === "GameLobbySetup" && record(event.payload)["isHost"] === true) return { done: "host" };
  if (event.messageType === "SetGlueScreen" && record(event.payload)["screen"] === "GAME_LOBBY") return { done: "refresh" };
  if (event.messageType === "MultiplayerGameCreateResult" && record(record(event.payload)["details"])["success"] === false) return { failed: "the game refused to create the lobby" };
  return undefined;
};


export const hostLobby = (menus: MenuSocket, options: HostOptions) => Effect.gen(function*() {
  const filename = yield* findMap(menus, options.folder, options.file);
  const password = options.password === "" ? randomBytes(6).toString("hex") : options.password;
  yield* menus.forget;
  yield* menus.send("CreateLobby", {
    filename,
    gameName: options.gameName,
    gameSpeed: options.gameSpeed ?? 2,
    privateGame: true,
    password,
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

      yield* menus.send("SendGameLobbySetup");
    }
  }).pipe(Effect.timeoutOrElse({
    duration: "20 seconds",
    orElse: () => Effect.fail(new MenuFailure({ operation: what, problem: "the game did not confirm this client hosting within 20 s" })),
  }));
  hostedAt.set(menus, yield* Clock.currentTimeMillis);
  return filename;
});








export const LOBBY_SETTLE_MS = profileFor(DEFAULT_BUILD)!.menus.lobbySettleMs;
const hostedAt = new WeakMap<MenuSocket, number>();


export const joinLobby = (menus: MenuSocket, gameName: string, password: string, seconds = 20) => Effect.gen(function*() {
  const what = `join "${gameName}"`;
  const joined = (event: MenuEvent) => event.messageType === "GameLobbySetup" || (event.messageType === "SetGlueScreen" && record(event.payload)["screen"] === "GAME_LOBBY");
  yield* menus.forget;
  yield* menus.send("GetGameList");
  yield* menus.send("JoinGameByGameName", { gameName, gamePass: password, checkForGamePass: true });
  const first = yield* menus.expect(what, seconds, (event) => (joined(event) ? { done: "joined" as const } : event.messageType === "RequestForPassword" ? { done: "password" as const } : undefined));
  if (first === "joined") return;

  yield* menus.send("JoinGameByGameName", { gameName, gamePass: password });
  yield* menus.expect(what, seconds, (event) => (joined(event) ? { done: undefined } : event.messageType === "RequestForPassword" ? { failed: "the game asked for the password again: it is wrong" } : undefined));
});





export const startLobby = (menus: MenuSocket, settleMs = profileFor(menus.buildId ?? DEFAULT_BUILD)?.menus.lobbySettleMs ?? LOBBY_SETTLE_MS) => Effect.gen(function*() {
  if (menus.buildId !== undefined) yield* requireCapability(menus.buildId, "menuDriving").pipe(Effect.mapError((cause) => new MenuFailure({ operation: "start lobby", problem: cause.message })));
  const hosted = hostedAt.get(menus);
  if (hosted !== undefined) {
    const wait = hosted + settleMs - (yield* Clock.currentTimeMillis);
    if (wait > 0) yield* Effect.sleep(`${wait} millis`);
  }
  yield* menus.forget;
  yield* menus.send("LobbyStart");
  yield* menus.expect("start the game", 30, (event) => (event.messageType === "SetGlueScreen" && record(event.payload)["screen"] === "LOADING_SCREEN" ? { done: undefined } : undefined));
});


export const leaveLobby = (menus: MenuSocket) => Effect.gen(function*() {
  yield* menus.forget;
  yield* menus.send("LeaveGame");
  yield* menus.expect("leave the lobby", 10, (event) => (event.messageType === "MultiplayerGameLeave" ? { done: undefined } : undefined));
});

export interface LocalGameOptions {

  readonly folder: string;
  readonly file: string;

  readonly playerName: string;
}








export const playLocalGame = (menus: MenuSocket, options: LocalGameOptions) => Effect.gen(function*() {
  yield* menus.forget;
  yield* menus.send("LoginDoorClose");
  yield* menus.send("InitializeLocalNetProvider");

  yield* menus.expect("use the local provider", 60, (event) => (event.messageType === "OnNetProviderChanged" && record(event.payload)["providerId"] === "LOOP" ? { done: undefined } : undefined));
  yield* menus.send("SetLocalPlayerName", { playerName: options.playerName });
  yield* hostLobby(menus, { folder: options.folder, file: options.file, gameName: "Single Player", password: "" });
  yield* startLobby(menus);
  yield* menus.expect("load the map", 300, (event) => (event.messageType === "MapLoadComplete" ? { done: undefined } : undefined));

  yield* menus.send("LoadingScreenGameStart");
  yield* menus.expect("show the game", 60, (event) => (event.messageType === "IsGameUIActive" && String(record(event.payload)["isActive"]) === "true" ? { done: undefined } : undefined));
});
