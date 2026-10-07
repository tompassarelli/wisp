import { Effect, Exit, Layer } from "effect";
import { expect, test } from "bun:test";
import { Clients, type Client } from "../scripts/wisp/clients";
import { dataDirectory, GameFiles, type StoredFile } from "../scripts/wisp/gameFiles";
import { freshMatch } from "../scripts/wisp/lobby";
import { ClientWatch, type ClientView } from "../scripts/wisp/watch";

const started = 'function PreloadFiles takes nothing returns nothing\n\tcall PreloadStart()\n\tcall Preload( "applied 0 at 0" )\nendfunction\n';

/** A fake menu page for one client: it announces its socket on the report port and answers as the game's menus do. */
const fakePage = (name: string, sent: string[], game: { host?: { password: unknown; privateGame: unknown }; startedAt?: number }) => {
  const reservation = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response() });
  const menuReportPort = reservation.port!;
  reservation.stop(true);
  const server = Bun.serve<undefined>({
    hostname: "127.0.0.1", port: 0,
    fetch: (request, server) => (server.upgrade(request) ? undefined : new Response("not found", { status: 404 })),
    websocket: {
      message(socket, data) {
        const { message, payload } = JSON.parse(String(data)) as { message: string; payload?: Record<string, unknown> };
        sent.push(`${name}:${message}`);
        const tell = (messageType: string, body: unknown) => socket.send(JSON.stringify({ messageType, payload: body }));
        if (message === "GetMapList") tell("MapList", { mapList: { maps: [{ filename: "sample.w3x", filepath: "C:/Maps/00-Wisp/", isFolder: false }] } });
        if (message === "CreateLobby") {
          game.host = { password: payload?.["password"], privateGame: payload?.["privateGame"] };
          tell("GameLobbySetup", { isHost: false });
          tell("SetGlueScreen", { screen: "GAME_LOBBY" });
        }
        if (message === "SendGameLobbySetup") tell("GameLobbySetup", { isHost: true });
        if (message === "JoinGameByGameName") {
          // A guest without the host's password is asked for it and stays out.
          if (game.host === undefined || payload?.["gamePass"] !== game.host.password) tell("RequestForPassword", {});
          else tell("GameLobbySetup", { isHost: false });
        }
        if (message === "LobbyStart") {
          game.startedAt = Date.now() + 1;
          tell("SetGlueScreen", { screen: "LOADING_SCREEN" });
        }
      },
    },
  });
  const announce = setInterval(() => {
    void fetch(`http://127.0.0.1:${menuReportPort}/menus`, {
      method: "POST", headers: { origin: `http://127.0.0.1:${server.port}` },
      body: JSON.stringify({ port: server.port, guid: "lobby-test-guid" }),
    }).catch(() => {});
  }, 10);
  return { menuReportPort, stop: () => { clearInterval(announce); server.stop(true); } };
};

const run = async (pages: readonly [boolean, boolean]) => {
  const sent: string[] = [];
  const game: { host?: { password: unknown; privateGame: unknown }; startedAt?: number } = {};
  const running = pages.map((enabled, slot) => (enabled ? fakePage(slot === 0 ? "a" : "b", sent, game) : undefined));
  const clients = (["a", "b"] as const).map((name, slot): Client => ({
    name, documents: `/${name}/Documents/Warcraft III`, ...(running[slot] === undefined ? {} : { menuReportPort: running[slot].menuReportPort }),
  })) as unknown as readonly [Client, Client];
  const inputs: string[] = [];
  const driver = Clients.of({
    all: clients,
    read: () => Effect.succeed(""), capture: () => Effect.die("no capture"), words: () => Effect.succeed([]),
    click: (client, x, y) => Effect.sync(() => { inputs.push(`${client.name}:click ${x},${y}`); }),
    keys: (client, ...names) => Effect.sync(() => { inputs.push(`${client.name}:${names.join(" ")}`); }),
    typeText: (client, text) => Effect.sync(() => { inputs.push(`${client.name}:type ${text}`); }),
    batch: (client) => Effect.sync(() => { inputs.push(`${client.name}:batch`); }),
  });
  const files = GameFiles.of({
    // The client in slot N acknowledges the match start as slot N.
    read: (path): Effect.Effect<StoredFile | undefined> => Effect.sync(() => {
      const writer = clients.findIndex(({ documents }, slot) => path === `${dataDirectory(documents)}/sample-hot-ack-p${slot}.txt`);
      return writer < 0 || game.startedAt === undefined ? undefined : { text: started, modified: game.startedAt };
    }),
    write: () => Effect.void, replace: () => Effect.void, remove: () => Effect.void,
    list: () => Effect.succeed([]), installMap: () => Effect.void,
  });
  const watch = ClientWatch.of({ view: () => Effect.succeed({ state: { kind: "menus", screen: "CUSTOM_LOBBIES" } } as unknown as ClientView) });
  try {
    const exit = await Effect.runPromiseExit(freshMatch({ map: "/maps/sample.w3x", folder: "00-Wisp", filePrefix: "sample" }).pipe(
      Effect.provide(Layer.mergeAll(Layer.succeed(Clients, driver), Layer.succeed(GameFiles, files), Layer.succeed(ClientWatch, watch))),
    ));
    return { exit, sent, game, inputs };
  } finally {
    for (const page of running) page?.stop();
  }
};

test("a fresh match hosts a private game through the host's page, joins it with its password, and waits for every start acknowledgement", async () => {
  const { exit, sent, game, inputs } = await run([true, true]);
  expect(Exit.isSuccess(exit)).toBe(true);
  expect(game.host?.privateGame).toBe(true);
  expect(game.host?.password).toMatch(/^[0-9a-f]{8}$/);
  expect(sent).toContain("a:CreateLobby");
  expect(sent).toContain("b:JoinGameByGameName");
  expect(sent.indexOf("a:LobbyStart")).toBeGreaterThan(sent.indexOf("b:JoinGameByGameName"));
  // Nothing is clicked or typed.
  expect(inputs).toEqual([]);
}, 15_000);

test("a client without a reporting page stops the fresh match before anything is hosted", async () => {
  const { exit, sent, inputs } = await run([true, false]);
  expect(Exit.isFailure(exit) && String(exit.cause)).toContain("no menu page reported for b");
  expect(sent.filter((message) => message.endsWith("CreateLobby"))).toEqual([]);
  expect(inputs).toEqual([]);
}, 15_000);
