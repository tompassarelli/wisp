import { afterAll, expect, test } from "bun:test";
import { installHeadless } from "../host/headless/headless";
import { runJourney } from "../src/headless/journey";
import { MEASURED_BATTLE_NET, syncDelivery } from "../src/headless/syncChannel";
import { EXPECTED } from "./player-mouse67/expected";
import { PLAYER_MOUSE_JOURNEY } from "./player-mouse67/journey";
import { install, start } from "./player-mouse67/main";

const runtime = installHeadless({ filePrefix: "player-mouse67", globalPrefixes: ["__playerMouse67"] });
afterAll(runtime.restore);

test("[scenario] a player's world-coordinate mouse move, press and release reach every client's trigger on the same frame with the same coordinates and button, under measured Battle.net delivery", () => {
  const clients = runtime.clients({ install, start }, [0, 1], { delivery: syncDelivery(MEASURED_BATTLE_NET, 67) });
  const result = runJourney(clients, PLAYER_MOUSE_JOURNEY);
  expect(result.clients.map(client => [client.errors, client.missingNatives])).toEqual([[[], []], [[], []]]);
  expect(result.divergence).toBeUndefined();
  expect(clients.clients.map(client => client.files.get(`player-mouse67-p${client.slot}.txt`))).toEqual([EXPECTED, EXPECTED]);
});
