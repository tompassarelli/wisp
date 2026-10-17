import { afterAll, expect, test } from "bun:test";
import { installHeadless } from "../scripts/wisp/headless/headless";
import { runJourney } from "../src/headless/journey";
import { install, start } from "./sounds60/main";
import { SOUND_NATIVES } from "./sounds60/cases";
import * as audio80 from "./audio80/main";
import { EXPECTED } from "./sounds60/expected";

const runtime = installHeadless({ filePrefix: "sounds60", globalPrefixes: ["__sounds60"], natives: SOUND_NATIVES });
afterAll(runtime.restore);

test("each sound rule's row agrees in two clients", () => {
  const clients = runtime.clients({ install, start });
  const result = runJourney(clients, { frames: 240, events: [] });
  expect(result.divergence).toBeUndefined();
  expect(result.clients.map(client => client.errors)).toEqual([[], []]);
  for (const client of clients.clients) expect(client.files.get(`sounds60-p${client.slot}.txt`)).toEqual(EXPECTED);
});
