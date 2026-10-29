import { afterEach, expect, test } from "bun:test";
import { TestClock } from "effect/testing";
import { PlayDesktop, PlayMachine, play, type PlayDeclaration } from "../host/play/play";
import { ClientWatch, type ClientState } from "../host/dev/watch";
import { Effect, Exit, Fiber, Layer } from "effect";
import { type MenuAddress, connectMenus, hostLocalLobby, hostLobby, leaveLobby, listenForMenus, startLobby } from "../host/lan/menus";

const GUID = "6f1c2a90-guid";
const MAPS = "C:/Users/player/Documents/Warcraft III/Maps/";
const FOLDERS: Readonly<Record<string, readonly { filename: string; isFolder: boolean }[]>> = {
  [MAPS]: [{ filename: "00-Wisp", isFolder: true }, { filename: "Download", isFolder: true }],
  [`${MAPS}Download/`]: [{ filename: "Other.w3x", isFolder: false }],
  [`${MAPS}00-Wisp/`]: [{ filename: "Wisp Sample.w3x", isFolder: false }],
  [`${MAPS}00-Wisp/tests/`]: [{ filename: "Probe.w3x", isFolder: false }],
};

interface Received {
  readonly message: string;
  readonly payload: Record<string, unknown>;
}

function fakeGame(hosting: "immediate" | "old-setup" | "refused" = "immediate", unreadListings = 0) {
  const received: Received[] = [];
  let unread = unreadListings;
  const sockets = new Set<Bun.ServerWebSocket<undefined>>();
  let listed = new Set<string>();
  const tell = (messageType: string, payload: unknown) => {
    for (const socket of sockets) socket.send(JSON.stringify({ messageType, payload }));
  };
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(request, serving) {
      const url = new URL(request.url);
      if (url.pathname === `/webui-socket/${GUID}` && serving.upgrade(request)) return undefined;
      return new Response("not found", { status: 404 });
    },
    websocket: {
      open(socket) {
        sockets.add(socket);
      },
      close(socket) {
        sockets.delete(socket);
      },
      message(_socket, data) {
        const { type, message, payload } = JSON.parse(String(data)) as { type: string; message: string; payload: Record<string, unknown> };
        if (type !== "webui") return;
        received.push({ message, payload });
        tell("FriendsFriendUpdated", {});
        switch (message) {
          case "GetMapList": {
            const folder = payload["useLastMap"] === true ? `${MAPS}Download/` : String(payload["subdirectory"]);

            const entries = folder !== `${MAPS}Download/` && folder !== MAPS && unread-- > 0 ? [{ filename: "older", isFolder: true }] : FOLDERS[folder] ?? [];
            listed = new Set(entries.map((entry) => `${folder}${entry.filename}`));

            tell("MapList", { mapList: { maps: entries.map((entry) => ({ ...entry, filepath: folder })) } });
            return;
          }
          case "InitializeLocalNetProvider":
            tell("OnNetProviderChanged", { providerId: "LOOP" });
            return;
          case "CreateLobby":
            if (hosting === "refused") tell("MultiplayerGameCreateResult", { details: { success: false } });
            else if (hosting === "old-setup") {
              tell("GameLobbySetup", { isHost: false });
              tell("SetGlueScreen", { screen: "GAME_LOBBY" });
            }
            else if (listed.has(String(payload["filename"]))) tell("GameLobbySetup", { isHost: true });
            else tell("MultiplayerGameCreateResult", { details: { success: false } });
            return;
          case "SendGameLobbySetup":
            tell("GameLobbySetup", { isHost: true });
            return;
          case "JoinGameByGameName":
            if (payload["checkForGamePass"] === true || payload["gamePass"] !== "pw") tell("RequestForPassword", {});
            else tell("GameLobbySetup", { isHost: false });
            return;
          case "LobbyStart":
            tell("SetGlueScreen", { screen: "LOADING_SCREEN" });
            return;
          case "LeaveGame":
            tell("MultiplayerGameLeave", {});
            return;
        }
      },
    },
  });
  return { received, address: { port: server.port!, guid: GUID } satisfies MenuAddress, stop: () => server.stop(true) };
}

const games: { stop: () => void }[] = [];
afterEach(() => {
  for (const game of games.splice(0)) game.stop();
});
const started = (hosting?: Parameters<typeof fakeGame>[0], unreadListings?: number) => {
  const game = fakeGame(hosting, unreadListings);
  games.push(game);
  return game;
};

const run = <A, E>(effect: Effect.Effect<A, E, import("effect").Scope.Scope>) => Effect.runPromiseExit(Effect.scoped(effect));
const failure = (exit: Exit.Exit<unknown, { readonly message: string }>) => (Exit.isFailure(exit) ? String(exit.cause) : "succeeded");

test("[invariant] the listener hears only a page the game served", async () => {
  const exit = await run(Effect.gen(function*() {
    const reports = yield* listenForMenus(0);
    const post = (origin: string | undefined, body: unknown) => Effect.promise(() => fetch(`http://127.0.0.1:${reports.port}/menus`, {
      method: "POST",
      headers: origin === undefined ? {} : { origin },
      body: JSON.stringify(body),
    }).then((response) => response.status));
    const statuses = [
      yield* post("https://example.com", { port: 38487, guid: GUID }),
      yield* post(undefined, { port: 38487, guid: GUID }),
      yield* post("http://127.0.0.1:38487", { port: 38487, guid: "../../etc" }),
      yield* post("http://127.0.0.1:38487", { port: 38487, guid: GUID }),
    ];
    return { statuses, address: yield* reports.waitForAddress(1) };
  }));
  expect(Exit.isSuccess(exit) ? exit.value : failure(exit)).toEqual({ statuses: [403, 403, 400, 204], address: { port: 38487, guid: GUID } });
});

test("[scenario] hosting lists a folder again until the game has read its maps, and starts the lobby only once it settles", async () => {
  const game = started("immediate", 2);
  let settled = 0;
  const exit = await run(Effect.gen(function*() {
    const menus = yield* connectMenus(game.address);
    const map = yield* hostLocalLobby(menus, { folder: "00-Wisp", file: "wisp sample.w3x", playerName: "Player" });
    expect(game.received.some(({ message }) => ["LobbyStart", "StartGame", "LoadingScreenGameStart"].includes(message))).toBe(false);
    const hosted = performance.now();
    yield* startLobby(menus, 300);
    settled = performance.now() - hosted;
    yield* leaveLobby(menus);
    return map;
  }));
  expect(Exit.isSuccess(exit) ? exit.value : failure(exit)).toBe(`${MAPS}00-Wisp/Wisp Sample.w3x`);
  expect(game.received.filter(({ message }) => message === "GetMapList").length).toBe(4);
  // LobbyStart immediately after hosting can crash Warcraft while loading.
  expect(settled).toBeGreaterThanOrEqual(290);
});

function playHarness(port: number, state: ClientState, updating = false) {
  const calls: string[] = [];
  const prefix = "/observed/play/pfx";
  const log = "battle.net-20261014T110000.1.log";
  const machine = PlayMachine.of({
    processes: Effect.succeed([
      { pid: 39, name: "steam", args: ["steam"] },
      { pid: 40, name: "Battle.net", args: ["C:\\Battle.net\\Battle.net.exe"], prefix },
      ...(updating ? [] : [{ pid: 41, name: "Warcraft III", args: ["C:\\Warcraft III.exe"], prefix }]),
    ]),
    serverDirectory: () => Effect.succeed("server"),
    signal: () => Effect.sync(() => { calls.push("signal"); }),
    launch: () => Effect.sync(() => { calls.push("launch"); }),
    openSteam: () => Effect.sync(() => { calls.push("Steam"); }),
    start: () => Effect.sync(() => { calls.push("start"); return 42; }),
    startService: () => Effect.void,
    startLock: () => Effect.succeed(Effect.void),
    read: (path) => Effect.succeed(path.endsWith(log) ? "[BNLogin] Logged into Battle.net successfully" : path.endsWith("Battle.net.config") ? "{}" : path.endsWith("War3Preferences.txt") ? "[Misc]\nhd=0\n" : undefined),
    size: () => Effect.succeed(0),
    modified: () => Effect.succeed(0),
    digest: () => Effect.succeed("unchanged"),
    list: () => Effect.succeed([log]),
    write: () => Effect.void,
    copy: () => Effect.void,
  });
  const window = { id: 1, title: "Warcraft III", appId: "steam_app_1", focused: true, width: 800, height: 600, output: { name: "screen", width: 800, height: 600 } };
  const desktop = PlayDesktop.of({
    windows: Effect.succeed([window, { ...window, id: 2, title: "Battle.net" }, { ...window, id: 3, title: "Steam" }]),
    focus: () => Effect.void,
    toggleFullscreen: () => Effect.void,
    read: () => Effect.succeed({ width: 800, height: 600, words: [] }),
    capture: () => Effect.sync(() => { calls.push("capture"); }),
    xWindow: () => Effect.succeed({ id: "1", x: 0, y: 0, width: 800, height: 600 }),
    keys: () => Effect.sync(() => { calls.push("keys"); }),
  });
  const declaration: PlayDeclaration = {
    prefix, display: ":fake", shortcut: { appId: 1, name: "fake" },
    map: { folder: "00-Wisp/tests", file: "Probe.w3x", title: "requested probe" },
    gameName: "Player", menuReportPort: port, graphicsMode: "classic",
    prepare: () => Effect.sync(() => { calls.push("prepare"); }),
    cleanup: () => Effect.void,
    started: () => Effect.sync(() => { calls.push("started"); }),
    match: () => Effect.sync(() => { calls.push("match"); return "started"; }),
    helper: { service: () => Effect.succeed("connected") },
  };
  const watch = ClientWatch.of({ view: (client) => Effect.succeed({ client: client.name, state, source: "socket", evidence: "fake menu socket", at: Date.now(), scan: "done", loadErrors: { count: 0 } }) });
  return { calls, run: (print: (line: string) => void) => play(declaration, print, { lobbyOnly: true }).pipe(Effect.provide(Layer.mergeAll(Layer.succeed(PlayMachine, machine), Layer.succeed(PlayDesktop, desktop), Layer.succeed(ClientWatch, watch)))) };
}

test("[scenario] lobby-only reuses the running client, hosts the requested map without starting, and refuses a match or a timed-out update", async () => {
  const game = started();
  const lines: string[] = [];
  await Effect.runPromise(Effect.scoped(Effect.gen(function*() {
    const reports = yield* listenForMenus(0);
    yield* Effect.promise(() => fetch(`http://127.0.0.1:${reports.port}/menus`, { method: "POST", headers: { origin: `http://127.0.0.1:${game.address.port}` }, body: JSON.stringify(game.address) }));
    const ready = playHarness(reports.port, { kind: "menus", screen: "MAIN_MENU" });
    yield* ready.run((line) => lines.push(line));
    expect(ready.calls).toEqual(["prepare", "capture"]);
    expect(game.received.find(({ message }) => message === "CreateLobby")?.payload["filename"]).toBe(`${MAPS}00-Wisp/tests/Probe.w3x`);
    expect(game.received.some(({ message }) => ["LobbyStart", "StartGame", "LoadingScreenGameStart"].includes(message))).toBe(false);
    expect(lines.some((line) => line.startsWith("LOBBY-READY Probe.w3x screenshot="))).toBe(true);
    const occupied = playHarness(reports.port, { kind: "in match" });
    const refused = yield* occupied.run((line) => lines.push(line)).pipe(Effect.exit);
    expect(Exit.isFailure(refused)).toBe(true);
    expect(occupied.calls).toEqual([]);
    const updating = playHarness(reports.port, { kind: "menus", screen: "MAIN_MENU" }, true);
    const timeout = yield* Effect.gen(function*() {
      const fiber = yield* updating.run((line) => lines.push(line)).pipe(Effect.forkChild);
      yield* TestClock.adjust("601 seconds");
      return yield* Fiber.await(fiber);
    }).pipe(Effect.provide(TestClock.layer()));
    expect(failure(timeout)).toContain("update wait timed out");
    expect(updating.calls).toEqual(["prepare", "launch"]);
  })));
});
