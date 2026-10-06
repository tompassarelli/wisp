// A fresh match of a map in every signed-in client: each client leaves
// wherever it is, the first hosts a new custom game, the others join it by
// name, and the host starts it. Create Game selects the first map of the
// folder its list has open, and Warcraft keeps that folder for the session, so
// GameFiles installs the map as the only map of its configured folder. Screen
// positions are for the 2560x1440 client frame. With a ClientWatch provided, a
// client that crashes or loses Battle.net stops the match at once.
import { join } from "node:path";
import { Clock, Effect } from "effect";
import { ackFile } from "../../src/runtime/gameFiles";
import { Acknowledgement, FILE_SLOT_NUMBERS, type MalformedGameFile } from "./boundary";
import { type Client, Clients, type DesktopFailure, waitFor, waitForText } from "./clients";
import { GameFiles, dataDirectory, prepareHotFolders, readGameFile } from "./gameFiles";
import { step } from "./timings";
import { unlessLost } from "./watch";

// Regions of the frame where each screen's identifying label appears.
export const GAME_MENU = { x: 1100, y: 180, width: 420, height: 50 };
// The score screen slides in; its title settles about 40 px above where it first appears.
export const RESULTS = { x: 150, y: 50, width: 420, height: 110 };
export const CUSTOM_GAMES = { x: 1440, y: 1180, width: 340, height: 60 };
// Read as "REATE GAME": the stylised first letter is not recognized.
export const CREATE_TITLE = { x: 150, y: 160, width: 300, height: 50 };
export const MAP_TITLE = { x: 1950, y: 150, width: 600, height: 60 };
// The browser also has a PLAYERS column; only the lobby has this player count.
export const LOBBY = { x: 1400, y: 185, width: 300, height: 50 };
const LOBBY_READY = /PLAYERS\s*:?\s*\d+\s*\/\s*\d+/i;

// Controls, as frame positions.
export const BACK = { x: 155, y: 1389 };
export const CREATE_GAME = { x: 1510, y: 1201 };
/** The first map of the open folder. */
export const FIRST_MAP = { x: 1190, y: 366 };
const GAME_NAME = { x: 400, y: 340 };
export const CREATE = { x: 2198, y: 1126 };
export const JOIN_NAME = { x: 300, y: 1205 };
export const JOIN = { x: 1295, y: 1213 };
export const START = { x: 2195, y: 1127 };

export interface FreshMatchOptions {
  readonly map: string;
  /** Text the Create Game screen shows for the selected map, such as its name. */
  readonly title: RegExp;
  /** The map's runtime file prefix (configureRuntime); every client acknowledges the match start under it. */
  readonly filePrefix?: string;
  /** Leave through the game menu even when a client doesn't look like it is in a game. */
  readonly fromGame?: boolean;
}

/** The match in every client, once each has acknowledged its start. */
export const freshMatch = ({ map, title, filePrefix = "wisp", fromGame = false }: FreshMatchOptions) => Effect.gen(function*() {
  const clients = yield* Clients;
  const files = yield* GameFiles;
  const [first, ...others] = clients.all;
  const game = `wisp ${(yield* Clock.currentTimeMillis).toString(36)}`;

  const read = (client: Client, region: typeof RESULTS, ink: "light" | "gold", pattern: RegExp) =>
    clients.read(client, region, ink).pipe(Effect.map((text) => pattern.test(text)));
  const click = (client: Client, at: { readonly x: number; readonly y: number }) => clients.click(client, at.x, at.y);

  /** From a running game, its score screen, a lobby, Create Game or Custom Games, to Custom Games. */
  const leave = (client: Client) => Effect.gen(function*() {
    if (!fromGame && (yield* read(client, CUSTOM_GAMES, "light", /CREATE/i))) return;
    // Results, a lobby and Create Game all leave through the same Back button.
    if (fromGame || (!(yield* read(client, RESULTS, "gold", /RESULTS/i)) && !(yield* read(client, LOBBY, "light", LOBBY_READY)) && !(yield* read(client, CREATE_TITLE, "light", /REATE\s*GAME/i)))) {
      yield* clients.batch(client, [
        { kind: "keys", keys: ["Escape"] },
        { kind: "wait", millis: 40 },
        { kind: "keys", keys: ["F10"] },
      ]);
      yield* waitForText(client, "game menu", /Game Menu/i, GAME_MENU, "gold", 5);
      yield* clients.batch(client, [
        { kind: "keys", keys: ["e"] },
        // The submenu has no event signal; allow its measured animation before Q.
        { kind: "wait", millis: 200 },
        { kind: "keys", keys: ["q"] },
      ]);
      yield* waitForText(client, "match results", /RESULTS/i, RESULTS, "gold", 10);
    }
    yield* click(client, BACK);
    yield* waitForText(client, "custom games", /CREATE/i, CUSTOM_GAMES, "light", 15);
  }).pipe(step(`${client.name} at Custom Games`));

  // The map's hot folder exists before its match does, so its first lookups for a reload are cheap.
  const install = Effect.gen(function*() {
    yield* prepareHotFolders(clients.all.map((client) => dataDirectory(client.documents)), filePrefix);
    yield* Effect.forEach(clients.all, (client) => files.installMap(client.documents, map), { discard: true });
  }).pipe(step("map installed"));

  const host = (client: Client) => Effect.gen(function*() {
    yield* click(client, CREATE_GAME);
    yield* waitForText(client, "create game", /REATE\s*GAME/i, CREATE_TITLE, "light", 10);
    yield* click(client, FIRST_MAP);
    yield* waitForText(client, "map selected", title, MAP_TITLE, "light", 5);
    yield* clients.batch(client, [
      { kind: "click", ...GAME_NAME },
      { kind: "keys", keys: ["ctrl+a"] },
      { kind: "text", text: game },
      { kind: "click", ...CREATE },
    ]);
    yield* waitForText(client, "lobby", LOBBY_READY, LOBBY, "light", 20);
  }).pipe(step(`${client.name} hosting "${game}"`));

  const prepareJoin = (client: Client) => clients.batch(client, [
    { kind: "click", ...JOIN_NAME },
    { kind: "keys", keys: ["ctrl+a"] },
    { kind: "text", text: game },
  ]).pipe(step(`${client.name} join name prepared`));

  const joinByName = (client: Client) => Effect.gen(function*() {
    yield* click(client, JOIN);
    yield* waitForText(client, "joined lobby", LOBBY_READY, LOBBY, "light", 20);
  }).pipe(step(`${client.name} asked to join`));

  yield* Effect.all([install, ...clients.all.map(leave)], { concurrency: "unbounded", discard: true });
  yield* Effect.all([unlessLost(first, host(first)), ...others.map(prepareJoin)], { concurrency: clients.all.length, discard: true });
  yield* Effect.forEach(others, (client) => unlessLost(client, joinByName(client)), { discard: true });
  yield* waitForText(first, "all players", new RegExp(`PLAYERS\\s*:?\\s*${clients.all.length}\\s*/\\s*\\d+`, "i"), LOBBY, "light", 60).pipe(step("everyone in the lobby"));
  const start = yield* Clock.currentTimeMillis;
  yield* click(first, START);
  yield* Effect.forEach(clients.all, (client) => unlessLost(client, startedAfter(client, start, filePrefix)), { concurrency: "unbounded", discard: true }).pipe(step("match running in every client"));
});

/**
 * Waits until the client acknowledges a match that started after `since`:
 * startHotReload writes the acknowledgement of the map's own bundle.
 */
export const startedAfter = (client: Client, since: number, filePrefix = "wisp") => Effect.gen(function*() {
  let problem: MalformedGameFile | undefined;
  const acknowledged = Effect.forEach(FILE_SLOT_NUMBERS, (slot) => readGameFile(join(dataDirectory(client.documents), ackFile(slot, filePrefix)), Acknowledgement).pipe(
    Effect.map((file) => file !== undefined && file.modified > since),
    // A file the game is still writing can read as malformed; it is read again on the next poll.
    Effect.catchTag("MalformedGameFile", (malformed) => Effect.sync(() => {
      problem = malformed;
      return false;
    })),
  )).pipe(Effect.map((slots) => (slots.includes(true) ? true : undefined)));
  return yield* waitFor(client, "match start acknowledgement", 60, acknowledged).pipe(
    Effect.catchTag("DesktopFailure", (timeout): Effect.Effect<never, DesktopFailure | MalformedGameFile> => (problem === undefined ? Effect.fail(timeout) : Effect.fail(problem))),
  );
});
