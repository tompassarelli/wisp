


import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test } from "bun:test";
import { Effect, Exit } from "effect";
import { type MenuAddress, connectMenus, hostLobby, installMenuPage, leaveLobby, listenForMenus, menuPage, removeMenuPage, startLobby } from "../scripts/wisp/menus";

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
    const map = yield* hostLobby(menus, { folder: "00-Wisp", file: "wisp sample.w3x", gameName: "wisp 1", password: "pw" });
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

test("[invariant] the page is installed only where Warcraft's own page isn't, and removed only when it is Wisp's", async () => {
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

test("[invariant] the page keeps the newest screens it heard and announces them, so a later listener knows where the menus are", () => {
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
  new Function("window", "location", "fetch", "setTimeout", "URLSearchParams", script)(window, { search: `?guid=${GUID}`, port: "38487" }, fetch, (next: () => void) => { timers.push(next); }, URLSearchParams);
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
