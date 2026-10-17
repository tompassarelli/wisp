import { afterAll, expect, test } from "bun:test";
import { installHeadless } from "../host/headless/headless";
import { runJourney } from "../src/headless/journey";
import { install, start } from "./unit-states/main";
import { UNIT_FIXTURE } from "./unit-states/cases";
import { EXPECTED } from "./unit-states/expected";

const runtime = installHeadless({ filePrefix: "unit-states", globalPrefixes: ["__unitStates"], unitStates: UNIT_FIXTURE });
afterAll(runtime.restore);

const FRAMES = 80;

function play() {
  const clients = runtime.clients({ install, start });
  const result = runJourney(clients, { frames: FRAMES, events: [] });
  return { clients, result };
}

test("[native #44] all 24 unit state rows match Warcraft in two clients", () => {
  const { clients, result } = play();
  expect(result.divergence).toBeUndefined();
  expect(result.clients.map(client => client.errors)).toEqual([[], []]);
  for (const client of clients.clients) expect(client.files.get(`unit-states-p${client.slot}.txt`)).toEqual(EXPECTED);
});
