import { randomBytes } from "node:crypto";
import { basename, join } from "node:path";
import { Clock, Console, Effect, Schedule } from "effect";
import { ackFile } from "../../src/runtime/gameFiles";
import { Acknowledgement, FILE_SLOT_NUMBERS, type MalformedGameFile } from "./preloadRecord";
import { type Client, Clients, type DesktopFailure, waitFor } from "./clients";
import { GameFiles, dataDirectory, prepareHotFolders, readGameFile } from "./gameFiles";
import { MenuFailure, hostLobby, joinLobby, leaveLobby, reportedMenus, startLobby } from "./menus";
import { step } from "./timings";
import { ClientWatch, inState, unlessLost, waitFor as waitForState } from "./watch";

export const MENU_SECONDS = 180;

export interface FreshMatchOptions {
  readonly map: string;

  readonly folder: string;

  readonly filePrefix?: string;
}

export const freshMatch = ({ map, folder, filePrefix = "wisp" }: FreshMatchOptions) => Effect.scoped(Effect.gen(function*() {
  const clients = yield* Clients;
  const files = yield* GameFiles;
  const [first, ...others] = clients.all;
  const game = `wisp ${(yield* Clock.currentTimeMillis).toString(36)}`;
  const password = randomBytes(4).toString("hex");
  const pages = yield* Effect.forEach(clients.all, (client) => reportedMenus(client.menuReportPort), { concurrency: "unbounded" });
  const missing = clients.all.filter((_, index) => pages[index] === undefined).map((client) => client.name);
  if (missing.length > 0) {
    return yield* new MenuFailure({ operation: "fresh match", problem: `no menu page reported for ${missing.join(", ")}; a fresh match hosts only through it, as a private game (install it with \`wisp menus install\`, wisp:docs/driving-warcraft.md)` });
  }
  const menus = new Map(clients.all.map((client, index) => [client.name, pages[index]!]));
  const page = (client: Client) => menus.get(client.name)!;

  const leave = (client: Client) => Effect.gen(function*() {
    const { state } = yield* ClientWatch.use((watch) => watch.view(client));
    if (state.kind === "menus" || state.kind === "signed in") return;
    if (state.kind === "lobby" || state.kind === "loading" || state.kind === "in match") yield* leaveLobby(page(client));
    if (state.kind === "lobby") return;
    yield* Effect.sleep("2 seconds");
    yield* clients.keys(client, "Escape");
    yield* Console.log(`${client.name}: waiting for the menus (up to ${MENU_SECONDS} s)`);
    yield* waitForState(client, inState("menus"), { what: "the menus", seconds: MENU_SECONDS });
  }).pipe(step(`${client.name} at the menus`));

  const install = Effect.gen(function*() {
    yield* prepareHotFolders(clients.all.map((client) => dataDirectory(client.documents)), filePrefix);
    yield* Effect.forEach(clients.all, (client) => files.installMap(client.documents, map), { discard: true });
  }).pipe(step("map installed"));

  const host = (client: Client) => hostLobby(page(client), { folder, file: basename(map), gameName: game, password }).pipe(step(`${client.name} hosting "${game}"`));

  const joinGame = (client: Client) => joinLobby(page(client), game, password, 10).pipe(
    Effect.retry({ times: 2, schedule: Schedule.spaced("2 seconds") }),
    step(`${client.name} joined`),
  );

  yield* Effect.all([install, ...clients.all.map(leave)], { concurrency: "unbounded", discard: true });
  yield* unlessLost(first, host(first));
  yield* Effect.forEach(others, (client) => unlessLost(client, joinGame(client)), { discard: true });
  const start = yield* Clock.currentTimeMillis;
  yield* startLobby(page(first));
  yield* Effect.forEach(clients.all, (client) => unlessLost(client, startedAfter(client, start, filePrefix)), { concurrency: "unbounded", discard: true }).pipe(step("match running in every client"));
}));

export const startedAfter = (client: Client, since: number, filePrefix = "wisp") => Effect.gen(function*() {
  let problem: MalformedGameFile | undefined;
  const acknowledged = Effect.forEach(FILE_SLOT_NUMBERS, (slot) => readGameFile(join(dataDirectory(client.documents), ackFile(slot, filePrefix)), Acknowledgement).pipe(
    Effect.map((file) => file !== undefined && file.modified > since),

    Effect.catchTag("MalformedGameFile", (malformed) => Effect.sync(() => {
      problem = malformed;
      return false;
    })),
  )).pipe(Effect.map((slots) => (slots.includes(true) ? true : undefined)));
  return yield* waitFor(client, "match start acknowledgement", 60, acknowledged).pipe(
    Effect.catchTag("DesktopFailure", (timeout): Effect.Effect<never, DesktopFailure | MalformedGameFile> => (problem === undefined ? Effect.fail(timeout) : Effect.fail(problem))),
  );
});
