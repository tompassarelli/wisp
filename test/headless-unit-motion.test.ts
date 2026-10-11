import { afterAll, expect, test } from "bun:test";
import { installHeadless } from "../scripts/wisp/headless";
import { runJourney } from "../src/headless/journey";
import { install, start } from "./unit-motion57/main";
import { UNIT_MOTION_NOOPS } from "./unit-motion57/cases";
import { EXPECTED } from "./unit-motion57/expected";

const runtime = installHeadless({ filePrefix: "unit-motion", globalPrefixes: ["__unitMotion"], intentionalNoops: UNIT_MOTION_NOOPS });
afterAll(runtime.restore);

test("unit position, height, facing and dash cases agree in two clients", () => {
  const clients = runtime.clients({ install, start });
  const result = runJourney(clients, { frames: 150, events: [] });
  expect(result.divergence).toBeUndefined();
  expect(result.clients.map(client => client.errors)).toEqual([[], []]);
  for (const client of clients.clients) expect(client.files.get(`unit-motion-p${client.slot}.txt`)).toEqual(EXPECTED);
});
