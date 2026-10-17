import { afterAll, expect, test } from "bun:test";
import { installHeadless } from "../host/headless/headless";
import { runJourney } from "../src/headless/journey";
import { install, start } from "./script-rules50/main";
import { EXPECTED, EXPECTED_SYNC } from "./script-rules50/expected";

const runtime = installHeadless({ filePrefix: "script-rules", globalPrefixes: ["__scriptRules"] });
afterAll(runtime.restore);

test("[native] each script rule's 3.0.1 row agrees in two clients", () => {
  const clients = runtime.clients({ install, start });
  const result = runJourney(clients, { frames: 150, events: [] });
  expect(result.divergence).toBeUndefined();
  expect(result.clients.map(client => [client.errors, client.missingNatives])).toEqual([[[], []], [[], []]]);
  for (const client of clients.clients) {
    expect(client.files.get(`script-rules-p${client.slot}.txt`)).toEqual(EXPECTED);
    expect(client.files.get(`script-rules-sync-p${client.slot}.txt`)).toEqual(EXPECTED_SYNC);
  }
});
