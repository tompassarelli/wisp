import { Clock, Effect, Fiber, Layer } from "effect";
import { TestClock } from "effect/testing";
import { expect, test } from "bun:test";
import { Clients, type Client } from "../scripts/wisp/clients";
import { dataDirectory, GameFiles, type StoredFile } from "../scripts/wisp/gameFiles";
import { BACK, CREATE, CREATE_GAME, CREATE_TITLE, CUSTOM_GAMES, FIRST_MAP, GAME_MENU, JOIN, LOBBY, MAP_TITLE, RESULTS, START, freshMatch } from "../scripts/wisp/lobby";

const started = 'function PreloadFiles takes nothing returns nothing\n\tcall PreloadStart()\n\tcall Preload( "applied 0 at 0" )\nendfunction\n';

test.each([false, true])("a fresh match of a two-player map drives two fake clients until each acknowledges its start (fromGame=%s)", async (fromGame) => {
  const clients: readonly [Client, Client] = [
    { name: "a", documents: "/a/Documents/Warcraft III" },
    { name: "b", documents: "/b/Documents/Warcraft III" },
  ];
  const states = new Map(clients.map(({ name }) => [name, "game"]));
  const selected = new Set<string>();
  const clicks: string[] = [];
  const keyEvents: string[] = [];
  const installed: string[] = [];
  // What the host did, in order: files it wrote, installing the map, starting the match.
  const order: string[] = [];
  let startedAt: number | undefined;
  let joinedAt: number | undefined;
  let hostedAt: number | undefined;
  // A client's acknowledgement from an earlier match, which must not count.
  const previous = { text: started, modified: -1 };
  const gameFiles = GameFiles.of({
    read: (path): Effect.Effect<StoredFile | undefined> => Effect.gen(function*() {
      // The client in slot N writes its acknowledgement as slot N.
      const writer = clients.findIndex(({ documents }, slot) => path === `${dataDirectory(documents)}/sample-hot-ack-p${slot}.txt`);
      if (writer < 0) return undefined;
      return startedAt !== undefined && (yield* Clock.currentTimeMillis) >= startedAt ? { text: started, modified: startedAt } : previous;
    }),
    write: (path) => Effect.sync(() => {
      order.push(`write:${path}`);
    }),
    replace: () => Effect.void,
    list: () => Effect.succeed([]),
    remove: () => Effect.void,
    installMap: (documents, map) => Effect.sync(() => {
      order.push("install");
      installed.push(`${documents}:${map}`);
    }),
  });
  const fakeClients: typeof Clients.Service = Clients.of({
    all: clients,
    read: (client, region) => Effect.gen(function*() {
      if (client.name === "a" && hostedAt !== undefined && (yield* Clock.currentTimeMillis) >= hostedAt) states.set("a", "lobby");
      if (client.name === "b" && joinedAt !== undefined && (yield* Clock.currentTimeMillis) >= joinedAt) states.set("b", "lobby");
      const state = states.get(client.name);
      if (region === CUSTOM_GAMES) return state === "custom" ? "CREATE GAME" : "";
      if (region === RESULTS) return state === "results" ? "RESULTS" : "";
      // A browser column can say PLAYERS while hosting or joining has not completed.
      if (region === LOBBY) return state === "lobby" ? `PLAYERS: ${joinedAt === undefined ? 1 : 2}/2` : "PLAYERS";
      if (region === CREATE_TITLE) return state === "create" ? "REATE GAME" : "";
      if (region === GAME_MENU) return state === "menu" ? "Game Menu" : state === "end-menu" ? "End Game" : "";
      if (region === MAP_TITLE) return selected.has(client.name) ? "WISP SAMPLE" : "";
      return "";
    }),
    words: () => Effect.succeed([]),
    click: (client, x, y) => Effect.gen(function*() {
      clicks.push(`${client.name}:${x},${y}`);
      if (x === START.x && y === START.y) order.push("start");
      const before = states.get(client.name);
      if (x === BACK.x && y === BACK.y) states.set(client.name, "custom");
      if (x === CREATE_GAME.x && y === CREATE_GAME.y) states.set(client.name, "create");
      if (x === FIRST_MAP.x && y === FIRST_MAP.y) selected.add(client.name);
      if (x === CREATE.x && y === CREATE.y && before === "create") {
        states.set(client.name, "hosting");
        hostedAt = (yield* Clock.currentTimeMillis) + 100;
      }
      if (x === JOIN.x && y === JOIN.y) {
        expect(states.get("a")).toBe("lobby");
        joinedAt = (yield* Clock.currentTimeMillis) + 100;
      }
      if (x === START.x && y === START.y && before === "lobby") {
        expect(states.get("b")).toBe("lobby");
        startedAt = (yield* Clock.currentTimeMillis) + 100;
        for (const { name } of clients) states.set(name, "playing");
      }
    }),
    keys: (client, ...names) => Effect.sync(() => {
      keyEvents.push(...names.map((name) => `${client.name}:${name}`));
      const state = states.get(client.name);
      if (names.includes("F10")) states.set(client.name, "menu");
      else if (names.includes("e") && state === "menu") states.set(client.name, "end-menu");
      else if (names.includes("q") && state === "end-menu") states.set(client.name, "results");
    }),
    typeText: () => Effect.void,
    batch: (client, actions) => Effect.forEach(actions, (action) => {
      switch (action.kind) {
        case "click": return fakeClients.click(client, action.x, action.y);
        case "keys": return fakeClients.keys(client, ...action.keys);
        case "text": return fakeClients.typeText(client, action.text);
        case "wait": return Effect.sleep(action.millis);
      }
    }, { discard: true }),
  });
  const program = freshMatch({ map: "/maps/sample.w3x", title: /WISP\s*SAMPLE/i, filePrefix: "sample", fromGame }).pipe(
    Effect.provide(Layer.merge(Layer.succeed(Clients, fakeClients), Layer.succeed(GameFiles, gameFiles))),
  );
  const run = Effect.gen(function*() {
    const fiber = yield* Effect.forkChild(program);
    for (let advance = 0; advance < 20; advance++) {
      yield* Effect.yieldNow;
      yield* TestClock.adjust("250 millis");
    }
    yield* Fiber.join(fiber);
  }).pipe(Effect.provide(TestClock.layer()));

  await Effect.runPromise(run);
  expect([...states.values()]).toEqual(["playing", "playing"]);
  expect(installed).toEqual(clients.map(({ documents }) => `${documents}:/maps/sample.w3x`));
  // Each client's hot folder gets its marker before the map is installed and long before the match starts.
  const markers = clients.map(({ documents }) => `write:${dataDirectory(documents)}/sample-hot/host.pld`);
  expect(order).toEqual([...markers, "install", "install", "start"]);
  expect(selected).toEqual(new Set(["a"]));
  expect(keyEvents.indexOf("a:Escape")).toBeLessThan(keyEvents.indexOf("a:F10"));
  expect(clicks.filter((click) => click === `a:${START.x},${START.y}`)).toHaveLength(1);
});
