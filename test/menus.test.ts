// Warcraft III's menus without clicks (wisp:docs/driving-warcraft.md): the
// menu page's report, the listener, and each lobby step against a fake game
// that answers the way 3.0.0.24268's menus socket does.
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test } from "bun:test";
import { Effect, Exit } from "effect";
import { type MenuAddress, connectMenus, hostLobby, installMenuPage, joinLobby, keptAddress, leaveLobby, listenForMenus, menuAddress, menuPage, removeMenuPage, startLobby } from "../scripts/wisp/menus";

const GUID = "6f1c2a90-guid";
const MAPS = "C:/Users/player/Documents/Warcraft III/Maps/";
const FOLDERS: Readonly<Record<string, readonly { filename: string; isFolder: boolean }[]>> = {
  [MAPS]: [{ filename: "00-Wisp", isFolder: true }, { filename: "Download", isFolder: true }],
  [`${MAPS}Download/`]: [{ filename: "Other.w3x", isFolder: false }],
  [`${MAPS}00-Wisp/`]: [{ filename: "Wisp Sample.w3x", isFolder: false }],
  [`${MAPS}00-Wisp/tests/`]: [{ filename: "Probe.w3x", isFolder: false }],
};

test("test maps are hosted from a nested tests folder", async () => {
  const game = fakeGame();
  try {
    const result = await Effect.runPromise(Effect.scoped(Effect.gen(function*() {
      const menus = yield* connectMenus(game.address);
      return yield* hostLobby(menus, { folder: "00-Wisp/tests", file: "Probe.w3x", gameName: "probe", password: "pw" });
    })));
    expect(result).toBe(`${MAPS}00-Wisp/tests/Probe.w3x`);
  } finally { game.stop(); }
});

interface Received {
  readonly message: string;
  readonly payload: Record<string, unknown>;
}

/** A game's menus server: the menus' socket at /webui-socket/GUID, answering as the game does. */
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
            // Just after starting, the game lists a folder's subfolders before its maps.
            const entries = folder !== `${MAPS}Download/` && folder !== MAPS && unread-- > 0 ? [{ filename: "older", isFolder: true }] : FOLDERS[folder] ?? [];
            listed = new Set(entries.map((entry) => `${folder}${entry.filename}`));
            // A folder is listed with its parent's path.
            tell("MapList", { mapList: { maps: entries.map((entry) => ({ ...entry, filepath: folder })) } });
            return;
          }
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

test("a folder whose maps the game hasn't read yet is listed again until they appear", async () => {
  const game = fakeGame("immediate", 2);
  try {
    const started = performance.now();
    const result = await Effect.runPromise(Effect.scoped(Effect.gen(function*() {
      const menus = yield* connectMenus(game.address);
      return yield* hostLobby(menus, { folder: "00-Wisp", file: "Wisp Sample.w3x", gameName: "late", password: "pw" });
    })));
    expect(result).toBe(`${MAPS}00-Wisp/Wisp Sample.w3x`);
    expect(game.received.filter(({ message }) => message === "GetMapList").length).toBe(4);
    // Listed again every 250 ms: two unread listings cost half a second, not two.
    expect(performance.now() - started).toBeLessThan(1500);
  } finally { game.stop(); }
});

const games: { stop: () => void }[] = [];
afterEach(() => {
  for (const game of games.splice(0)) game.stop();
});
const started = (hosting?: Parameters<typeof fakeGame>[0]) => {
  const game = fakeGame(hosting);
  games.push(game);
  return game;
};

const run = <A, E>(effect: Effect.Effect<A, E, import("effect").Scope.Scope>) => Effect.runPromiseExit(Effect.scoped(effect));
const failure = (exit: Exit.Exit<unknown, { readonly message: string }>) => (Exit.isFailure(exit) ? String(exit.cause) : "succeeded");

test("hosting ignores the previous non-host setup and requests the current setup on lobby entry", async () => {
  const game = started("old-setup");
  const exit = await run(Effect.gen(function*() {
    const menus = yield* connectMenus(game.address);
    return yield* hostLobby(menus, { folder: "00-Wisp", file: "Wisp Sample.w3x", gameName: "wisp 1", password: "pw" });
  }));
  expect(Exit.isSuccess(exit) ? exit.value : failure(exit)).toBe(`${MAPS}00-Wisp/Wisp Sample.w3x`);
  expect(game.received.map(({ message }) => message)).toEqual(["GetMapList", "GetMapList", "CreateLobby", "SendGameLobbySetup"]);
});

test("an explicit create refusal still fails instead of waiting for a host setup", async () => {
  const game = started("refused");
  const exit = await run(Effect.gen(function*() {
    const menus = yield* connectMenus(game.address);
    return yield* hostLobby(menus, { folder: "00-Wisp", file: "Wisp Sample.w3x", gameName: "wisp 1", password: "pw" });
  }));
  expect(failure(exit)).toContain("the game refused to create the lobby");
});

test("the page loads the game's menus and reports its port and GUID, then the menus' requests while heard", async () => {
  const page = menuPage(47123);
  expect(page).toContain(`<script src="GlueManager.js"></script>`);
  expect(page).toContain(`<div id="root"></div>`);
  expect(page).toContain(`<div id="portal"></div>`);
  const script = /<script>\n([\s\S]*?)<\/script>/.exec(page)?.[1] ?? "";
  const posts: { url: string; body: unknown }[] = [];
  const delivered: string[] = [];
  class NativeSocket {
    constructor(readonly url: string) {}
    send(data: string) {
      delivered.push(data);
    }
  }
  const window: { WebSocket: unknown; __DEBUG?: boolean } = { WebSocket: NativeSocket };
  const fetch = (url: string, init: { body: string }) => {
    posts.push({ url, body: JSON.parse(init.body) });
    return Promise.resolve();
  };
  new Function("window", "location", "fetch", "setTimeout", "URLSearchParams", script)(window, { search: `?guid=${GUID}`, port: "38487" }, fetch, () => 0, URLSearchParams);
  expect(posts).toEqual([{ url: "http://127.0.0.1:47123/menus", body: { port: 38487, guid: GUID } }]);
  await Promise.resolve();
  const Socket = window.WebSocket as new (url: string) => NativeSocket;
  const menus = new Socket(`ws://127.0.0.1:38487/webui-socket/${GUID}`);
  const create = JSON.stringify({ type: "webui", message: "CreateLobby", payload: { gameName: "x" } });
  menus.send(create);
  menus.send(JSON.stringify({ type: "webui", message: "FriendsGetFriends", payload: { secret: 1 } }));
  expect(delivered).toEqual([create, JSON.stringify({ type: "webui", message: "FriendsGetFriends", payload: { secret: 1 } })]);
  expect(posts.slice(1)).toEqual([
    { url: "http://127.0.0.1:47123/sent", body: { message: "CreateLobby", payload: { gameName: "x" } } },
    { url: "http://127.0.0.1:47123/sent", body: { message: "FriendsGetFriends" } },
  ]);
});

test("the listener hears only a page the game served", async () => {
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

test("no report within the wait names what to check", async () => {
  const exit = await run(Effect.gen(function*() {
    const reports = yield* listenForMenus(0);
    return yield* reports.waitForAddress(0.05);
  }));
  expect(failure(exit)).toContain("no menu page reported");
});

test("a lobby is hosted by walking the map list to the map, then started once it settles and left", async () => {
  const game = started();
  let settled = 0;
  const exit = await run(Effect.gen(function*() {
    const menus = yield* connectMenus(game.address);
    const map = yield* hostLobby(menus, { folder: "00-Wisp", file: "wisp sample.w3x", gameName: "wisp 1", password: "pw" });
    const hosted = performance.now();
    yield* startLobby(menus, 300);
    settled = performance.now() - hosted;
    yield* leaveLobby(menus);
    return map;
  }));
  expect(Exit.isSuccess(exit) ? exit.value : failure(exit)).toBe(`${MAPS}00-Wisp/Wisp Sample.w3x`);
  // LobbyStart right after hosting crashed Warcraft III 3.0 while loading (Smashcraft #119).
  expect(settled).toBeGreaterThanOrEqual(290);
  expect(game.received.map(({ message, payload }) => (message === "CreateLobby" ? [message, payload["filename"], payload["privateGame"], payload["password"]] : [message, payload]))).toEqual([
    ["GetMapList", { useLastMap: true }],
    ["GetMapList", { subdirectory: `${MAPS}00-Wisp/` }],
    ["CreateLobby", `${MAPS}00-Wisp/Wisp Sample.w3x`, true, "pw"],
    ["LobbyStart", {}],
    ["LeaveGame", {}],
  ]);
});

test("a map the list doesn't have fails with what the list shows", async () => {
  const game = started();
  const exit = await run(Effect.gen(function*() {
    const menus = yield* connectMenus(game.address);
    return yield* hostLobby(menus, { folder: "00-Wisp", file: "Missing.w3x", gameName: "wisp 1", password: "pw" });
  }));
  expect(failure(exit)).toContain("00-Wisp/Missing.w3x is not in the map list (1 entries in C:/Users/player/Documents/Warcraft III/Maps/00-Wisp/: Wisp Sample.w3x)");
  expect(game.received.map(({ message }) => message)).not.toContain("CreateLobby");
});

test("joining answers the game's password request, and a wrong password fails", async () => {
  const game = started();
  const joined = await run(Effect.gen(function*() {
    const menus = yield* connectMenus(game.address);
    yield* joinLobby(menus, "wisp 1", "pw", 2);
  }));
  expect(Exit.isSuccess(joined) ? "joined" : failure(joined)).toBe("joined");
  expect(game.received.map(({ message, payload }) => [message, payload])).toEqual([
    ["GetGameList", {}],
    ["JoinGameByGameName", { gameName: "wisp 1", gamePass: "pw", checkForGamePass: true }],
    ["JoinGameByGameName", { gameName: "wisp 1", gamePass: "pw" }],
  ]);
  const wrong = await run(Effect.gen(function*() {
    const menus = yield* connectMenus(game.address);
    yield* joinLobby(menus, "wisp 1", "nope", 2);
  }));
  expect(failure(wrong)).toContain("it is wrong");
});

test("a stale address is refused", async () => {
  const game = started();
  const exit = await run(connectMenus({ port: game.address.port, guid: "old-guid" }));
  expect(failure(exit)).toContain("refused the menu socket");
});

test("the page is installed only where Warcraft's own page isn't, and removed only when it is Wisp's", async () => {
  const retail = mkdtempSync(join(tmpdir(), "wisp-retail-"));
  try {
    const page = join(retail, "webui", "index.html");
    expect(failure(await run(installMenuPage(retail)))).toContain("is not Warcraft III's _retail_ folder");
    mkdirSync(join(retail, "x86_64"));
    expect(await Effect.runPromise(installMenuPage(retail, 47200))).toBe(page);
    expect(readFileSync(page, "utf8")).toContain("http://127.0.0.1:47200");
    expect(await Effect.runPromise(removeMenuPage(retail))).toBe(true);
    expect(existsSync(join(retail, "webui"))).toBe(false);
    mkdirSync(join(retail, "webui"));
    writeFileSync(page, "<html>W3Champions</html>");
    expect(failure(await run(installMenuPage(retail)))).toContain("is another program's menu page");
    expect(failure(await run(removeMenuPage(retail)))).toContain("is not Wisp's menu page");
    expect(readFileSync(page, "utf8")).toBe("<html>W3Champions</html>");
  } finally {
    rmSync(retail, { recursive: true, force: true });
  }
});

test("the page keeps the newest screens it heard and announces them, so a later listener knows where the menus are", () => {
  const script = /<script>\n([\s\S]*?)<\/script>/.exec(menuPage(47123))?.[1] ?? "";
  const posts: { url: string; body: unknown }[] = [];
  let listener: ((event: { data: string }) => void) | undefined;
  class NativeSocket {
    constructor(readonly url: string) {}
    send() {}
    addEventListener(_: string, heard: (event: { data: string }) => void) {
      listener = heard;
    }
  }
  const window: { WebSocket: unknown } = { WebSocket: NativeSocket };
  const fetch = (url: string, init: { body: string }) => {
    posts.push({ url, body: JSON.parse(init.body) });
    return Promise.resolve();
  };
  const timers: (() => void)[] = [];
  const delays: number[] = [];
  new Function("window", "location", "fetch", "setTimeout", "URLSearchParams", script)(window, { search: `?guid=${GUID}`, port: "38487" }, fetch, (next: () => void, delay: number) => { timers.push(next); delays.push(delay); }, URLSearchParams);
  // Every half second, so a program that starts listening finds the menus within it.
  expect(delays).toEqual([500]);
  const socket = new (window.WebSocket as new (url: string) => NativeSocket)(`ws://127.0.0.1:38487/webui-socket/${GUID}`);
  for (const [messageType, payload] of [["SetGlueScreen", { screen: "CUSTOM_LOBBIES" }], ["MapList", { mapList: {} }], ["GameLobbySetup", { isHost: true, players: [] }]] as const) {
    listener!({ data: JSON.stringify({ messageType, payload }) });
  }
  socket.send(JSON.stringify({ message: "ScreenTransitionInfo", payload: { screen: "CREATE_GAME", type: "Screen" } }));
  socket.send(JSON.stringify({ message: "ScreenTransitionInfo", payload: { screen: "OPTIONS", type: "Overlay" } }));
  timers.shift()!();
  const announced = posts.at(-1)!.body as { recent: { messageType: string; screen?: string; isHost?: boolean; at: number }[] };
  expect(announced.recent.map(({ at: _, ...heard }) => heard)).toEqual([{ messageType: "SetGlueScreen", screen: "CUSTOM_LOBBIES" }, { messageType: "GameLobbySetup", isHost: true }, { messageType: "ScreenTransitionInfo", screen: "CREATE_GAME", type: "Screen" }]);
});

test("a second program finds the menus through the address the port's listener keeps", async () => {
  const runtime = mkdtempSync(join(tmpdir(), "wisp-runtime-"));
  const previous = process.env["XDG_RUNTIME_DIR"];
  process.env["XDG_RUNTIME_DIR"] = runtime;
  try {
    const exit = await run(Effect.gen(function*() {
      const reports = yield* listenForMenus(0);
      yield* Effect.promise(() => fetch(`http://127.0.0.1:${reports.port}/menus`, {
        method: "POST",
        headers: { origin: "http://127.0.0.1:38487" },
        body: JSON.stringify({ port: 38487, guid: GUID, recent: [{ messageType: "SetGlueScreen", screen: "GAME_LOBBY", at: 5 }] }),
      }));
      // The port is taken: the address comes from the file.
      return yield* menuAddress(reports.port, 1);
    }));
    expect(Exit.isSuccess(exit) ? exit.value : failure(exit)).toEqual({ port: 38487, guid: GUID, recent: [{ messageType: "SetGlueScreen", screen: "GAME_LOBBY", at: 5 }] });
    expect(keptAddress(1, Date.now())).toBeUndefined();
  } finally {
    if (previous === undefined) delete process.env["XDG_RUNTIME_DIR"];
    else process.env["XDG_RUNTIME_DIR"] = previous;
    rmSync(runtime, { recursive: true });
  }
});
