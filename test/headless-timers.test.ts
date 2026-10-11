import { afterAll, expect, test } from "bun:test";
import { installHeadless } from "../scripts/wisp/headless";
import { runJourney } from "../src/headless/journey";
import { install, start } from "./timers56/main";
import { EXPECTED } from "./timers56/expected";

const runtime = installHeadless({ filePrefix: "timers56", globalPrefixes: ["__timers56"] });
afterAll(runtime.restore);

test("each timer rule's row agrees in two clients", () => {
  const clients = runtime.clients({ install, start });
  const result = runJourney(clients, { frames: 76, events: [] });
  expect(result.divergence).toBeUndefined();
  expect(result.clients.map(client => client.errors)).toEqual([[], []]);
  for (const client of clients.clients) expect(client.files.get(`timers56-p${client.slot}.txt`)).toEqual(EXPECTED);
});
